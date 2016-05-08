import { Meteor } from 'meteor/meteor';
import { _ } from 'lodash';

import { Logger } from 'meteor/jag:pince';

import { spawn } from 'child_process';
import psList from 'ps-list';
import psTree from 'ps-tree';
import usage from 'usage';
import expandHomeDir from 'expand-home-dir';
import async from 'async';

import { recordLog, findLogWithoutNewline, closeLines } from '/server/proclog';
import { Process } from '/shared/process';
import { Procfile } from '/shared/procfile';

//Logger.setLevel('trace');

var
  processOpsInProgress = 0,
  childProcesses = {},
  Future = Npm.require('fibers/future'),
  log = new Logger('server.processes');


function psTreePids(rootPid, callback) {
  log.trace('psTreePids ' + rootPid);
  psTree(rootPid, function (err, children) {
    if (err) {
      log.trace('psTreePids ' + rootPid + ' err: ' + err);
      return callback(err);
    }
    var i, pids = [rootPid];
    for (i = 0; i < children.length; i++) {
      pids.push(children[i].PID);
    }
    log.trace('psTreePids ' + rootPid + ' pids: ' + pids.join(', '));
    callback(null, pids);
  });
}

function psTreeUsageSum(rootPid, callback) {
  log.trace('psTreeUsageSum ' + rootPid);
  psTreePids(rootPid, function (err, pids) {
    if (err) {
      throw 'Failed to get children of ' + rootPid + ': ' + err;
    }
    async.reduce(pids, {memory: 0, cpu: 0}, function (memo, pid, callback) {
      usage.lookup(pid, function (err, data) {
        if (err) {
          return callback(null, memo);
        }
        callback(null, {
          memory: parseInt(memo.memory, 10) + data.memory,
          cpu: parseFloat(memo.cpu) + data.cpu
        });
      });
    }, callback);
  });
}

function updateProcessStats(cb) {
  if (processOpsInProgress > 0) {
    // Someone's doing operations that start / stop processes we'll want to list
    // Skipping this round of updates to avoid race conditions
    log.debug('updateProcessStats skip: process ops in progress');
    if (cb) { return cb(); }
  }
  log.trace('updateProcessStats start');
  psList().then(function (psListData) {
    log.trace('updateProcessStats got_data ' + JSON.stringify(psListData));
    async.each(
      Process.find({pid: {$exists: true, $ne: null}}).fetch(),
      function (process, cb) {
        var psListItem = _.find(psListData, {pid: process.pid});
        log.trace('updateProcessStats process ' + JSON.stringify(process));
        psTreeUsageSum(process.pid, Meteor.bindEnvironment(function (usageErr, usageData) {
          var modifier;
          if (psListItem && !usageErr) {
            modifier = {$set: _.extend(
              {cmd: psListItem.cmd},
              usageData
            )};
            log.trace('updateProcessStats ' + process.name + ' ' + JSON.stringify(modifier));
            Process.update({_id: process._id}, modifier);
          } else {
            log.warn('updateProcessStats stopped ' + process.name + ' ' + JSON.stringify(usageErr));
            markStopped(process.name);
          }
          cb();
        }));
      }, cb);
  });
}

function markRunning(name, pid) {
  log.info('markRunning ' + name + ' ' + pid);
  Process.update(
    {
      name: name
    }, {
      $set: {
        name: name,
        pid: pid,
        started: new Date(),
        status: 'running'
      }
    });
}

function markStopped(name) {
  log.info('markStopped ' + name);
  var modifier = { $set: {
    status: 'stopped',
    pid: null,
    memory: null,
    cpu: null,
    started: null
  }};
  Process.update({name: name}, modifier);
}

Meteor.setInterval(updateProcessStats, 1000);

Meteor.publish('processes', function () {
  return Process.find({}, {sort: ['name']});
});

/**
 * Enter / leave portion of a semaphore. Each time processOp is called, it increments
 * proecssOpsInProgress by one. It passes a "done" callback to its second argument, which,
 * when called, decrements it again. If the done callback is called more than once, an exception
 * is raised. If the done callback is not called within 5 seconds, we time out and pretend
 * it was called anyway.
 */
function processOp(name, f) {
  var fut = new Future();
  processOpsInProgress += 1;
  log.trace('processOp enter ' + name + ' => ' + processOpsInProgress);
  var timeout = Meteor.setTimeout(
    function () {
      if (fut.isResolved()) {
        throw 'processOp already resolved ' + name;
      }
      processOpsInProgress -= 1;
      log.trace('processOp timeout ' + name + ' => ' + processOpsInProgress);
      fut.return();
    },
    5000
  );
  f(Meteor.bindEnvironment(function (cb) {
    if (fut.isResolved()) {
      throw 'processOp already resolved ' + name;
    }
    Meteor.clearTimeout(timeout);
    processOpsInProgress -= 1;
    log.trace('processOp done ' + name + ' => '  + processOpsInProgress);
    updateProcessStats(function () {
      fut.return();
      if (cb) { cb(); }
    });
  }));
  fut.wait();
}

