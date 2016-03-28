WIP. This project will ideally grow up to be a browser-based tool for managing Procfile-described service groups during development.

This is not ready for your eyes yet. If you want to play around anyway, you can:

```
cd procfile-web
curl https://install.meteor.com/ | sh
meteor
```

## Configuration

This Meteor app can be configured as described in [Meteor.settings](http://docs.meteor.com/#/full/meteor_settings).
The available fields:

| Field    | Default | Description |
|----------|---------|-------------|
| `procfilePath` | Load bundled Procfile from [`private/Procfile.example`](private/Procfile.example) | Path of the `Procfile` to load at startup |
