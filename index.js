const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const zlib = require('zlib');
const child_process = require('child_process');

const express = require('express');
const tmp = require('tmp');
const tarFs = require('tar-fs');
const httpProxy = require('http-proxy');
const yarnPath = require.resolve('yarn/bin/yarn.js');
const AWS = require('aws-sdk');

const port = process.env['PORT'] || 8000;
const BUCKET = 'files.webmr.io';

const s3 = new AWS.S3();

const app = express();
app.get('/', (req, res, next) => {
  res.end('Hello, webmr registry!\n');
});
app.get('/projects', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  // res.json(Object.keys(bindings).map(k => bindings[k]));
});
const _uploadDirectory = (p, basePath, prefix) => new Promise((accept, reject) => {
  const fullPath = path.join(basePath, p);

  fs.readdir(fullPath, async (err, files) => {
    if (!err) {
      if (files.length > 0) {
        for (const fileName of files) {
          const p2 = path.join(p, fileName);
          const fullPath2 = path.join(basePath, p2);

          await new Promise((accept, reject) => {
            fs.lstat(fullPath2, (err, stats) => {
              if (stats.isDirectory()) {
                _uploadDirectory(p2, basePath, prefix)
                  .then(accept, reject);
              } else {
                _uploadFile(p2, basePath, prefix)
                  .then(accept, reject);
              }
            });
          });
        }

        accept();
      } else {
        accept();
      }
    } else {
      reject(err);
    }
  });
});
const _uploadFile = (p, basePath, prefix) => new Promise((accept, reject) => {
  const fullPath = path.join(basePath, p);
  s3.upload({
    Bucket: BUCKET,
    Key: path.join(prefix, p),
    Body: fs.createReadStream(fullPath),
  }, err => {
    if (!err) {
      accept();
    } else {
      reject(err);
    }
  });
});
app.put('/projects/:username/:module', (req, res, next) => {
  const {username, module} = req.params;

  if (/^[a-z0-9]+$/i.test(username) && /^[a-z0-9\-]+$/i.test(module)) {
    tmp.dir((err, p, cleanup) => {
      const us = req.pipe(zlib.createGunzip());
      us.on('error', err => {
        res.status(500);
        res.end(err.stack);
        cleanup();
      });
      const ws = us.pipe(tarFs.extract(p));

      ws.on('finish', () => {
        const packageJsonPath = path.join(p, 'package.json');

        fs.readFile(packageJsonPath, (err, s) => {
          if (!err) {
            const packageJson = JSON.parse(s);
            const {description = null} = packageJson;
            const version = '0.0.1'; // XXX support multiple versions

            const yarnProcess = child_process.spawn(
              process.argv[0],
              [
                yarnPath,
                'install',
                '--production',
                '--mutex', 'file:' + path.join(os.tmpdir(), '.intrakit-yarn-lock'),
              ],
              {
                cwd: p,
                env: process.env,
              }
            );
            yarnProcess.stdout.pipe(process.stdout);
            yarnProcess.stderr.pipe(process.stderr);
            yarnProcess.on('exit', async code => {
              console.log('yarn exit code', code);

              if (code === 0) {
                _uploadDirectory('/', p, `${username}/${module}`)
                  .then(() => {
                    res.json({
                      username,
                      module,
                      description,
                      version,
                    });
                  })
                  .catch(err => {
                    res.status(500);
                    res.end(err.stack);
                    cleanup();
                  });
              } else {
                res.status(500);
                res.end(new Error('npm publish exited with status code ' + code).stack);
                cleanup();
              }
            });
          } else if (err.code === 'ENOENT') {
            res.status(400);
            res.end(http.STATUS_CODES[400]);
            cleanup();
          } else {
            res.status(500);
            res.end(err.stack);
            cleanup();
          }
        });
      });
      req.on('error', err => {
        res.status(500);
        res.end(err.stack);
        cleanup();
      });
    }, {
      keep: true,
      unsafeCleanup: true,
    });
  } else {
    res.status(400);
    res.end(http.STATUS_CODES[400]);
  }
});
/* app.get('*', (req, res, next) => {
  const module = match[1];
  const username = match[2];
  const binding = bindings[`${username}/${module}`];

  if (binding) {
    let {path: p} = req;
    console.log('got path', p);
    if (p === '/') {
      p = '/index.html';
    }
    const rs = fs.createReadStream(path.join(binding.installDirectory, p));
    rs.pipe(res);
    rs.on('error', err => {
      if (err.code === 'ENOENT') {
        const {port} = binding;

        const proxy = httpProxy.createProxyServer();
        proxy.web(req, res, {
          target: `http://127.0.0.1:${port}`,
        });
        proxy.on('error', err => {
          res.status(404);
          res.end(http.STATUS_CODES[404]);
        });
      } else {
        res.status(500);
        res.end(err.stack);
      }
    });
  } else {
    next();
  }
}); */
http.createServer(app)
  .listen(port);

process.on('uncaughtException', err => {
  console.warn(err);
});
/* global.s3 = s3;
require('repl').start(); */
