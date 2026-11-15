import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeadHandler, validateLead } from '../../supabase/functions/submit-website-lead/lead-handler.mjs';

const origin = 'https://atlasos.business';
const requestId = 'd3a54640-11bb-4390-84ad-1084d4bc52a3';
const settings = {
  LEAD_ALLOWED_ORIGINS: origin,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret-do-not-expose',
  RESEND_API_KEY: 'test-only-key',
  LEAD_NOTIFICATION_TO: 'team@example.test',
  LEAD_SENDER_EMAIL: 'notifications@example.test',
  TURNSTILE_SECRET_KEY: 'captcha-secret',
  LEAD_HASH_SECRET: 'a-long-and-secret-test-salt-for-website-rate-limits',
};

const contacts = {
  contact: {
    name: 'Priya', email: 'priya@example.test', phone: '+91 9876543210',
    company: 'Hardware Traders', department: 'sales', message: 'I want an ERP demonstration.',
  },
  demo: {
    fullName: 'Priya', businessName: 'Hardware Traders', email: 'priya@example.test',
    phone: '9876543210', industry: 'electrical_wholesale', businessSize: '6_to_20',
    city: 'Guntur', primaryRequirement: 'inventory_and_gst_billing',
  },
  release: { email: 'priya@example.test' },
};

function buildRequest(kind = 'contact', data = contacts[kind], options = {}) {
  return new Request('https://example.supabase.co/functions/v1/submit-website-lead', {
    method: 'POST',
    headers: {
      origin: options.origin || origin,
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.40',
    },
    body: JSON.stringify({ kind, data, token: 'turnstile-token', requestId, ...options.body }),
  });
}

function fixture(options = {}) {
  const calls = [];
  const fakeFetch = async (url, init) => {
    const name = String(url);
    calls.push({ url: name, init });
    if (name.includes('siteverify')) {
      return Response.json(options.challenge || {
        success: true,
        hostname: 'atlasos.business',
        action: 'lead_' + (options.kind || 'contact'),
      });
    }
    if (name.includes('consume_website_lead_rate_limit')) {
      return Response.json(options.limit ?? true, { status: options.limitStatus || 200 });
    }
    if (name.includes('api.resend.com')) {
      return Response.json(options.emailBody || { id: 'accepted-email-1' }, { status: options.emailStatus || 200 });
    }
    throw Error('Unexpected outbound URL ' + name);
  };
  const handler = createLeadHandler({
    env: (name) => ({ ...settings, ...options.env })[name],
    fetchImpl: fakeFetch,
  });
  return { handler, calls };
}

test('valid contact, demo and release input normalization; malformed data rejected', () => {
  assert.equal(validateLead('contact', contacts.contact)?.name, 'Priya');
  assert.equal(validateLead('demo', contacts.demo)?.businessName, 'Hardware Traders');
  assert.equal(validateLead('release', contacts.release)?.email, 'priya@example.test');
  assert.equal(validateLead('release', { email: 'bad@' }), null);
  assert.equal(validateLead('contact', { ...contacts.contact, message: 'short' }), null);
  assert.equal(validateLead('demo', { ...contacts.demo, phone: '123' }), null);
  assert.equal(validateLead('contact', { ...contacts.contact, name: 'x'.repeat(200) }), null);
});

for (const kind of ['contact','demo','release']) {
  test(kind + ': sends a real email after CAPTCHA and database rate checks', async () => {
    const { handler, calls } = fixture({ kind });
    const response = await handler(buildRequest(kind));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    const emails = calls.filter(x => x.url.endsWith('/emails'));
    assert.equal(emails.length, 1);
    const email = JSON.parse(emails[0].init.body);
    assert.equal(email.to[0], settings.LEAD_NOTIFICATION_TO);
    assert.equal(email.reply_to, contacts[kind].email);
    assert.match(email.text, /Request ID:/);
    assert.equal(emails[0].init.headers['Idempotency-Key'], 'atlas-lead-' + requestId);
    const rateCalls = calls.filter(x => x.url.includes('consume_website_lead_rate_limit'));
    assert.equal(rateCalls.length, 2);
    for (const call of rateCalls) {
      assert.equal(call.init.headers.apikey, settings.SUPABASE_SERVICE_ROLE_KEY);
      assert.match(JSON.parse(call.init.body).p_subject_hash, /^[a-f0-9]{64}$/);
      assert.equal(call.init.body.includes('priya@example.test'), false);
    }
  });
}

test('rejects unexpected origins before touching any external service', async () => {
  const { handler, calls } = fixture();
  const response = await handler(buildRequest('contact', contacts.contact, { origin: 'https://attacker.test' }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(calls.length, 0);
});

test('rejects missing secrets and never claims success', async () => {
  const { handler, calls } = fixture({ env: { RESEND_API_KEY: '' } });
  const response = await handler(buildRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.equal(calls.length, 0);
});

test('preflight is limited to allowlisted origins and POST', async () => {
  const { handler } = fixture();
  const req = new Request('https://example.supabase.co/functions/v1/submit-website-lead', {
    method: 'OPTIONS', headers: { origin },
  });
  const response = await handler(req);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});

test('rejects invalid payloads, bot honeypot and oversized requests', async () => {
  const { handler, calls } = fixture();
  for (const incoming of [
    { data: { ...contacts.contact, email: 'broken' } },
    { token: '' },
    { requestId: 'not-a-uuid' },
    { website: 'spam.example' },
  ]) {
    const response = await handler(buildRequest('contact', contacts.contact, { body: incoming }));
    assert.equal(response.status, 400);
  }
  const big = await handler(buildRequest('contact', contacts.contact, {
    body: { data: { ...contacts.contact, message: 'x'.repeat(15000) } },
  }));
  assert.equal(big.status, 413);
  assert.equal(calls.length, 0);
});

test('CAPTCHA action and hostname must match request', async () => {
  for (const challenge of [
    { success: false, action: 'lead_contact', hostname: 'atlasos.business' },
    { success: true, action: 'lead_demo', hostname: 'atlasos.business' },
    { success: true, action: 'lead_contact', hostname: 'evil.example' },
  ]) {
    const { handler, calls } = fixture({ challenge });
    const response = await handler(buildRequest());
    assert.equal(response.status, 400);
    assert.equal(calls.length, 1);
  }
});

test('rate-limit rejection prevents email sending', async () => {
  const { handler, calls } = fixture({ limit: false });
  const response = await handler(buildRequest());
  assert.equal(response.status, 429);
  assert.equal(calls.some(x=>x.url.endsWith('/emails')), false);
});

test('email provider rejection is a failure, not fake success', async () => {
  const { handler, calls } = fixture({ emailStatus: 500 });
  const response = await handler(buildRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.equal(calls.filter(x=>x.url.endsWith('/emails')).length, 1);
});

test('email provider response without accepted message id fails closed', async () => {
  const { handler } = fixture({ emailBody: {} });
  assert.equal((await handler(buildRequest())).status, 503);
});
