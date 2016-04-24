import 'bootstrap-switch/dist/css/bootstrap3/bootstrap-switch.min';
import 'clusterize.js/clusterize.css';

import { Session } from 'meteor/session';
import { Template } from 'meteor/templating';
import { Meteor } from 'meteor/meteor';
import { ReactiveVar } from 'meteor/reactive-var';
import { $ } from 'meteor/jquery';
import { _ } from 'meteor/underscore';

import moment from 'moment';
import 'bootstrap-switch';
import Clusterize from 'clusterize.js';
import async from 'async';

import { Process } from '/shared/process';
import { Proclog } from '/shared/proclog';

// Avoiding reactive templates here for performance
function renderRow(log) {
  return '<tr class="logline ' + log.app + '-' + log.channel + ' ' + log.app + '" data-app="' + log.app + '" data-channel="' + log.channel + '">' +
    '<td class="timestamp">' +  moment(log.timestamp).format('HH:mm:ss.SSS') + '</td>' +
    '<td><span class="app">' + log.app + '</span>/<span class="channel">' + log.channel + '</span></td>' +
    '<td class="message">' + log.message + '</td>' +
    '</tr>';
}

var trHighlighter = (function () {
// And using newish APIs to do what would be trivial with reactive templates
  var stylesheetEl = document.createElement('style'), stylesheet;
  document.head.appendChild(stylesheetEl);
  stylesheet = stylesheetEl.sheet;

  function removeHighlight () {
    while (stylesheet.cssRules.length > 0) {
      stylesheet.deleteRule(0);
    }
  }

  return {
    highlight: function (app, channel) {
      removeHighlight();
      stylesheet.insertRule('.logline.' + app + '-' + channel + ' { background-color: #222; }', 0);
      stylesheet.insertRule('.logline.' + app + ' { background-color: #151515; }', 0);
    },
    removeHighlight: removeHighlight
  };
})();


function hideLogSessionKey(app, channel) {
  return 'hideLog/' + app + '/' + channel;
}

function isLoglineShown(log) {
  return !Session.get(hideLogSessionKey(log.app, log.channel));
}

var fdNames = ['stdin', 'stdout', 'stderr'];

Template.Logs.helpers({
  statusChecked: function (process) {
    if (process.status === 'running') {
      return 'checked';
    }
  },

  fdNames: function () {
    return fdNames;
  },

  channelFilterActiveClass: function (app, channel) {
    if (isLoglineShown({app: app, channel: channel})) {
      return 'active';
    }
  },

  followLogsActiveClass: function () {
    return Template.instance().followLogs() ? 'active' : '';
  },

  stdinProcess: function() {
    var val = Session.get('stdin-process');
    if (!val || Process.findOne({name: val}).status !== 'running') {
      var newProcess = Process.findOne({status: 'running'});
      if (!newProcess) {
        return;
      }
      val = newProcess.name;
      Session.set('stdin-process', val);
    }
    return val;
  }
});

Template.Logs.events({
  // STDIN
  'keypress #stdin-txt': function (evt) {
    if (evt.which === 13) {
      var
        procname = Session.get('stdin-process'),
        $txt = $(evt.target),
        txt = $txt.val().trim();
      $txt.val('');
      Meteor.call('process/stdin', procname, txt);
    }
  },
  'click .set-stdin-process': function (evt) {
    Session.set('stdin-process', $(evt.target).text());
  },

  // Start / stop processes
  'switchChange.bootstrapSwitch .make-switch': function (evt) {
    var
      $input = $(evt.target),
      process = $input.data('process');
    if ($input.prop('checked')) {
      Meteor.call('process/start', process);
    } else {
      Meteor.call('process/kill', process, 'SIGTERM');
    }
  },

  // Filter by channel
  'click .channel-filter': function (evt) {
    var
      $btn = $(evt.target),
      app = $btn.data('app'),
      channel = $btn.data('channel'),
      key = hideLogSessionKey(app, channel);
    Session.set(key, !Session.get(key));
  },

  // Filter by add
  'click .process-name': function (evt) {
    // Hide all channels if any channels are shown. Show all channels if all channels are hidden.
    var
      $target = $(evt.target),
      app = $target.text(),
      newValue = !_.every(fdNames, function (name) {
        return !!Session.get(hideLogSessionKey(app, name));
      });
    _.forEach(fdNames, function (name) {
      Session.set(hideLogSessionKey(app, name), newValue);
    });
  },

  // Follow logs
  'click .follow-logs': function () {
    var followLogs = Template.instance().followLogs;
    followLogs(!followLogs());
  },

  // Highlight logs of the same process
  'mouseenter .logline': function (evt) {
    var $el = $(evt.target);
    trHighlighter.highlight($el.data('app'), $el.data('channel'));
  },
  'mouseleave .logline': trHighlighter.removeHighlight
});

