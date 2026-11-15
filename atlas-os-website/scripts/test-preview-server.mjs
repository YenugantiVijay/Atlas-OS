import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getPreviewVersion, previewVersionHeader } from './dev-preview-version.mjs';

const home = path.resolve(import.meta.dirname, '..');
const execFileAsync = promisify(execFile);
const getPort = () => new Promise(resolve => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const get = (port, uri, method = 'GET') => new Promise((resolve, reject) => {
  const req = request({hostname:'127.0.0.1',port,path:uri,method}, res => {
    let body='';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({status:res.statusCode,body,headers:res.headers}));
  });
  req.on('error', reject);
  req.end();
});

test('launcher accepts the current dev server and rejects stale previews with identical homepage markup', async () => {
  const homepage = '<html><title>Atlas OS</title>' + ' '.repeat(145000) +
    '<main class="capability-orbit">Connected Business Workflow</main></html>';
  let version = getPreviewVersion();
  const server = createServer((_request, response) => {
    if (version) response.setHeader(previewVersionHeader, version);
    response.end(homepage);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const probe = () => execFileAsync(process.execPath, ['scripts/wait-for-website.mjs', '--probe', `--port=${port}`], { cwd: home });
  try {
    await probe();
    version = 'different-checkout-or-revision';
    await assert.rejects(probe(), { code: 2, stderr: /different or older preview/ });
    version = '';
    await assert.rejects(probe(), { code: 2, stderr: /different or older preview/ });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  await assert.rejects(probe(), { code: 1 });
});

test('website preview serves only built files and blocks file traversal', {timeout: 20000}, async () => {
  await stat(path.resolve(home, 'dist/index.html'));
  const port = await getPort();
  const child = spawn(process.execPath, ['scripts/serve-preview.mjs'], {
    cwd: home, env:{...process.env,PORT:String(port)}, stdio:'ignore'
  });
  try {
    let started=false;
    for(let attempt=0;attempt<100;attempt++){
      try{if((await get(port,'/')).status===200){started=true;break;}}catch{}
      if(child.exitCode!==null)break;
      await new Promise(done=>setTimeout(done,40));
    }
    assert.equal(started,true,'preview server started');
    assert.equal((await get(port,'/favicon.svg')).status,200);
    for(const uri of ['/../README.md','/%2e%2e/README.md','/..%5cREADME.md','/%2e%2e/%2e%2e/etc/passwd']){
      const response=await get(port,uri);
      assert.equal(response.status,403,'blocked '+uri);
      assert.ok(!response.body.includes('ATLAS OS'), 'did not serve application source');
    }
    assert.equal((await get(port,'/%ZZ')).status,400);
    assert.equal((await get(port,'/totally-missing-page')).status,404);
    assert.equal((await get(port,'/index.html','POST')).status,405);
    const head=await get(port,'/favicon.svg','HEAD');
    assert.equal(head.status,200);
    assert.equal(head.body,'');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if(child.exitCode!==null)resolve();
      else child.once('exit',resolve);
    });
  }
});
