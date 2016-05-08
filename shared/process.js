import { Mongo } from 'meteor/mongo';
import { SimpleSchema } from 'meteor/aldeed:simple-schema';

export var Process = new Mongo.Collection('process');

Process.attachSchema(new SimpleSchema({
  name: {
    type: String,
    unique: true
  },
  args: {
    type: [String]
  },
  pid: {
    type: Number,
    optional: true,
    defaultValue: null
  },
  started: {
    type: Date,
    optional: true,
    defaultValue: null
  },
  status: {
    type: String,
    allowedValues: ['running', 'stopped'],
    optional: true,
    defaultValue: null
  },
  cmd: {
    type: String
  },
  memory: {
    type: Number,
    decimal: true,
    optional: true,
    defaultValue: null
  },
  cpu: {
    type: Number,
    decimal: true,
    optional: true,
    defaultValue: null
  }
}));
