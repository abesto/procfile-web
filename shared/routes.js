import { Meteor } from 'meteor/meteor';
import { Router } from 'meteor/iron:router';

import { Procfile } from '/shared/procfile';
import { Process } from '/shared/process';
import { Proclog } from '/shared/proclog';

Router.configure({
  layoutTemplate: 'Layout'
});

Router.route('/', function () {
  this.redirect('/home');
}, {
  name: 'root'
});

Router.route('/procfile', {
  data: function () {
    var procfile = Procfile.findOne({tag: 'current'});
    if (procfile) {
      return {
        path: procfile.path,
        rawContent: procfile.rawContent,
        content: JSON.stringify(procfile.content, null, 4)
      };
    }
  },
  waitOn: function () { return Meteor.subscribe('procfile'); },
  name: 'procfile'
});

Router.route('/processes', {
  data: function () { return {processes: Process.find()}; },
  waitOn: function () { return Meteor.subscribe('processes'); },
  name: 'processes'
});

Router.route('/home', {
  data: function () {
    return {
      logs: Proclog.find({}),
      runningProcesses: Process.find({status: 'running'}),
      processes: Process.find({})
    };
  },
  waitOn: function () {
    return [
      Meteor.subscribe('logs'),
      Meteor.subscribe('processes')
    ];
  },
  name: 'logs'
});
