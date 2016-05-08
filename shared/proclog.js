import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { SimpleSchema } from 'meteor/aldeed:simple-schema';

export var Proclog = new Mongo.Collection('log');

Proclog.attachSchema(new SimpleSchema({
  app: { type: String },
  channel: { type: String },
  message: { type: String },
  timestamp: { type: Date },
  withoutNewline: { type: Boolean }
}));

Meteor.methods({
  'logs/clear': function () {
    return Proclog.remove({});
  }
});
