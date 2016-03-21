Template.Logs.helpers({
  fmtTimestamp: function(timestamp) {
    return moment(timestamp).format('HH:mm:ss.SSS');
  }
});
