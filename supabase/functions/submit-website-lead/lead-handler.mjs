/**
 * Public Atlas OS website lead intake. All config stays in Edge Function secrets.
 * Uses only Web APIs so the same logic can be tested in Node 22 without Deno.
 * Delivery success means Resend accepted an actual notification email, not that
 * a localStorage entry was created or that an inbox delivery is guaranteed.
 */
const emailPattern = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const types = new Set(['contact', 'demo', 'release']);

const clean = (value, max = 500) =>
  typeof value === 'string' && value.trim().length <= max
    ? value.trim().replace(/\r/g, '') : null;

const failure = (status, error, headers) =>
  new Response(JSON.stringify({ ok: false, error }), {
    status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const isEmail = (value) => typeof value === 'string' && value.length <= 254 && emailPattern.test(value);

export function validateLead(kind, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !types.has(kind)) return null;
  const email = clean(raw.email, 254)?.toLowerCase();
  if (!isEmail(email)) return null;

  if (kind === 'release') {
    return { email };
  }
  if (kind === 'contact') {
    const name = clean(raw.name, 120);
    const message = clean(raw.message, 2000);
    const department = clean(raw.department, 40);
    if (!name || !message || message.length < 10 ||
        !['sales','demo','support','migration','security','partnership'].includes(department)) return null;
    return {
      name, email, department, message,
      company: clean(raw.company, 160) ?? '',
      phone: clean(raw.phone, 40) ?? '',
    };
  }

  const fullName = clean(raw.fullName, 120);
  const businessName = clean(raw.businessName, 160);
  const phone = clean(raw.phone, 40);
  const city = clean(raw.city, 120);
  if (!fullName || !businessName || !city || !phone ||
      !/^[+\d\s()-]{10,40}$/.test(phone) || phone.replace(/\D/g,'').length < 10) return null;
  const industry = clean(raw.industry, 80);
  const businessSize = clean(raw.businessSize, 80);
  const primaryRequirement = clean(raw.primaryRequirement, 100);
  if (!industry || !businessSize || !primaryRequirement) return null;
  return {
    fullName, businessName, email, phone, industry, businessSize, city, primaryRequirement,
    additionalMessage: clean(raw.additionalMessage, 2000) ?? '',
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

async function hashSubject(salt, subject) {
  const input = new TextEncoder().encode(salt + ':' + subject);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

export function createLeadHandler({ env, fetchImpl = fetch } = {}) {
  if (typeof env !== 'function') throw new Error('A secret environment reader is required');
  return async function handle(req) {
    const origin = req.headers.get('origin') || '';
    const allow = (env('LEAD_ALLOWED_ORIGINS') || '')
      .split(',').map((x) => x.trim()).filter(Boolean);
    const allowed = allow.includes(origin) && /^https?:\/\//.test(origin);
    const cors = allowed ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Vary': 'Origin',
    } : { 'Vary': 'Origin' };

    if (!allowed) return failure(403, 'This website origin is not allowed.', cors);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return failure(405, 'Use POST.', cors);

    // Fail closed if deployment configuration is incomplete; no fake success.
    const settings = Object.fromEntries([
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY',
      'LEAD_NOTIFICATION_TO', 'LEAD_SENDER_EMAIL', 'TURNSTILE_SECRET_KEY',
      'LEAD_HASH_SECRET',
    ].map((key) => [key, env(key) || '']));
    if (Object.values(settings).some((v) => !v) ||
        !isEmail(settings.LEAD_NOTIFICATION_TO) ||
        !isEmail(settings.LEAD_SENDER_EMAIL) ||
        settings.LEAD_HASH_SECRET.length < 32 ||
        !/^https:\/\//.test(settings.SUPABASE_URL)) {
      return failure(503, 'Enquiry delivery is not configured yet. Please try again later.', cors);
    }

    if (Number(req.headers.get('content-length') || 0) > 12000) {
      return failure(413, 'Enquiry is too large.', cors);
    }
    let incoming;
    try {
      const body = await req.text();
      if (body.length > 12000) return failure(413, 'Enquiry is too large.', cors);
      incoming = JSON.parse(body);
    } catch {
      return failure(400, 'Invalid request data.', cors);
    }

    const kind = incoming?.kind;
    const payload = validateLead(kind, incoming?.data);
    const token = incoming?.token;
    const requestId = incoming?.requestId;
    if (!payload || typeof token !== 'string' || !token || token.length > 2048 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '') ||
        typeof incoming?.website === 'string' && incoming.website.trim()) {
      return failure(400, 'Please review the enquiry fields and verification.', cors);
    }

    try {
      // Turnstile verification happens on the SERVER. A public origin or honeypot
      // alone is not authentication and is never treated as proof of a human.
      const challenge = new FormData();
      challenge.set('secret', settings.TURNSTILE_SECRET_KEY);
      challenge.set('response', token);
      challenge.set('idempotency_key', requestId);
      const verifiedResp = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: challenge, signal: AbortSignal.timeout(9000),
      });
      if (!verifiedResp.ok) return failure(503, 'Verification is temporarily unavailable.', cors);
      const verified = await verifiedResp.json();
      if (verified.success !== true || verified.action !== 'lead_' + kind ||
          verified.hostname !== new URL(origin).hostname) {
        return failure(400, 'Human verification failed. Please try again.', cors);
      }

      // Best-effort edge IP limit + per-email limit. Both stored only as salted
      // hashes, never raw IP/email. Captcha remains essential if IP is unknown
      // or spoofed through an untrusted proxy header.
      const subjects = ['email:' + payload.email];
      const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      if (ip && ip.length <= 100) subjects.push('ip:' + ip);
      for (const subject of subjects) {
        const digest = await hashSubject(settings.LEAD_HASH_SECRET, subject);
        const limitResp = await fetchImpl(
          settings.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/consume_website_lead_rate_limit',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: settings.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: 'Bearer ' + settings.SUPABASE_SERVICE_ROLE_KEY,
            },
            body: JSON.stringify({ p_subject_hash: digest }),
            signal: AbortSignal.timeout(9000),
          },
        );
        if (!limitResp.ok) return failure(503, 'Enquiry service is temporarily unavailable.', cors);
        if (await limitResp.json() !== true) {
          return failure(429, 'Too many recent enquiries. Please try again later.', cors);
        }
      }

      const label = { contact: 'Contact enquiry', demo: 'Demo request', release: 'Desktop release notification' }[kind];
      const details = Object.entries(payload).map(([key, value]) => key + ': ' + String(value)).join('\n');
      const emailResponse = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + settings.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'atlas-lead-' + requestId,
        },
        body: JSON.stringify({
          from: settings.LEAD_SENDER_EMAIL,
          to: [settings.LEAD_NOTIFICATION_TO],
          reply_to: payload.email,
          subject: 'Atlas OS website — ' + label,
          text: label + '\n\n' + details + '\n\nRequest ID: ' + requestId,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!emailResponse.ok) return failure(503, 'We could not send your enquiry. Please try again later.', cors);
      const result = await emailResponse.json();
      if (typeof result?.id !== 'string' || !result.id) {
        return failure(503, 'Delivery was not confirmed by the email service.', cors);
      }
      return json({ ok: true, reference: requestId.slice(0, 8) }, 200, cors);
    } catch {
      // Do not expose secrets, token, IP or user fields in public errors or logs.
      return failure(503, 'Enquiry service is temporarily unavailable. Please try again.', cors);
    }
  };
}
