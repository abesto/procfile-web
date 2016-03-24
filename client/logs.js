Template.Logs.helpers({
  fmtTimestamp: function(timestamp) {
    return moment(timestamp).format('HH:mm:ss.SSS');
  }
});

Template.Logs.events({
  'keypress #stdin-txt': function (evt) {
    if (evt.which === 13) {
      var
        procname = $('#procname-for-stdin').val(),
        txt = $('#stdin-txt').val().trim();
      $('#stdin-txt').val('');
      Meteor.call('process/stdin', procname, txt);
    }
  }
});

Template.Logs.rendered = function () {
  var $container = $('.logs-container').height($(window).height() - 150);
  Proclog.find().observeChanges({
    added: function() {
      $container.scrollTop($container.prop('scrollHeight'));
    }
  });
};
