import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteDir = path.resolve(__dirname, '..');
const cacheDir = path.resolve(websiteDir, '.astro-cache');

// Ensure patch is applied
spawnSync(process.execPath, [path.resolve(__dirname, 'patch-sitemap.mjs')], {
  stdio: 'inherit',
  cwd: websiteDir,
});

const env = {
  ...process.env,
  ASTRO_TELEMETRY_DISABLED: '1',
  APPDATA: cacheDir,
  LOCALAPPDATA: cacheDir,
  XDG_CONFIG_HOME: cacheDir,
};

const args = process.argv.slice(2);
const astroPkgPath = path.resolve(websiteDir, 'node_modules/astro/package.json');
let astroBinRel = 'astro.js';
if (fs.existsSync(astroPkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(astroPkgPath, 'utf8'));
    if (typeof pkg.bin === 'string') astroBinRel = pkg.bin;
    else if (pkg.bin && pkg.bin.astro) astroBinRel = pkg.bin.astro;
  } catch {}
}
const astroBin = path.resolve(websiteDir, 'node_modules/astro', astroBinRel);

const result = spawnSync(process.execPath, [astroBin, ...args], {
  stdio: 'inherit',
  cwd: websiteDir,
  env,
});

if (result.error) {
  console.error('Failed to run astro:', result.error);
  process.exit(1);
}

if (result.status !== null && result.status !== 0) {
  process.exit(result.status);
}
