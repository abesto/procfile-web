import 'bootstrap-switch';

function hideLogSessionKey(app, channel) {
  return 'hideLog/' + app + '/' + channel;
}

function isLoglineShown(app, channel) {
  return !Session.get(hideLogSessionKey(app, channel));
}

function scrollLogsToBottom() {
  var $container = $('.logs-container').height($(window).height() - 170);
  $container.scrollTop($container.prop('scrollHeight'));
}


Template.Logs.helpers({
  fmtTimestamp: function (timestamp) {
    return moment(timestamp).format('HH:mm:ss.SSS');
  },

  statusChecked: function (process) {
    if (process.status === 'running') {
      return 'checked';
    }
  },

  fdNames: function () {
    return ['stdin', 'stdout', 'stderr'];
  },

  showLogline: function(app, channel) {
    return isLoglineShown(app, channel);
  },

  channelFilterActiveClass: function(app, channel) {
    if (isLoglineShown(app, channel)) {
      return 'active';
    }
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
  'keypress #stdin-txt': function (evt) {
    if (evt.which === 13) {
      var
        procname = Session.get('stdin-process'),
        txt = $('#stdin-txt').val().trim();
      $('#stdin-txt').val('');
      Meteor.call('process/stdin', procname, txt);
    }
  },

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

  'click .channel-filter': function (evt) {
    var
      $btn = $(evt.target),
      app = $btn.data('app'),
      channel = $btn.data('channel'),
      key = hideLogSessionKey(app, channel);
    Session.set(key, !Session.get(key));

    // Dsiabling filters can cause more log lines to appear, so we need to re-scroll (but yield so the lines appear first)
    setTimeout(scrollLogsToBottom, 0);
  },

  'click .set-stdin-process': function (evt) {
    Session.set('stdin-process', $(evt.target).text());
  }
});

Template.Logs.onRendered(function () {
  // Keep logs scrolled to bottom
  Proclog.find().observeChanges({added: scrollLogsToBottom});

  // Initialize on/off switches
  this.$('.make-switch').each(function () {
    var $this = $(this);
    $this.bootstrapSwitch();
    Process.find({name: $this.data('process')}).observeChanges({
      changed: function (_, fields) {
        if (fields.hasOwnProperty('status')) {
          $this.bootstrapSwitch('state', fields.status === 'running', true);
        }
      }
    });
  });
});
