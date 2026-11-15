import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteDir = path.resolve(__dirname, '..');
const cacheDir = path.resolve(websiteDir, '.astro-cache');

const env = {
  ...process.env,
  ASTRO_TELEMETRY_DISABLED: '1',
  APPDATA: cacheDir,
  LOCALAPPDATA: cacheDir,
  XDG_CONFIG_HOME: cacheDir,
};

const args = process.argv.slice(2);
const require = createRequire(import.meta.url);
const manifestPath = require.resolve('astro/package.json');
const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
const astroBin = path.resolve(path.dirname(manifestPath), typeof bin === 'string' ? bin : bin.astro);

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
