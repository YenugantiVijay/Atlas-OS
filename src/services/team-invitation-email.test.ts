import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createTeamInviteHandler } from '../../supabase/functions/send-team-invitation/handler.mjs';

const org = '67bafdda-1edf-455b-be99-2414bf0d0494';
const invite = '6237fb5e-b3e8-4de9-9171-95c3b88a54e5';
const verifiedRecipient = 'manager@example.com';
const env: Record<string, string> = {
  TEAM_INVITE_APP_URL: 'https://erp.example.com/workspace/',
  TEAM_INVITE_FROM: 'Atlas <invites@example.com>',
  SUPABASE_URL: 'https://supabase.example.com',
  SUPABASE_ANON_KEY: 'test-key',
  RESEND_API_KEY: 'test-sender',
};
const fetchResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

function request(origin = 'https://erp.example.com') {
  return new Request('https://functions.example.com/send-team-invitation', {
    method: 'POST',
    headers: { Origin: origin, Authorization: 'Bearer test-session' },
    body: JSON.stringify({ organizationId: org, inviteId: invite, email: 'ignored@example.com' }),
  });
}

test('uses the recipient claimed by the database and requires provider acknowledgement', async () => {
  const calls: Array<{ body: Record<string, string | string[]> }> = [];
  const handler = createTeamInviteHandler({
    env: key => env[key],
    fetchImpl: async (_url, options) => {
      calls.push({ body: JSON.parse(String(options?.body)) });
      if (calls.length === 1) return fetchResponse({ email: verifiedRecipient, workspace: 'Print studio', role: 'viewer', attempt: 1 });
      return fetchResponse({ id: 'mail-delivery-id' });
    },
  });
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { sent: true });
  assert.deepEqual(calls[0].body, { p_org_id: org, p_invite_id: invite });
  assert.deepEqual(calls[1].body.to, [verifiedRecipient]);
  assert.ok(calls[1].body.text.includes('https://erp.example.com/workspace/#/invite/' + invite));
});

test('stops unauthorized and unconfigured requests before contacting the mail provider', async () => {
  let count = 0;
  const fetchImpl = async () => { count++; return new Response(null, { status: 403 }); };
  const handler = createTeamInviteHandler({ env: key => env[key], fetchImpl });
  assert.equal((await handler(request('https://other.example.com'))).status, 403);
  assert.equal(count, 0);
  assert.equal((await handler(request())).status, 403);
  assert.equal(count, 1);
  const disabled = createTeamInviteHandler({ env: key => key === 'RESEND_API_KEY' ? undefined : env[key], fetchImpl });
  assert.equal((await disabled(request())).status, 503);
  assert.equal(count, 1);
});
