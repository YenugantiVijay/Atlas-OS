# Atlas OS — Supabase branded confirmation email

**Subject:** Confirm your email address | Atlas OS

The copy-ready HTML is in [confirm-signup.html](./confirm-signup.html).

## Apply safely to staging

1. Open **ATLAS-OS-Staging** in Supabase (project ref: `bwswqnhlebbzdxumlkih`).
2. Go to **Authentication → Emails → Confirm signup** (the hosted Auth email-template editor).
3. Change the subject to **Confirm your email address | Atlas OS**.
4. Paste the full raw HTML from `confirm-signup.html` into the HTML editor.
5. Preview, save, and send a fresh confirmation test email to a staging-only address.
6. Check Gmail/Outlook rendering, CTA behavior, fallback link, and redirect to the staging Site URL.

**Do not paste into the separate main production Supabase project without approval.** This repository artifact alone does *not* update Supabase's hosted email configuration.

## Security and compatibility

- `{{ .ConfirmationURL }}` is the supported Supabase Go template variable for the actual one-time verification link.
- No API keys, passwords, tokens, or hardcoded localhost URLs appear in the template.
- The template uses inline CSS and presentation tables for common email clients.
- The URL comes from Supabase; preserve the exact variable syntax in both the button and fallback link.
- For email providers that prefetch security links, consider Supabase's OTP or server-side confirmation-page guidance. Do not change authentication behavior solely for email appearance.

Reference: https://supabase.com/docs/guides/auth/auth-email-templates
