var
  Tail = Meteor.npmRequire('tail').Tail,
  touch = Meteor.npmRequire('touch'),
  logdir = Meteor.settings.logDir || '/tmp/',
  path = Npm.require('path');

logfile = function logfile(app, channel) {
  return path.join(logdir, app + '_' + channel + '.log');
};

recordLog = Meteor.bindEnvironment(function recordLog(app, channel, message) {
  var record = {app: app, channel: channel, message: message, timestamp: new Date()};
  Proclog.insert(record);
});

tailLogs = function tailLogs(app) {
  _(['stdout', 'stderr']).each(function (channel) {
    var log = new Logger(app + '.' + channel);
    var file = logfile(app, channel);
    touch.sync(file);
    new Tail(file, {follow: true}).on('line', Meteor.bindEnvironment(function (line) {
      log.info(line);
      recordLog(app, channel, line);
    }));
  });
};

Meteor.publish('logs', function () {
  return Proclog.find({}, {sort: {timestamp: 1}});
});

Meteor.startup(function () {
  Proclog.remove({});
});
