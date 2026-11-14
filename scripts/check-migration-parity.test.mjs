import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareMigrationHistory } from './check-migration-parity.mjs';

const files = ['001_init.sql', '002_receipts.sql', '20261114080416_ledger_snapshots.sql'];
const history = [
  { version: '001', name: 'init' },
  { version: '20261110190000', name: '002_receipts' },
  { version: '20261114100208', name: '20261114080416_ledger_snapshots' },
];

test('matches both archived migration naming styles and applied timestamp IDs', () => {
  assert.deepEqual(compareMigrationHistory(files, { migrations: history.toReversed() }), {
    expectedCount: 3, appliedCount: 3, missing: [], unexpected: [], outOfOrder: [],
  });
});

test('reports a missing, unexpected, or misordered migration', () => {
  assert.deepEqual(compareMigrationHistory(files, [
    { version: '001', name: 'init' },
    { version: '20261110190000', name: 'unrelated' },
  ]), {
    expectedCount: 3, appliedCount: 1,
    missing: ['002_receipts', '20261114080416_ledger_snapshots'],
    unexpected: ['20261110190000 unrelated'], outOfOrder: [],
  });
  assert.deepEqual(compareMigrationHistory(files, [
    history[0], { ...history[1], version: '20261114103000' }, history[2],
  ]).outOfOrder, ['002_receipts']);
});

test('fails on malformed data and duplicate version or migration identities', () => {
  assert.throws(() => compareMigrationHistory(files, { error: 'unauthorized' }), /history array/);
  assert.throws(() => compareMigrationHistory(files, [{ version: 1, name: 'init' }]), /invalid version/);
  assert.throws(() => compareMigrationHistory(files, [history[0], history[0]]), /Duplicate applied/);
  assert.throws(() => compareMigrationHistory(files, [
    history[1], { version: '20261110190001', name: 'receipts' },
  ]), /appears more than once/);
  assert.throws(() => compareMigrationHistory(files, [{ version: '003', name: 'receipts' }]), /disagrees/);
  assert.throws(() => compareMigrationHistory([...files, '001_second.sql'], history), /versions must be unique/);
});

test('CLI checks all current files and exits nonzero if the newest migration is missing', () => {
  const repositoryFiles = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter((file) => file.endsWith('.sql')).sort();
  const releaseHistory = repositoryFiles.map((file) => {
    const name = file.slice(0, -4);
    return { version: name.slice(0, name.indexOf('_')), name };
  });
  const script = fileURLToPath(new URL('./check-migration-parity.mjs', import.meta.url));
  const check = (input) => spawnSync(process.execPath, [script, '-'], {
    input: JSON.stringify(input), encoding: 'utf8',
  });
  assert.equal(check(releaseHistory).status, 0);
  const missing = check(releaseHistory.slice(0, -1));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing:/);
});
