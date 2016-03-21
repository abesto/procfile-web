var
  fs = Meteor.npmRequire('fs'),
  procfile = Meteor.npmRequire('procfile-parser');

function loadProcfile(tag) {
  var rawContent = Assets.getText('Procfile');
  return {
    tag: tag,
    path: 'assets/Procfile',
    loadedAt: new Date(),
    rawContent: rawContent,
    content: procfile.parse(rawContent)
  };
}

Meteor.startup(function () {
  Procfile.remove({tag: 'current'});

  var procfile = loadProcfile('current');
  Procfile.insert(procfile);

  _(procfile.content).each(function (spec) {
    Process.upsert(
      {name: spec.name},
      {$set: spec}
    );
    tailLogs(spec.name);
  });
});

Meteor.publish('procfile', function () {
  return Procfile.find({tag: 'current'});
});
