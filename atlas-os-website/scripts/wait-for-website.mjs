import http from 'node:http';
import { getPreviewVersion, previewVersionHeader } from './dev-preview-version.mjs';

const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] ?? 4321);
const url = `http://127.0.0.1:${port}/`;
const probeOnly = process.argv.includes('--probe');
const expectedVersion = getPreviewVersion();

function probe() {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1400, headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.headers[previewVersionHeader] !== expectedVersion) {
        res.resume();
        resolve('occupied');
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        // Astro's development HTML includes inline styles ahead of these markers.
        if (body.length < 512000) body += chunk.slice(0, 512000 - body.length);
      });
      res.on('end', () => {
        const ready = res.statusCode === 200 &&
          /<title>[^<]*Atlas OS/i.test(body) &&
          body.includes('capability-orbit') &&
          body.includes('Connected Business Workflow');
        resolve(ready ? 'ready' : 'waiting');
      });
      res.on('error', () => resolve('waiting'));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve('waiting'));
  });
}

let status = await probe();
for (let attempt = 1; !probeOnly && status === 'waiting' && attempt < 50; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 350));
  status = await probe();
}

if (status === 'occupied') {
  console.error(`[ERROR] Port ${port} is serving a different or older preview.`);
  console.error('Close the terminal running that preview, then open preview-website.cmd again from this checkout.');
  process.exit(2);
}

if (status !== 'ready') {
  if (!probeOnly) {
    console.error('[ERROR] Atlas OS website did not become available at ' + url);
    console.error('Open the "Atlas OS Website Live Server" terminal to inspect the startup error.');
  }
  process.exit(1);
}

if (!probeOnly) console.log('[OK] Verified the Atlas OS preview from this checkout at ' + url);
