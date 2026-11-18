import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessAudit } from './check-dependency-audit.mjs';

const acceptedUrl = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const otherUrl = 'https://example.test/advisory';
const advisory = { name: 'picomatch', severity: 'high', url: acceptedUrl };

const audit = (vulnerabilities) => ({ auditReportVersion: 2, vulnerabilities });
const high = (...via) => ({ severity: 'high', via });

test('accepts the scoped advisory through a transitive dependency cycle', () => {
  assert.deepEqual(assessAudit(audit({
    astro: high('vite'),
    vite: high('astro', 'picomatch'),
    picomatch: high(advisory),
  })), { accepted: true, blocked: [] });
});

test('blocks another high advisory even when the same dependency has the scoped advisory', () => {
  assert.deepEqual(assessAudit(audit({
    picomatch: high(advisory, { ...advisory, url: otherUrl }),
  })), { accepted: true, blocked: [otherUrl] });
});

test('blocks an escalation to critical severity and a different affected package', () => {
  assert.deepEqual(assessAudit(audit({
    picomatch: { severity: 'critical', via: [{ ...advisory, severity: 'critical' }] },
    other: high({ ...advisory, name: 'other' }),
  })), { accepted: false, blocked: [acceptedUrl] });
});

test('keeps the existing high severity threshold and fails closed on incomplete reports', () => {
  assert.deepEqual(assessAudit(audit({
    other: { severity: 'moderate', via: [{ ...advisory, severity: 'moderate', url: otherUrl }] },
  })), { accepted: false, blocked: [] });
  assert.throws(() => assessAudit({ error: { code: 'E503' } }), /valid dependency audit/);
  assert.throws(() => assessAudit(audit({ vite: high('missing') })), /Missing audit details/);
  assert.throws(() => assessAudit(audit({ vite: high('vite') })), /Missing blocking advisory/);
});
