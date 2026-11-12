import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(dir, '../dist');
const port = Number(process.env.PORT || 4321);
// The preview is a LOCAL tool only. Never expose the file server on 0.0.0.0.
const host = '127.0.0.1';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};
function withinRoot(candidate) {
  return candidate === distDir || candidate.startsWith(distDir + path.sep);
}
function resolvePublicPath(rawUrl) {
  let decoded;
  try { decoded = decodeURIComponent(String(rawUrl || '/').split('?')[0]); }
  catch { return { status: 400 }; }
  // Windows treats backslash as a path separator. Normalize on every OS.
  decoded = decoded.replace(/\\/g, '/');
  if (!decoded.startsWith('/') || decoded.includes('\0')) return { status: 400 };
  if (decoded.split('/').some(segment => segment === '..')) return { status: 403 };
  let file = path.resolve(distDir, '.' + decoded);
  if (!withinRoot(file)) return { status: 403 };
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    if (fs.existsSync(file + '.html')) file += '.html';
  }
  if (!withinRoot(file)) return { status: 403 };
  try {
    // Prevent symlinks within dist from targeting arbitrary host files.
    const real = fs.realpathSync(file);
    if (!withinRoot(real)) return { status: 403 };
    if (fs.statSync(real).isFile()) return { status: 200, file: real };
  } catch { /* Not found or unreadable */ }
  return { status: 404 };
}
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }
  const resolved = resolvePublicPath(req.url);
  if (resolved.status !== 200) {
    const errorPath = path.join(distDir, '404.html');
    if (resolved.status === 404 && fs.existsSync(errorPath)) {
      res.writeHead(404, {'Content-Type':'text/html; charset=utf-8'});
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(errorPath).pipe(res);
    }
    res.writeHead(resolved.status, {'Content-Type':'text/plain; charset=utf-8'});
    return res.end(resolved.status === 403 ? 'Forbidden' : resolved.status === 400 ? 'Bad Request' : 'Not Found');
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(resolved.file)] || 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(resolved.file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});
server.listen(port, host, () => {
  const actualPort = server.address().port;
  console.log('Atlas OS website preview: http://' + host + ':' + actualPort + '/');
  console.log('Serving compiled static assets only: ' + distDir);
});