Meteor.methods({
  'process/start': function(name) {
    var
      processObj = Process.findOne({name: name}), childProcess,
      procfileEntry = Procfile.findOne({tag: 'current'}).entry(name);

    log.info('process/start ' + name);
    if (!processObj) {
      log.info('process/start process-not-found ' + name);
      throw new Meteor.Error('process-not-found',
        'Process name ' + name + ' is not defined in the Procfile (see /procfile for the list of known processes)');
    }
    if (processObj.status === 'running') {
      log.info('process/start process-running ' + name);
      throw new Meteor.Error('already-running', 'Process ' + name + ' is already running.');
    }

    processOp('process/start ' + name, function (done) {
      var binaryPath = expandHomeDir(procfileEntry.cmd);
      childProcess = spawn(binaryPath, procfileEntry.args, {
        env: _.extend(
          {},
          {HOME: process.env.HOME},
          procfileEntry.env
        ),
        cwd: expandHomeDir('~/.prezi/please')
      });

      recordLog('system', 'info', 'Started ' + name + ' (pid ' + childProcess.pid + ')');
      markRunning(name, childProcess.pid);
      childProcesses[name] = childProcess;

      _(['stdout', 'stderr']).each(function (fdName) {
        function handleData(data) {
          var logWithoutNewline = findLogWithoutNewline(name, fdName);
          var lines = data.toString().split('\n'), i,
            firstLine = lines.shift(),
            lastLine = lines.pop();

          if (_.isUndefined(lastLine)) {
            // Special case: there's only a single line of input, with no \n
            recordLog(name, fdName, firstLine, true, logWithoutNewline);
            return;
          }

          recordLog(name, fdName, firstLine, false, logWithoutNewline);
          for (i = 0; i < lines.length; i++) {
            recordLog(name, fdName, lines[i], false, null);
          }
          if (!_.isUndefined(lastLine) && lastLine !== '') {
            recordLog(name, fdName, lastLine, true, null);
          }
        }
        childProcess[fdName].on('data', handleData);
      });

      childProcess.on('error', Meteor.bindEnvironment(function (err) {
        if (err.code === 'ENOENT') {
          recordLog('system', 'error', 'Binary for ' + name + ' not found at "' + binaryPath + '".');
          markStopped(name);
        } else {
          recordLog(name, '', err.toString());
        }
      }));

      childProcess.on('exit', Meteor.bindEnvironment(function (code, signal) {
        var msg = name + ' exited';
        if (code !== null) {
          msg += ' with code ' + code;
        }
        if (signal) {
          msg += ' (stopped by ' + signal + ')';
        }
        recordLog('system', 'info', msg);
        log.info(msg);
        markStopped(name);
      }));

      done();
    });
  },

  'process/kill': function (name, signal) {
    log.info('process/kill ' + name + ' ' + signal);

    var procObj = Process.findOne({name: name});
    if (!procObj) {
      log.info('process/kill process-not-found ' + name);
      throw new Meteor.Error('process-not-found',
        'Process name ' + name + ' is not defined in the Procfile (see /procfile for the list of known processes)');
    }
    if (procObj.status !== 'running') {
      log.info('process/kill process-not-running ' + name);
      throw new Meteor.Error('not-running', 'Process ' + name + ' is not running.');
    }
    if (procObj.pid === null) {
      // This shouldn't  happen. It did happen under a complex bug
      // Leaving it here, maybe it'll catch something in the future
      log.warn('process/kill process-pid-null ' + name + ' ' + JSON.stringify(procObj));
      Process.update({name: name}, {$set: {status: 'stopped'}});
      return;
    }

    processOp('process/kill ' + name + ' ' + signal, function (done) {
      psTreePids(procObj.pid, function (err, pids) {
        log.info('kill ' + name + ' ' + procObj.pid + ' ' + signal);
        try {
          process.kill(procObj.pid, signal);
        } catch(e) {}
        if (err) {
          done();
          throw 'Failed to find children of ' + name + ' pid=' + procObj.pid;
        }
        _(pids).forEach(function (pid) {
          log.info('kill ' + name + ' ' + pid + ' ' + signal);
          try {
            process.kill(pid, signal);
          } catch(e) {}
        });
        recordLog('system', 'info', 'Killing ' + name + ' with ' + signal);
        done();
      });
    });
  },

  'process/start-all': function () {
    log.info('process/start-all');
    processOp('process/start-all', function (done) {
      _.each(Process.find({status: {$ne: 'running'}}).fetch(), function (process) {
        Meteor.call('process/start', process.name);
      });
      done();
    });
  },

  'process/kill-all': function (signal) {
    log.info('process/kill-all ' + signal);
    processOp('process/kill-all ' + signal, function (done) {
      _.each(Process.find({status: 'running'}).fetch(), function (process) {
        Meteor.call('process/kill', process.name, signal);
      });
      done();
    });
  },

  'process/stdin': function (name, line) {
    var stream = childProcesses[name].stdin;
    recordLog(name, 'stdin', line);
    closeLines(name);
    stream.write(line + '\n');
  }
});

process.on('SIGTERM', Meteor.bindEnvironment(function () {
  log.info('Graceful shutdown initiated');
  Meteor.call('process/kill-all', 'SIGTERM');
  process.exit();
}));

