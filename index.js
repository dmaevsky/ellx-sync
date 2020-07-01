const fs = require('fs');
const process = require('process');
const core = require('@actions/core');

const walk = function(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
      file = dir + '/' + file;
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) {
          results = results.concat(walk(file));
      } else {
          results.push(file);
      }
  });
  return results;
};

const contents = new Map();

const serverPath = p => '/' + p.slice(2);

function hashAndCache(p) {
  const content = fs.readFileSync(p, 'UTF-8');

  contents.set(serverPath(p), content);

  return require('md5')(content);
}

function getContentType(id) {
  if (/\.(js|ellx)$/.test(id)) {
    return 'text/javascript';
  }
  if (/\.(md)$/.test(id)) {
    return 'text/plain';
  }
  return 'text/plain';
}

async function sync()  {
  const repo = process.env.GITHUB_REPOSITORY;
  const project = repo.split('/')[0];
  const server = core.getInput('ellxUrl');
  const key = core.getInput('key');

  const fetch = require('node-fetch');

  const files = walk('.')
    .filter(name => !name.startsWith('./.git'))
    .map(path => ({
      path: serverPath(path),
      hash: hashAndCache(path),
    }));

  const authorization = `${project},${repo.replace('/', '-')},${key}`;

  const res = await fetch(
    server + `/sync/${repo}`,
    {
      method: 'PUT',
      body: JSON.stringify({ files, title: project, acl: 'public' }),
      // TODO: auth header from env
      // for now need to copy valid token from client
      headers: {
        authorization,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    const message = await res.json();
    console.error(res.status, message.error ? message.error : message);
    return;
  }

  const urls = await res.json();

  const uploads = await Promise.all(
    urls.map(
      async ({ path, uploadUrl }) => fetch(uploadUrl, {
        method: 'PUT',
        body: contents.get(path),
        headers: {
          'Content-Type': getContentType(path),
          'Cache-Control': 'max-age=31536000'
        },
      })
    )
  );

  if (uploads.every(i => i.ok)) {
    console.log(
      'Synced following files successfully:\n',
    );

    core.setOutput('files', urls.map(({ path }) => path.slice(1)));
  } else {
    core.setFailed(
      'Error uploading files',
      await Promise.all(uploads.map(async r => r.json()))
    );
  }
}

try {
  sync();
} catch (error) {
  core.setFailed(error.message);
}