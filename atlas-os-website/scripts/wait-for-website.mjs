import http from 'node:http';

const URL = 'http://127.0.0.1:4321/';
const probeOnly = process.argv.includes('--probe');

function probe() {
  return new Promise((resolve) => {
    const req = http.get(URL, { timeout: 1400 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 120000) res.destroy();
      });
      res.on('end', () => {
        // Do not open an unrelated application that happens to occupy port 4321.
        resolve(res.statusCode === 200 &&
          /<title>[^<]*Atlas OS/i.test(body) &&
          /<html/i.test(body));
      });
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

if (probeOnly) {
  process.exit((await probe()) ? 0 : 1);
}

let ready = false;
for (let attempt = 0; attempt < 50; attempt += 1) {
  if (await probe()) {
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
}

if (!ready) {
  console.error('[ERROR] Atlas OS website did not become available at ' + URL);
  console.error('Open the "Atlas OS Website Live Server" terminal to inspect any startup error.');
  console.error('The browser was NOT opened because this address is not serving the website.');
  process.exit(1);
}

console.log('[OK] Verified the actual Atlas OS homepage at ' + URL);
