var
  spawn = Meteor.npmRequire('child_process').spawn,
  fs = Meteor.npmRequire('fs'),
  psList = Meteor.npmRequire('ps-list'),
  psTree = Meteor.npmRequire('ps-tree'),
  usage = Meteor.npmRequire('usage'),
  expandHomeDir = Meteor.npmRequire('expand-home-dir'),
  log = new Logger('server.processes');

function psTreePids(rootPid, callback) {
  psTree(rootPid, function (err, children) {
    if (err) {
      log.trace('psTreePids ' + rootPid + ' err: ' + err);
      return callback(err);
    }
    var i, pids = [rootPid];
    for (i = 0; i < children.length; i++) {
      pids.push(children[i].PID);
    }
    log.trace('psTreePids ' + rootPid + ' pids: ' + err);
    callback(null, pids);
  });
}

function psTreeUsageSum(rootPid, callback) {
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

function updateProcessStats() {
  log.trace('updateProcessStats start');
  psList().then(function (psListData) {
    log.trace('updateProcessStats got_data');
    Process.find({pid: {$exists: true, $ne: ''}}).forEach(function (process) {
      var psListItem = _.findWhere(psListData, {pid: process.pid});
      psTreeUsageSum(process.pid, Meteor.bindEnvironment(function (usageErr, usageData) {
        recordLog('system', 'info','usageErr', usageErr+!usageErr+false);
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
      }));
    });
  });
}

function registerProcess(name, pid, cb) {
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
    }, function () {
      updateProcessStats();
      cb();
    });
}

Meteor.setInterval(updateProcessStats, 1000);

Meteor.publish('processes', function () {
  return Process.find();
});

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

    fs.createWriteStream(logfile(name, 'stdout'), {flags: 'a'}).on('open', Meteor.bindEnvironment(function (stdOutFd) {
      fs.createWriteStream(logfile(name, 'stderr'), {flags: 'a'}).on('open', Meteor.bindEnvironment(function (stdErrFd) {
        childProcess = spawn(expandHomeDir(procfileEntry.cmd), procfileEntry.args, {
          env: _.extend(
            {},
            {HOME: process.env.HOME},
            procfileEntry.env
          ),
          stdio: ['ignore', stdOutFd, stdErrFd],
          cwd: expandHomeDir('~/.prezi/please')
        });
        recordLog('system', 'info', 'Started ' + name);
        registerProcess(name, childProcess.pid, function () {
          done();
        });
      }));
    }));
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
    });
  },

  'process/start-all': function () {
    log.info('process/start-all');
    _.each(Process.find({status: {$ne: 'running'}}).fetch(), function (process) {
      Meteor.call('process/start', process.name);
    });
  },

  'process/kill-all': function (signal) {
    log.info('process/kill-all ' + signal);
    _.each(Process.find({status: 'running'}).fetch(), function (process) {
      Meteor.call('process/kill', process.name, signal);
    });
  }
});
