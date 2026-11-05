import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure patch is applied
spawnSync(process.execPath, [path.resolve(__dirname, 'patch-sitemap.mjs')], { stdio: 'inherit' });

const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' };
const args = process.argv.slice(2);
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const result = spawnSync(command, ['astro', ...args], {
  stdio: 'inherit',
  shell: false,
  env,
});

if (result.status !== null && result.status !== 0) {
  process.exit(result.status);
}
