import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const versionPattern = /^(?:\d{3}|\d{14})$/;
const namePattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function compareMigrationHistory(files, history) {
  if (files.length === 0) throw new Error('The release has no migration files.');
  const aliases = new Map();
  const expected = files.toSorted().map((file) => {
    const match = /^(\d{3}|\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/.exec(file);
    if (!match) throw new Error(`Invalid repository migration filename: ${file}`);
    const [, version, name] = match;
    const key = `${version}_${name}`;
    for (const alias of [key, name]) {
      if (aliases.has(alias)) throw new Error(`Ambiguous repository migration name: ${alias}`);
      aliases.set(alias, key);
    }
    return { key, version };
  });
  const versions = new Set(expected.map((row) => row.version));
  if (versions.size !== expected.length) throw new Error('Repository migration versions must be unique.');

  // The connector wraps Management API rows in a migrations property.
  const rows = Array.isArray(history) ? history : history?.migrations;
  if (!Array.isArray(rows)) throw new Error('Expected a migration history array or an object with a migrations array.');
  const historyVersions = new Set();
  const applied = new Set();
  const unexpected = [];
  const latestOrder = new Map(expected.map((row, index) => [row.key, index]));
  const expectedByKey = new Map(expected.map((row) => [row.key, row]));
  let previousIndex = -1;
  const outOfOrder = [];
  const byVersion = rows.map((row) => {
    if (typeof row?.version !== 'string' || !versionPattern.test(row.version)
      || typeof row.name !== 'string' || !namePattern.test(row.name)) {
      throw new Error('Migration history contains an invalid version or name.');
    }
    return row;
  }).sort((a, b) => a.version.length - b.version.length || a.version.localeCompare(b.version));
  for (const { version, name } of byVersion) {
    if (historyVersions.has(version)) throw new Error(`Duplicate applied migration version: ${version}`);
    historyVersions.add(version);
    const key = aliases.get(name);
    if (!key) {
      unexpected.push(`${version} ${name}`);
      continue;
    }
    const localVersion = expectedByKey.get(key).version;
    // Hosted tooling can use a timestamp as the applied ID even when the
    // checked-in filename has a different prefix. A numbered ID must agree.
    if (version.length === 3 && version !== localVersion) {
      throw new Error(`History version ${version} disagrees with repository migration ${key}.`);
    }
    if (applied.has(key)) throw new Error(`Migration appears more than once in history: ${key}`);
    applied.add(key);
    const index = latestOrder.get(key);
    if (index < previousIndex) outOfOrder.push(key);
    previousIndex = Math.max(previousIndex, index);
  }
  return {
    expectedCount: expected.length,
    appliedCount: applied.size,
    missing: expected.map(({ key }) => key).filter((key) => !applied.has(key)),
    unexpected,
    outOfOrder,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = process.argv[2];
    if (!source || process.argv.length !== 3) throw new Error('Usage: npm run check:migrations -- <history.json|->');
    const files = readdirSync(fileURLToPath(migrationDirectory)).filter((file) => file.endsWith('.sql'));
    const history = JSON.parse(readFileSync(source === '-' ? 0 : source, 'utf8'));
    const result = compareMigrationHistory(files, history);
    console.log(`Matched ${result.appliedCount} of ${result.expectedCount} repository migrations.`);
    for (const [label, rows] of [['Missing', result.missing], ['Unexpected', result.unexpected], ['Out of order', result.outOfOrder]]) {
      if (rows.length) console.error(`${label}: ${rows.join(', ')}`);
    }
    if (result.missing.length || result.unexpected.length || result.outOfOrder.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
