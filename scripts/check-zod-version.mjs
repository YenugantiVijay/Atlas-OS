import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const expected = require('./package-lock.json').packages['node_modules/zod'].version;
let installed;

try {
  installed = require('zod/package.json').version;
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

if (installed !== expected) {
  console.error(
    `Atlas OS expects Zod ${expected} from package-lock.json. Installed Zod: ${installed ?? 'missing'}.`,
  );
  console.error('Run npm ci from the Atlas OS repository root, then retry.');
  process.exitCode = 1;
}
