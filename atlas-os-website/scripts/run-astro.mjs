import { spawnSync } from 'node:child_process';
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
const astroBin = path.resolve(websiteDir, 'node_modules/astro/astro.js');

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
