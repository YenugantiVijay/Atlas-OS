# Atlas OS email verification and sign-in codes

Atlas OS verifies new email and password accounts with a six-digit email code. Existing users can sign in with their password or request an email code. Both flows work with a Gmail address or any other email address. If Google OAuth is enabled separately, use Google's identity verification for that flow.

| Supabase template | Subject | HTML |
| --- | --- | --- |
| Confirm signup | Verify your Atlas OS email | [confirm-signup.html](./confirm-signup.html) |
| Magic link | Your Atlas OS sign-in code | [sign-in-code.html](./sign-in-code.html) |

## Staging rollout

1. Open **ATLAS-OS-Staging**. In **Authentication → Providers → Email**, enable email sign-up and confirmation and set the code to six digits with a 600-second expiry. Keep at least 60 seconds between code requests. Configure custom SMTP with a verified sender for delivery to external email addresses.
2. In **Authentication → Emails**, update both templates above with their matching subject and HTML. The `{{ .Token }}` variable renders the code. Keep password reset and invitation templates as configured.
3. Apply the pending database migrations in repository order, including `054`, `055`, and `20261120120000_require_aal2_for_authenticated_api.sql`. Deploy the app build with the code-entry screen and authenticator challenge in the same release.
4. Create a staging test account with a controlled Gmail address. Confirm email delivery, enter the code, and check that onboarding opens only after verification. Test invalid and expired codes, resend, and password and email-code sign-in for the verified account. An email-code request for an unregistered address should leave the user count unchanged.
5. Open a recorded payment with Starter, Professional, and Enterprise Network staging fixtures. Verify the one- and two-copy A4 prints and reconcile the daily totals against recorded payments. The subscription service should use `starter`, `professional`, or `enterprise_network` as the plan tier. The app reads the stored edition and active period.

Local Auth uses the email settings in `supabase/config.toml`. Changing the repo templates prepares the application release. Hosted Auth template and SMTP settings are configured per project.

[Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates) · [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

## Owner console and industry sign-in

Both builds use the same hosted email templates and SMTP settings when they point to the same Supabase project. If a request is accepted but the code does not arrive, check the Auth logs and the SMTP provider delivery log for the request time. Confirm that the Magic link template renders `{{ .Token }}` and that the provider has verified the sender. Built-in SMTP restricts delivery to project team addresses.

Workspace access requires an authenticator by default. Enable TOTP enrollment and verification in Supabase Auth before deploying. The app prompts after password or email-code sign-in, and first-time users must set up a factor before workspace data loads. The AAL2 migration also rejects authenticated Data API requests without a verified second factor and adds restrictive AAL2 policies to RLS-protected workspace and Storage tables. The Data API pre-request hook does not cover Realtime or other Supabase products; those paths must rely on the added RLS policies or receive separate verification. Server-side `service_role` access intentionally remains outside the user MFA gate and must stay secret. The development UI opt-out does not bypass database enforcement.

The migration refuses to replace a different `pgrst.db_pre_request` hook. If a target project already has one, compose both checks and verify the resulting hook before applying the migration. Test AAL1 denial, AAL2 access, Storage access, and authenticator recovery in staging before rollout.

## Apply the hosted email-code settings

The screenshot showing **Your sign-in link** means the hosted Magic link template still contains a confirmation link. The application calls the same Supabase OTP endpoint for email codes. Its email content comes from the hosted template.

After setting `SUPABASE_ACCESS_TOKEN` in your own terminal, run from the repository root. The first command previews whether changes are needed. The second applies the two repository email templates, six-digit code length, ten-minute expiry, and TOTP enrollment and verification settings, then reads the settings back to verify them.

```sh
node scripts/configure-hosted-auth.mjs --project-ref hrxjgbupjtikokqxjzbh
node scripts/configure-hosted-auth.mjs --project-ref hrxjgbupjtikokqxjzbh --apply
```

Use `bwswqnhlebbzdxumlkih` as the project reference for staging. The command requires project management access and reports no credentials or complete Auth configuration. Request a new sign-in code after the template update. Previously delivered messages retain their original content. Custom email hooks, if enabled, control their own email content.
