import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4321;
const host = '0.0.0.0';

const mimeMap = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url?.split('?')[0] || '/');
  let filePath = path.join(distDir, reqPath);

  if (fs.existsSync(filePath)) {
    if (fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } else if (fs.existsSync(filePath + '.html')) {
    filePath = filePath + '.html';
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, '404.html');
    res.statusCode = 404;
  }

  const ext = path.extname(filePath);
  res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`\n  ======================================================`);
  console.log(`  🚀 Atlas OS Official Website Local Preview Server`);
  console.log(`  ======================================================`);
  console.log(`  Local URL:   http://localhost:${port}/`);
  console.log(`  Network URL: http://127.0.0.1:${port}/`);
  console.log(`  Serving dir: ${distDir}`);
  console.log(`  ======================================================\n`);
});
