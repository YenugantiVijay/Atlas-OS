import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetFile = path.resolve(__dirname, '../node_modules/@astrojs/sitemap/dist/index.js');

if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf8');
  if (content.includes('let _routes;')) {
    content = content.replace('let _routes;', 'let _routes = [];');
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('Successfully patched @astrojs/sitemap for Astro 4 route compatibility.');
  }
}
