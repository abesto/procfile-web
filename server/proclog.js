recordLog = Meteor.bindEnvironment(function recordLog(app, channel, message) {
  var record = {app: app, channel: channel, message: message, timestamp: new Date()};
  Proclog.insert(record);
});

Meteor.publish('logs', function () {
  return Proclog.find({}, {sort: {timestamp: 1}});
});

Meteor.startup(function () {
  Proclog.remove({});
});