Template.Logs.onCreated(function () {
  var that = this;
  this.isFollowingLogs = new ReactiveVar(true);
  this.followLogs = function (arg) {
    if (_.isUndefined(arg)) {
      return that.isFollowingLogs.get();
    } else {
      throw "Can't set followLogs before onRendered event";
    }
  };
});

Template.Logs.onRendered(function () {
  var
    $scrollArea = this.$('.logs-container'),
    $contentArea = $scrollArea.find('tbody'),
    resizeLogsContainer, scrollToBottom, stopObservingLogsForScroll,
    that = this;

  // Logs scroll area size
  resizeLogsContainer = _.debounce(function () {
    var targetHeight = $(window).height() - 170;
    $scrollArea
      .css('max-height', targetHeight)
      .css('height', targetHeight);
  });
  resizeLogsContainer();
  $(window).resize(resizeLogsContainer);

  // "Follow logs" functionality
  this.followLogs = function (arg) {
    if (_.isUndefined(arg)) {
      // Getter
      return that.isFollowingLogs.get();
    } else {
      // Setter, with some logic
      that.isFollowingLogs.set(arg);
      if (arg) {
        // Start following
        stopObservingLogsForScroll = Proclog.find().observeChanges({added: scrollToBottom}).stop;
        // If user scrolls away, stop following
        $scrollArea.on('scroll', scrollHandler);
      } else {
        // Stop following
        stopObservingLogsForScroll();
        // Don't care if user scrolls, we're not following anyway
        $scrollArea.off('scroll', scrollHandler);
      }
    }
  };
  function scrollHandler() {
    if ($scrollArea.prop('scrollHeight') > $scrollArea.prop('scrollTop') + $scrollArea.height()) {
      that.followLogs(false);
    }
  }
  scrollToBottom = _.debounce(function () {
    if (!that.followLogs()) {
      return;
    }
    $scrollArea.scrollTop($scrollArea.prop('scrollHeight'));
  }, 100);
  this.followLogs(true);

  // Clusterize takes care of infinite scrolling: it ensures there's only a screenful of logs in the DOM
  this.clusterize = new Clusterize({
    scrollElem: $scrollArea[0],
    contentElem: $contentArea[0],
    tag: 'tr'
  });

  // async.cargo, with the timeout, throttles the render calls; it collects all the logs that came in within
  // 100ms, and hands them off to clusterize in a single go, minimizing DOM updates
  var clusterizeCargo = async.cargo(function (rows, cb) {
    that.clusterize.append(rows);
    setTimeout(cb, 100);
  });

  // Sometimes we need to rerender the whole table from scratch
  this.rerenderLogs = _.debounce(function () {
    that.clusterize.update(
      _(Proclog.find().fetch()).filter(isLoglineShown).map(renderRow)
    );
  }, 100);


  // Handle incoming logs
  Proclog.find().observe({
    added: function (log) {
      if (!isLoglineShown(log)) {
        return;
      }
      var rendered = renderRow(log);
      clusterizeCargo.push(rendered);
    },
    changed: function () {
      // Re-render. Needed due to the way clusterize.js is implemented
      that.rerenderLogs();
    }
  });

  // Initialize on/off switches
  this.$('.make-switch').each(function () {
    var $this = $(this);
    $this.bootstrapSwitch();
    Process.find({name: $this.data('process')}).observeChanges({
      changed: _.debounce(function (_, fields) {
        if (fields.hasOwnProperty('status')) {
          $this.bootstrapSwitch('state', fields.status === 'running', true);
        }
      }, 100)
    });
  });

  // Re-render on filter changes
  this.autorun(function () {
    // Set up dependencies
    Process.find().forEach(function (process) {
      _.each(fdNames, function (fdName) {
        Session.get(hideLogSessionKey(process.name, fdName));
      });
    });
    // Do this whenever they change
    that.rerenderLogs();
  });
});
