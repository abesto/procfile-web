var
  Future = Npm.require('fibers/future'),
  spawn = Meteor.npmRequire('child_process').spawn,
  fs = Meteor.npmRequire('fs'),
  psList = Meteor.npmRequire('ps-list'),
  psTree = Meteor.npmRequire('ps-tree'),
  usage = Meteor.npmRequire('usage'),
  expandHomeDir = Meteor.npmRequire('expand-home-dir'),
  processOpsInProgress = 0,
  childProcesses = {},
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
          return callback(err);
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
    return cb();
  }
  log.trace('updateProcessStats start');
  psList().then(function (psListData) {
    log.trace('updateProcessStats got_data ' + JSON.stringify(psListData));
    async.each(
      Process.find({pid: {$exists: true, $ne: null}}).fetch(),
      function (process, cb) {
        var psListItem = _.findWhere(psListData, {pid: process.pid});
        log.trace('updateProcessStats process ' + JSON.stringify(process));
        psTreeUsageSum(process.pid, Meteor.bindEnvironment(function (usageErr, usageData) {
          var modifier;
          if (psListItem && !usageErr) {
            modifier = _.extend(
              {status: 'running', cmd: psListItem.cmd},
              usageData
            );
          } else {
            modifier = {
              status: 'stopped',
              pid: null,
              memory: null,
              cpu: null,
              started: null
            };
          }
          modifier = {$set: modifier};
          log.trace('updateProcessStats ' + process.name + ' ' + JSON.stringify(modifier));
          if (modifier.$set.status !== process.status) {
            recordLog('system', 'info', process.name + ' went from ' + process.status + ' to ' + modifier.$set.status);
          }
          Process.update({_id: process._id}, modifier);
          cb();
        }));
      }, cb);
  });
}

var updateProcessStatsSync = Meteor.wrapAsync(updateProcessStats);

function registerProcess(name, pid) {
  log.info('registerProcess ' + name + ' ' + pid);
  Process.upsert(
    {
      name: name
    }, {
      $set: {
        name: name,
        pid: pid,
        started: new Date()
      }
    });
}

Meteor.setInterval(updateProcessStats, 1000);

Meteor.publish('processes', function () {
  return Process.find();
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
  f(Meteor.bindEnvironment(function () {
    if (fut.isResolved()) {
      throw 'processOp already resolved ' + name;
    }
    Meteor.clearTimeout(timeout);
    processOpsInProgress -= 1;
    log.trace('processOp done ' + name + ' => '  + processOpsInProgress);
    updateProcessStatsSync();
    fut.return();
  }));
  fut.wait();
}

Meteor.methods({
  'process/start': function(name) {
    var
      processObj = Process.findOne({name: name}), childProcess,
      procfileEntry = Procfile.findOne({tag: 'current'}).content[name];

    log.info('process/start ' + name);
    if (!processObj) {
      log.info('process/start process-not-found ' + name);
      throw new Meteor.Error('process-not-found', 'Process name ' + name + ' is not defined in the Procfile (see /procfile for the list of known processes)');
    }
    if (processObj.status === 'running') {
      log.info('process/start process-running ' + name);
      throw new Meteor.Error('already-running', 'Process ' + name + ' is already running.');
    }

    processOp('process/start ' + name, function (done) {
      childProcess = spawn(expandHomeDir(procfileEntry.cmd), procfileEntry.args, {
        env: _.extend(
          {},
          {HOME: process.env.HOME},
          procfileEntry.env
        ),
        cwd: expandHomeDir('~/.prezi/please')
      });
      recordLog('system', 'info', 'Started ' + name);
      _(['stdout', 'stderr']).each(function (fdName) {
        var log = new Logger(name, fdName);
        childProcess[fdName].on('data', function(data) {
          var lines = data.toString().split('\n'), i,
            lastLine = lines.pop();
          for (i = 0; i < lines.length; i++) {
            recordLog(name, fdName, lines[i]);
          }
          if (lastLine != '') {
            recordLog(name, fdName, lastLine, true);
          }
        });
      });

      registerProcess(name, childProcess.pid);
      childProcesses[name] = childProcess;
      done();
    });
  },

  'process/kill': function (name, signal) {
    log.info('process/kill ' + name + ' ' + signal);

    var procObj = Process.findOne({name: name});
    if (!procObj) {
      log.info('process/kill process-not-found ' + name);
      throw new Meteor.Error('process-not-found', 'Process name ' + name + ' is not defined in the Procfile (see /procfile for the list of known processes)');
    }
    if (procObj.status !== 'running') {
      log.info('process/kill process-not-running ' + name);
      throw new Meteor.Error('not-running', 'Process ' + name + ' is not running.');
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
        recordLog('system', 'info', 'Killed ' + name + ' with ' + signal);
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
