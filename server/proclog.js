recordLog = Meteor.bindEnvironment(function recordLog(app, channel, message, withoutNewline) {
  withoutNewline = !!withoutNewline;
  var existingRecord = Proclog.findOne({app: app, channel: channel, withoutNewline: true});
  if (existingRecord) {
    Proclog.update({_id: existingRecord._id}, {$set: {message: existingRecord.message + message, withoutNewline: withoutNewline}});
  } else {
    Proclog.insert({app: app, channel: channel, message: message, timestamp: new Date(), withoutNewline: withoutNewline});
  }
});

closeLines = Meteor.bindEnvironment(function closeLines(app) {
  Proclog.update({app: app, withoutNewline: true}, {$set: {withoutNewline: false}});
});

Meteor.publish('logs', function () {
  return Proclog.find({}, {sort: {timestamp: 1}});
});

Meteor.startup(function () {
  Proclog.remove({});
});
