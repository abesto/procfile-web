var
  fs = Meteor.npmRequire('fs'),
  procfile = Meteor.npmRequire('procfile-parser'),
  expandHomeDir = Meteor.npmRequire('expand-home-dir'),
  log = new Logger('server.procfile');

function loadProcfile(tag) {
  var
    path = Meteor.settings.procfilePath,
    rawContent;
  if (path === null) {
    path = 'assets/Procfile.example';
    rawContent = Assets.getText('Procfile.example');
  } else {
    path = expandHomeDir(path);
    rawContent = fs.readFileSync(path).toString();
  }
  log.info('Loaded Procfile from ' + path);
  return {
    tag: tag,
    path: path,
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
