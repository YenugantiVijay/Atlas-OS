# Atlas OS email verification and sign-in codes

Atlas OS verifies new email and password accounts with a six-digit email code. Existing users can sign in with their password or request an email code. Both flows work with a Gmail address or any other email address. If Google OAuth is enabled separately, use Google's identity verification for that flow.

| Supabase template | Subject | HTML |
| --- | --- | --- |
| Confirm signup | Verify your Atlas OS email | [confirm-signup.html](./confirm-signup.html) |
| Magic link | Your Atlas OS sign-in code | [sign-in-code.html](./sign-in-code.html) |

## Staging rollout

1. Open **ATLAS-OS-Staging**. In **Authentication → Providers → Email**, enable email sign-up and confirmation and set the code to six digits with a 600-second expiry. Keep at least 60 seconds between code requests. Configure custom SMTP with a verified sender for delivery to external email addresses.
2. In **Authentication → Emails**, update both templates above with their matching subject and HTML. The `{{ .Token }}` variable renders the code. Keep password reset and invitation templates as configured.
3. Apply database migrations `054` and `055` in order. The new business categories become available after both migrations. Deploy the app build with the code-entry screen in the same release as the template update.
4. Create a staging test account with a controlled Gmail address. Confirm email delivery, enter the code, and check that onboarding opens only after verification. Test invalid and expired codes, resend, and password and email-code sign-in for the verified account. An email-code request for an unregistered address should leave the user count unchanged.
5. Open a recorded payment with Starter, Professional, and Enterprise Network staging fixtures. Verify the one- and two-copy A4 prints and reconcile the daily totals against recorded payments. The subscription service should use `starter`, `professional`, or `enterprise_network` as the plan tier. The app reads the stored edition and active period.

Local Auth uses the email settings in `supabase/config.toml`. Changing the repo templates prepares the application release. Hosted Auth template and SMTP settings are configured per project.

[Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates) · [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
