import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureHostedAuth } from './configure-hosted-auth.mjs';

const config = () => ({
  mailer_subjects_magic_link: 'Your sign-in link',
  mailer_templates_magic_link_content: '<a href="{{ .ConfirmationURL }}">Sign in</a>',
  mailer_subjects_confirmation: 'Confirm signup',
  mailer_templates_confirmation_content: 'Confirm signup',
  mailer_otp_length: 8,
  mailer_otp_exp: 3600,
  mfa_totp_enroll_enabled: false,
  mfa_totp_verify_enabled: false,
  smtp_pass: 'private SMTP fixture',
});
const options = { projectRef: 'a'.repeat(20), token: 'fixture-access-token' };

test('changes only the intended settings and verifies the saved configuration', async () => {
  let current = config();
  const methods = [];
  const request = async (url, init) => {
    assert.equal(new URL(url).hostname, 'api.supabase.com');
    assert.equal(init.redirect, 'error');
    methods.push(init.method);
    if (init.method === 'PATCH') {
      const patch = JSON.parse(init.body);
      assert.deepEqual(Object.keys(patch).sort(), Object.keys(config()).filter(field => field !== 'smtp_pass').sort());
      assert.match(patch.mailer_templates_magic_link_content, /\{\{ \.Token \}\}/);
      assert.doesNotMatch(patch.mailer_templates_magic_link_content, /ConfirmationURL/);
      current = { ...current, ...patch };
    }
    return Response.json(current);
  };
  const preview = await configureHostedAuth({ ...options, request });
  assert.equal(preview.applied, false);
  assert.deepEqual(methods, ['GET']);
  methods.length = 0;
  await configureHostedAuth({ ...options, apply: true, request });
  assert.deepEqual(methods, ['GET', 'PATCH', 'GET']);
  assert.equal(current.smtp_pass, 'private SMTP fixture');
});

test('rejects unsupported or unsaved settings without reporting success', async () => {
  await assert.rejects(configureHostedAuth({ ...options, apply: true, request: async () => Response.json({}) }), /expected Auth settings/);
  await assert.rejects(configureHostedAuth({ ...options, apply: true, request: async () => Response.json(config()) }), /read-back did not match/);
});
