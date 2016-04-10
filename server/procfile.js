import fs from 'fs';

import { Meteor } from 'meteor/meteor';
import { Logger } from 'meteor/jag:pince';
import { _ } from 'lodash';

import procfile from 'procfile-parser';
import expandHomeDir from 'expand-home-dir';

import { Process } from '/shared/process';
import { Procfile } from '/shared/procfile';

var log = new Logger('server.procfile');

function loadProcfile(tag) {
  var
    path = Meteor.settings.procfilePath,
    rawContent;
  if (!path) {
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
  Process.remove({});

  var procfile = loadProcfile('current');
  _(procfile.content).each(function (spec) {
    if (spec.cmd.startsWith('$$')) {
      spec.args.unshift(Assets.absoluteFilePath(spec.cmd.substring(2)));
      spec.cmd = 'bash';
    }
    Process.upsert(
      {name: spec.name},
      {$set: spec}
    );
  });

  Procfile.insert(procfile);

  if (Meteor.settings.startAllProcessesOnBoot) {
    log.info('Starting all processes on boot (settings.startAllProcessesOnBoot)');
    Meteor.call('process/start-all');
  }
});

Meteor.publish('procfile', function () {
  return Procfile.find({tag: 'current'});
});
