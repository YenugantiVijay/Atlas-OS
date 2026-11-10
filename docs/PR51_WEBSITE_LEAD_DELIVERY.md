# PR #51 — Real website enquiry delivery

**State:** Code prepared in GitHub; deploying the API, real email provider, CAPTCHA and database migration is a separate explicitly approved operation. **Until configured, the website forms fail closed and do not claim delivery.**

## What changed

The Contact form, Demo Request form and desktop release notification form no longer store submissions in the visitor's `localStorage` or display a false success card.

When configured:
1. The visitor completes Cloudflare Turnstile.
2. A public Supabase Edge Function checks exact origin, required fields, body limits, CAPTCHA token/action/hostname and server-side per-hour limits.
3. The function uses the Resend HTTP API with a unique `Idempotency-Key` to submit a **real email notification** to the business inbox.
4. Only a real provider acceptance (`200` and email ID) yields website success. Failed network, CAPTCHA, rate limit or email requests display an error.
5. The visitor's name/phone/email/message are not written to the ERP's customer or financial tables. The database stores only secret-salted rate-limit hashes and counters.

**Email accepted by a provider does not guarantee it reached the inbox.** Before live launch, submit a real test lead to a verified inbox, check spam and routing, and monitor bounced emails in the email provider. There is no CRM lead inbox or retry queue in PR #51; if the provider is unavailable, the visitor receives a failure and may retry.

## Required separate services

- A **Supabase project** hosting the public function and rate-limit table. Prefer a dedicated marketing project or a separate environment from production ERP if the budget allows; the current primary ERP project must not be changed without backup and approval.
- **Resend** (or another supported email API after adapting the function). Verify domain ownership and configure a real operational inbox.
- **Cloudflare Turnstile** registered for every actual marketing-site hostname. The public site key goes into the website; the secret key stays only in Edge Function secrets.
- A working HTTPS website deployment that includes correct build-time public settings.

No business email address was guessed. `LEAD_NOTIFICATION_TO` must be an inbox that the business controls and verifies before deployment.

## 1. Database migration — deploy to reviewed staging first

`supabase/migrations/045_website_lead_rate_limits.sql` creates:
- `public.website_lead_rate_limits` with RLS, no anonymous/authenticated data grants;
- `public.consume_website_lead_rate_limit(text)` granted only to `service_role`;
- atomic max-five-per-hour throttle per salted subject hash, with no plaintext user identifiers.

The disposable PostgreSQL CI suite proves that `anon` and `authenticated` cannot read/write the table or invoke the RPC, and that rate limits are concurrency-safe under UPSERT.

**Do not run a database reset, direct remote test fixtures or unapproved migration against production.** The staging Supabase project was inactive during the prior audit; stage activation and credentials must be verified first.

For long-term operation, periodically purge old rate-limit buckets using a separately approved housekeeping job (e.g. older than 30 days). This PR intentionally does not create an automatic privileged deletion job.

## 2. Edge Function deployment

Source:
- `supabase/functions/submit-website-lead/index.ts`
- `supabase/functions/submit-website-lead/lead-handler.mjs`

`supabase/config.toml` sets `[functions.submit-website-lead] verify_jwt = false`, because prospective website visitors are not logged-in ERP users. The endpoint instead requires exact allowed origins, successful Turnstile verification and server-side throttling.

Required **Edge Function secrets**:

| Secret | What to configure |
|---|---|
| `RESEND_API_KEY` | Private Resend API key with email-send permission |
| `LEAD_NOTIFICATION_TO` | Verified business inbox receiving website leads |
| `LEAD_SENDER_EMAIL` | Verified sender address for Resend |
| `TURNSTILE_SECRET_KEY` | Private Cloudflare Turnstile verification key |
| `LEAD_ALLOWED_ORIGINS` | Comma-separated exact origins of real website domains; never `*` |
| `LEAD_HASH_SECRET` | Random secret at least 32 characters for keyed contact/IP hashes |
| `SUPABASE_URL` | Edge runtime default API URL for the same project |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** role key for rate-limit RPC; never expose in client |

The Supabase runtime normally injects `SUPABASE_URL` and legacy `SUPABASE_SERVICE_ROLE_KEY` (depending on the project's API-key setup). Confirm their availability in the target environment. Never print secrets in logs or commit them to GitHub. For new key formats, adapt the server secret handling before deployment.

The Edge endpoint, once deployed, is of the form:

`https://<approved-project-ref>.supabase.co/functions/v1/submit-website-lead`

Use the official Supabase CLI/docs to deploy from this repository, review `verify_jwt` behavior, and confirm the function responds to CORS preflight for the actual marketing-site origin. The public API must **not** use a privileged service key in browser code.

## 3. Website build-time configuration

In `atlas-os-website/.env` or your website builder/deployment environment:

```dotenv
PUBLIC_LEAD_ENDPOINT=https://<approved-project-ref>.supabase.co/functions/v1/submit-website-lead
PUBLIC_TURNSTILE_SITE_KEY=<your-public-cloudflare-site-key>
```

The **public** endpoint and **public** site key are safe in a browser. Build the Astro site after setting them; merely changing the server environment without rebuilding the static website will not update the client bundle.

Never put `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY` or `LEAD_HASH_SECRET` in `PUBLIC_*` variables or frontend source files.

If any public config is absent, submission buttons stay unavailable and the form displays that delivery isn't ready. No visitor data is silently stored in localStorage.

## 4. Testing before release

Automated:
- `cd atlas-os-website && npm run test:leads`: Node 22 tests with mocked Turnstile, Resend and Supabase calls.
- `npm run test:db` from repository root: disposable PostgreSQL role tests, including WEB-51 counters.
- Website CI builds with **fake test-only** endpoint/site key and runs `e2e/leads.spec.ts` against intercepted network responses.
- No test sends an actual email or modifies a hosted database.

Manual staging release checklist:
1. Confirm clean staging and backups; apply migration 045.
2. Configure approved origins and both secret and public Turnstile keys for staging hostname.
3. Set Resend's verified sender and your real inbox; send a test contact and demo request.
4. Verify a **real inbox notification**, its reply-to, no duplicate notifications on retries, and bounce/spam handling.
5. Confirm bad CAPTCHA, cross-origin, invalid email, missing secrets, rate-limit and provider failure paths do not show success.
6. Test desktop signup and confirm your team actually receives it.
7. Review privacy notice, provider data processing, retention obligations and the website's claimed support email aliases.
8. Only then approve production deployment and website rebuild.

## Out of scope

- Subscriptions, CRM inbox, lead queue/retries and multi-email routing.
- Direct website-to-ERP financial/stock data access.
- Real-time provider delivery guarantees, inbox read receipts, or automated follow-up.
- Production project changes and the deferred 200-entry Demo Mode ERP industrial test.

**Next release gate:** approved staging deployment plus successful real inbox test. A merged PR by itself is not proof of email delivery.
