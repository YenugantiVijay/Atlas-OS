import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [step, ...args] = process.argv.slice(2);
if (step !== 'prepare' && step !== 'serve') {
  console.error('[ERROR] Use npm run preview:prepare or npm run preview:serve.');
  process.exit(1);
}

function run(program, argumentsToRun) {
  const child = spawnSync(program, argumentsToRun, { stdio: 'inherit' });
  if (child.error) console.error(child.error.message);
  return child.status ?? 1;
}

const npm = process.env.npm_execpath;
const [major, minor, patch] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && (minor > 23 || (minor === 23 && patch >= 4)));
if (!supported) {
  if (!npm || process.env.ATLAS_WEBSITE_NODE_RETRY) {
    console.error('[ERROR] Could not start a compatible website runtime. Install Node.js 24 LTS and try again.');
    process.exit(1);
  }
  process.env.ATLAS_WEBSITE_NODE_RETRY = '1';
  console.log('[INFO] Using a separate Node.js 24 runtime for the website.');
  process.exit(run(process.execPath, [
    npm, 'exec', '--yes', '--prefer-offline', '--package=node@24', '--',
    'node', 'scripts/preview-runtime.mjs', step, ...args,
  ]));
}

if (step === 'serve') {
  process.exit(run(process.execPath, [
    'scripts/run-astro.mjs', 'dev', '--ignore-lock', '--host', '127.0.0.1', ...args,
  ]));
}

const locked = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages['node_modules/astro'].version;
let installed;
try {
  installed = JSON.parse(readFileSync('node_modules/astro/package.json', 'utf8')).version;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (installed !== locked) {
  console.log('[INFO] Installing website dependencies...');
  process.exit(run(process.execPath, [npm, 'ci', '--no-audit', '--no-fund']));
}
