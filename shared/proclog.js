import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

export var Proclog = new Mongo.Collection('log');

Meteor.methods({
  'logs/clear': function () {
    return Proclog.remove({});
  }
});
