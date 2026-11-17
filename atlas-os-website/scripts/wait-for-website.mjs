import http from 'node:http';
import net from 'node:net';
import { getPreviewVersion, previewVersionHeader } from './dev-preview-version.mjs';

const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] ?? 4321);
const url = `http://127.0.0.1:${port}/`;
const probeOnly = process.argv.includes('--probe');
const selectPort = process.argv.includes('--select-port');
const expectedVersion = getPreviewVersion();

function probe(candidatePort) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${candidatePort}/`, { timeout: 1400, headers: { 'Cache-Control': 'no-cache' } }, (res) => {
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
          body.includes('home-overview') &&
          body.includes('Connected Business Workflow');
        resolve(ready ? 'ready' : 'waiting');
      });
      res.on('error', () => resolve('waiting'));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve('waiting'));
  });
}

function isAvailable(candidatePort) {
  return new Promise(resolve => {
    const listener = net.createServer();
    listener.once('error', () => resolve(false));
    listener.listen(candidatePort, '127.0.0.1', () => listener.close(() => resolve(true)));
  });
}

if (!Number.isInteger(port) || port < 1 || port > (selectPort ? 65526 : 65535)) {
  console.error('[ERROR] Invalid website preview port.');
  process.exit(1);
}

if (selectPort) {
  const ports = Array.from({ length: 10 }, (_, index) => port + index);
  const statuses = await Promise.all(ports.map(probe));
  const readyIndex = statuses.indexOf('ready');
  if (readyIndex !== -1) {
    console.log(`ready ${ports[readyIndex]}`);
    process.exit(0);
  }
  for (const [index, candidate] of ports.entries()) {
    if (statuses[index] === 'waiting' && await isAvailable(candidate)) {
      console.log(`available ${candidate}`);
      process.exit(0);
    }
  }
  console.error(`[ERROR] No website preview port is available from ${port} to ${port + 9}.`);
  process.exit(1);
}

let status = await probe(port);
for (let attempt = 1; !probeOnly && status === 'waiting' && attempt < 50; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 350));
  status = await probe(port);
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
