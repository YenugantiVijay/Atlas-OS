import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrationCatalog, createInitialState } from './checks.mjs';
import { readiness } from './readiness.mjs';

const MAIN = 'b'.repeat(40);
function fullyVerified() {
  const state = createInitialState();
  state.checks = state.checks.map(c => ({
    ...c, status:'verified', evidence_method:c.requires_auth?'authenticated-browser':'schema-inspection',
    tested_commit:MAIN,verified_at:new Date().toISOString(),
    evidence_url:'https://example.org/acceptance-evidence',
  }));
  state.github.main_sha=MAIN;
  state.github.ci_runs=[{
    id:1,name:'ATLAS OS CI',branch:'main',head_sha:MAIN,
    status:'completed',conclusion:'success',at:'2026-11-11T07:00:00Z',
  }];
  return state;
}
const decision = s => readiness(s.checks,s.migrations,s.github).decision;

test('real staging migrations use the exact 001–048 names and original Supabase IDs',()=>{
  assert.equal(migrationCatalog.length,48);
  assert.deepEqual(migrationCatalog.map(m=>m.version),Array.from({length:48},(_,i)=>i+1));
  assert.equal(migrationCatalog[0].name,'multi_tenant_base');
  assert.equal(migrationCatalog[14].name,'atomic_invoice_creation_rpc');
  assert.equal(migrationCatalog[46].name,'bulk_goods_receipts');
  assert.equal(migrationCatalog[47].name,'supplier_price_history');
  assert.equal(migrationCatalog[47].observed_id,'20261110181357');
});

test('release remains NO-GO unless every numbered migration is uniquely verified',()=>{
  const s=fullyVerified();
  assert.equal(decision(s),'GO');
  s.migrations[47].version=47;
  assert.equal(decision(s),'NO-GO');
  assert.match(readiness(s.checks,s.migrations,s.github).reasons.join(' '),/unique migrations/);
});

test('missing mandatory critical checks never produce a release GO',()=>{
  const s=fullyVerified();
  s.checks=s.checks.filter(c=>c.id!=='TENANT-01');
  assert.equal(decision(s),'NO-GO');
  assert.ok(readiness(s.checks,s.migrations,s.github).blockers.includes('TENANT-01'));
});

test('the most recent current-main CI result wins over an older success',()=>{
  const s=fullyVerified();
  assert.equal(decision(s),'GO');
  s.github.ci_runs.unshift({
    id:2,name:'ATLAS OS CI',branch:'main',head_sha:MAIN,
    status:'completed',conclusion:'failure',at:'2026-11-11T07:10:00Z',
  });
  assert.equal(decision(s),'NO-GO');
  s.github.ci_runs[0].status='in_progress';
  s.github.ci_runs[0].conclusion=null;
  assert.equal(decision(s),'NO-GO');
});

test('a new main commit invalidates otherwise accepted authenticated evidence',()=>{
  const s=fullyVerified();
  assert.equal(decision(s),'GO');
  s.github.main_sha='c'.repeat(40);
  assert.equal(decision(s),'NO-GO');
});
