import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { Spacebars } from 'meteor/spacebars';
import $ from 'jquery';

import moment from 'moment';


Template.Processes.helpers({
  megabytes: function(bytes) {
    if (bytes) {
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    } else {
      return '';
    }
  },

  round: function(n) {
    return Math.round(n);
  },

  isRunning: function(status) {
    return status === 'running';
  },

  livestampOrEmpty: function(date) {
    // Special case: don't display anything if date is not set
    if (!date) {
      return;
    }

    // Copy-paste from livestamp template helper
    var time = moment(date);
    if(!time.isValid()) {
      time = moment();
    }
    var timestamp = time.toISOString(),
      timestring = time.fromNow();
    return new Spacebars.SafeString('<span class="livestamp" data-livestamp="'+ timestamp  +'">'+timestring+'</span>');
  }
});

Template.Processes.events({
  'click button.start': function (event) {
    Meteor.call('process/start', $(event.target).data('name'));
  },
  'click button.kill': function (event) {
    var $target = $(event.target);
    Meteor.call('process/kill', $target.data('name'), $target.data('signal'));
  },
  'click button.start-all': function () {
    Meteor.call('process/start-all');
  },
  'click button.kill-all': function (event) {
    var $target = $(event.target);
    Meteor.call('process/kill-all', $target.data('signal'));
  }
});
