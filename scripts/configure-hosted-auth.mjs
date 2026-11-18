import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function configureHostedAuth({ projectRef, token, apply = false, request = fetch }) {
  if (!/^[a-z]{20}$/.test(projectRef ?? '')) throw new Error('Pass a valid Supabase project reference with --project-ref.');
  if (!token?.trim()) throw new Error('Set SUPABASE_ACCESS_TOKEN in your terminal before running this command.');

  const desired = {
    mailer_subjects_magic_link: 'Your Atlas OS sign-in code',
    mailer_templates_magic_link_content: await readFile(new URL('../docs/auth-email/sign-in-code.html', import.meta.url), 'utf8'),
    mailer_subjects_confirmation: 'Verify your Atlas OS email',
    mailer_templates_confirmation_content: await readFile(new URL('../docs/auth-email/confirm-signup.html', import.meta.url), 'utf8'),
    mailer_otp_length: 6,
    mailer_otp_exp: 600,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
  };
  async function configRequest(method, body) {
    const response = await request(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
      method,
      headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Auth config responses contain secrets. Report only the status code on failure.
    if (!response.ok) throw new Error(`Supabase Auth configuration request failed (HTTP ${response.status}).`);
    return response.json();
  }
  const current = await configRequest('GET');
  const fields = Object.keys(desired);
  const unsupported = fields.filter(field => !Object.hasOwn(current, field));
  if (unsupported.length) throw new Error(`This project does not expose the expected Auth settings: ${unsupported.join(', ')}. Use the Supabase dashboard.`);
  const changes = fields.filter(field => current[field] !== desired[field]);
  if (apply && changes.length) {
    await configRequest('PATCH', Object.fromEntries(changes.map(field => [field, desired[field]])));
    const verified = await configRequest('GET');
    if (fields.some(field => verified[field] !== desired[field])) {
      throw new Error('Auth settings were submitted but the read-back did not match. Check the Supabase dashboard before deploying.');
    }
  }
  return {
    projectRef,
    applied: apply,
    changes,
    emailHookEnabled: current.hook_send_email_enabled === true,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const projectIndex = args.indexOf('--project-ref');
  const result = await configureHostedAuth({
    projectRef: projectIndex < 0 ? undefined : args[projectIndex + 1],
    token: process.env.SUPABASE_ACCESS_TOKEN,
    apply: args.includes('--apply'),
  });
  console.log(`Project ${result.projectRef}`);
  console.log(result.applied ? 'Email-code templates and TOTP settings verified.' : 'Read-only Auth configuration check completed.');
  console.log(`Settings ${result.applied ? 'updated' : 'requiring an update'}: ${result.changes.length}`);
  if (!result.applied && result.changes.length) console.log('Add --apply to update these settings.');
  if (result.emailHookEnabled) console.log('A custom email hook is active. Its email content also needs verification.');
  console.log('Request a fresh email code to verify delivery.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Avoid printing transport errors which could contain credentials or responses.
    console.error('Auth configuration could not be completed. Check the project reference, SUPABASE_ACCESS_TOKEN, and project access.');
    process.exitCode = 1;
  });
}
