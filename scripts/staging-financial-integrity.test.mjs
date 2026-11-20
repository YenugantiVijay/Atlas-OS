import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertStagingConnection, checkStagingIntegrity } from './staging-financial-integrity.mjs';

test('refuses production, localhost and unrecognized project URLs', () => {
  for (const url of [
    'postgresql://postgres:secret@db.hrxjgbupjtikokqxjzbh.supabase.co:5432/postgres',
    'postgresql://postgres:secret@localhost:5432/postgres',
    'postgresql://postgres.other:secret@aws-0-us-west-1.pooler.supabase.com:5432/postgres',
    'https://db.bwswqnhlebbzdxumlkih.supabase.co',
    '',
  ]) assert.throws(() => assertStagingConnection(url));
  assertStagingConnection('postgresql://postgres:masked@db.bwswqnhlebbzdxumlkih.supabase.co:5432/postgres');
  assertStagingConnection('postgresql://postgres.bwswqnhlebbzdxumlkih:masked@aws-0-us-east-1.pooler.supabase.com:5432/postgres');
});

test('empty financial fixtures are blocked, never reported as a pass', async () => {
  let invocation = 0;
  const result = await checkStagingIntegrity(async () => {
    invocation += 1;
    return { rows: [invocation === 1 ? { missing_count: 4 } : { sample_count: 0, violations: 0 }] };
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.checks.length, 6);
  assert.equal(result.checks.filter(c => c.status === 'blocked').length, 6);
});

test('real sampled records pass only with zero independent reconciliation violations', async () => {
  let invocation = 0;
  const result = await checkStagingIntegrity(async () => ({
    rows: [++invocation === 1 ? { missing_count: 0 } : { sample_count: 3, violations: 0 }],
  }));
  assert.equal(result.status, 'pass');
});

test('an accounting mismatch fails even when other checks are blocked', async () => {
  let invocation = 0;
  const result = await checkStagingIntegrity(async () => {
    invocation += 1;
    if (invocation === 1) return { rows: [{ missing_count: 0 }] };
    if (invocation === 2) return { rows: [{ sample_count: 2, violations: 1 }] };
    return { rows: [{ sample_count: 0, violations: 0 }] };
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.checks.find(c => c.name === 'invoice_allocation').status, 'fail');
});

test('rejects missing or malformed database results', async () => {
  await assert.rejects(checkStagingIntegrity(async () => ({ rows: [] })), /No result/);
  let invocation = 0;
  await assert.rejects(checkStagingIntegrity(async () =>
    ({ rows: [++invocation === 1 ? { missing_count: 0 } : { sample_count: 'missing', violations: 0 }] })
  ), /Invalid count/);
});
