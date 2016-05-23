import { Mongo } from 'meteor/mongo';
import { SimpleSchema } from 'meteor/aldeed:simple-schema';

export var Procfile = new Mongo.Collection('procfile');
export var ProcfileEntry = new Mongo.Collection('procfile-entry');

Procfile.attachSchema(new SimpleSchema({
  tag: { type: String },
  path: { type: String },
  loadedAt: { type: Date },
  rawContent: { type: String }
}));

ProcfileEntry.attachSchema(new SimpleSchema({
  procfileId: { type: String },
  cmd: { type: String },
  args: { type: [String] },
  env: { type: Object, blackbox: true },
  raw: { type: String, optional: true },
  name: { type: String }
}));

Procfile.helpers({
  entries: function () {
    return ProcfileEntry.find({procfileId: this._id});
  },
  entry: function (procName) {
    return ProcfileEntry.findOne({procfileId: this._id, name: procName});
  }
});
