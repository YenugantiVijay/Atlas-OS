const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createTeamInviteHandler({ env, fetchImpl }) {
  return async function handle(request) {
    const origin = request.headers.get('Origin');
    let appUrl;
    try {
      appUrl = new URL(env('TEAM_INVITE_APP_URL'));
      if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password) appUrl = undefined;
    } catch {
      appUrl = undefined;
    }
    const allowed = appUrl && (!origin || origin === appUrl.origin);
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      ...(allowed && origin ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      } : {}),
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (!allowed) return reply(403, { error: 'Email sending is unavailable on this app origin.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });

    const authorization = request.headers.get('Authorization');
    if (!authorization?.match(/^Bearer [^\s]+$/i)) return reply(401, { error: 'Sign in first.' });
    const resendKey = env('RESEND_API_KEY');
    const from = env('TEAM_INVITE_FROM');
    const backend = env('SUPABASE_URL');
    const apiKey = env('SUPABASE_ANON_KEY') || request.headers.get('apikey');
    if (!resendKey || !from || !backend || !apiKey) return reply(503, { error: 'Invitation email is unavailable.' });

    try {
      const body = await request.text();
      if (body.length > 1000) return reply(413, { error: 'Request is too large.' });
      const { organizationId, inviteId } = JSON.parse(body) || {};
      if (typeof organizationId !== 'string' || typeof inviteId !== 'string' || !uuid.test(organizationId) || !uuid.test(inviteId)) {
        return reply(400, { error: 'Invalid invitation request.' });
      }
      const claim = await fetchImpl(new URL('/rest/v1/rpc/claim_team_invite_delivery', backend), {
        method: 'POST',
        headers: { Authorization: authorization, apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_org_id: organizationId, p_invite_id: inviteId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!claim.ok) return reply(403, { error: 'Invitation sending is unavailable for this request.' });
      const { email, workspace, role, attempt } = await claim.json();
      if (typeof email !== 'string' || typeof workspace !== 'string' ||
          typeof role !== 'string' || !Number.isInteger(attempt)) {
        return reply(502, { error: 'Invitation details could not be confirmed.' });
      }
      appUrl.search = '';
      appUrl.hash = '/invite/' + inviteId;
      const sent = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json',
          'Idempotency-Key': 'atlas-team-invite-' + inviteId + '-' + attempt },
        body: JSON.stringify({
          from,
          to: [email],
          subject: 'Your Atlas OS workspace invitation',
          text: [
            'You were invited to join ' + workspace + ' as ' + role + '.',
            'Open this link and sign in or create an Atlas OS account using ' + email + '.',
            appUrl.toString(),
            'The invitation is valid for up to 7 days.',
          ].join('\n\n'),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = sent.ok && await sent.json().catch(() => null);
      if (typeof result?.id !== 'string' || !result.id) return reply(502, { error: 'The email provider did not acknowledge delivery.' });
      return reply(200, { sent: true });
    } catch {
      return reply(502, { error: 'Invitation email could not be confirmed.' });
    }
  };
}
