import { Meteor } from 'meteor/meteor';
import { _ } from 'lodash';
import async from 'async';

import { Proclog } from '/shared/proclog';

export var findLogWithoutNewline = Meteor.bindEnvironment(function(app, channel) {
  return Proclog.findOne({app: app, channel: channel, withoutNewline: true});
});

var doRecordLog = Meteor.bindEnvironment(function recordLog(data, cb) {
  var
    app = data.app,
    channel = data.channel,
    message = data.message,
    withoutNewline = data.withoutNewline,
    logWithoutNewline = data.logWithoutNewline;
  withoutNewline = !!withoutNewline;
  if (_.isUndefined(logWithoutNewline)) {
    logWithoutNewline = findLogWithoutNewline(app, channel);
  }
  if (logWithoutNewline) {
    Proclog.update(
      {_id: logWithoutNewline._id},
      {$set: {message: logWithoutNewline.message + message, withoutNewline: withoutNewline}},
      cb);
  } else {
    Proclog.insert({
      app: app,
      channel: channel,
      message: message,
      timestamp: new Date(),
      withoutNewline: withoutNewline
    }, cb);
  }
});

var recordLogQueue = async.queue(doRecordLog, 1);
export var recordLog = function (app, channel, message, withoutNewline, logWithoutNewline) {
  recordLogQueue.push({
    app: app,
    channel: channel,
    message: message,
    withoutNewLine: withoutNewline,
    logWithoutNewline: logWithoutNewline
  });
};

export var closeLines = Meteor.bindEnvironment(function closeLines(app) {
  Proclog.update({app: app, withoutNewline: true}, {$set: {withoutNewline: false}});
});

Meteor.publish('logs', function () {
  return Proclog.find({}, {sort: {timestamp: 1}});
});

Meteor.startup(function () {
  Proclog.remove({});
});
