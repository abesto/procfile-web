Router.configure({
  layoutTemplate: 'Layout'
});

Router.route('/', function () {
  this.redirect('/processes');
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
  waitOn: function () { return Meteor.subscribe('procfile'); }
});

Router.route('/processes', {
  data: function () { return {processes: Process.find()}; },
  waitOn: function () { return Meteor.subscribe('processes'); }
});

Router.route('/logs', {
  data: function () {
    return {
      logs: Proclog.find({}, {sort: {timestamp: 1}}),
      processes: Process.find({status: 'running'})
    };
  },
  waitOn: function () {
    return [
      Meteor.subscribe('logs'),
      Meteor.subscribe('processes')
    ];
  }
});
