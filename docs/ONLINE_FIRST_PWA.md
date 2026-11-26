# Atlas OS online-first PWA and recovery contract

Date: 26 November 2026. Applies to the existing React/Vite ERP and Astro website. This is an incremental implementation, not a statement that the entire ERP scope is complete.

## What ships

- ERP manifest, existing-brand PNG and maskable icons, standalone launch, production-only registration, and an Installation Centre at `/install.html`.
- The existing public website `/download` page links to the application Installation Centre when its validated application URL is configured. Existing industry routes and native release status remain in place.
- Network-first navigation with a public offline fallback. Only an explicit list of installation resources is precached. No private HTML, application route responses, API responses, tokens, financial documents, or third-party requests enter the service-worker cache.
- A release-specific worker cache identity. A waiting worker never forces a reload or invokes skipWaiting. Save work and close all Atlas OS windows before reopening to activate the update.
- Network-failed invoice creation, payment recording, and stock adjustment retain their existing recovery request and idempotency key, but now throw a pending-confirmation error. They do not return fabricated invoices, receipts, allocations, or stock movements as successful operations.

## Recovery boundaries

The existing recovery queue predates this change and stores pending payloads in browser localStorage. This release neither deletes pending user data nor adds private service-worker caching. The queue is not an encrypted financial backup. Use trusted devices, reconcile ambiguous requests with authoritative server records, and reuse the same idempotency key. Existing server authorization and transactional RPC checks remain authoritative during replay.

No general-purpose offline financial database or conflict-resolution protocol is introduced. An offline fallback page cannot post financial transactions. A browser online event reports device connectivity, not proof that the business backend is healthy. Forms and pending requests must remain distinguishable from confirmed records.

## Local verification

From the repository root:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
node --test scripts/pwa-security.test.mjs
node scripts/verify-pwa.mjs
npm run build:owner
$env:PLAYWRIGHT_PORT = '5188'
npm run test:e2e
npm --prefix atlas-os-website run build
```

`verify-pwa.mjs` serves the real production output on a random loopback port. It checks Chromium installability, manifests/icons, a real worker, cache exclusion, offline fallback, reconnection, deferred worker activation, and mobile overflow. Screenshots go to ignored `test-results/pwa`. Browser checks do not prove installed Start menu integration or authenticated hosted Supabase access. Check Edge and the Windows installation workflow on the intended deployment as separate release gates.

The existing database acceptance harness must run only against a disposable local PostgreSQL instance. It creates and removes isolated test databases; never point it at customer data. Hosted staging authorization requires explicit test credentials and the repository's confirmation guard.

## Deployment and installation

1. Build with the existing public Supabase URL and publishable/anon key. Never add a service-role or secret key to Vite configuration. Preserve existing environment files.
2. Publish the existing `dist` directory at an HTTPS origin root. Keep the existing SPA fallback, serve manifest/JavaScript/PNG with correct MIME types, and deploy all resources atomically. Root hosting is required by the current absolute asset URLs.
3. Serve `/sw.js` with revalidation/no-store; keep `/version.json` uncached. Vercel headers and Cloudflare-compatible `_headers` are included. Confirm headers on the actual host; other hosting services may require equivalent configuration.
4. Build the existing Astro website with a validated HTTPS `PUBLIC_APP_URL`, then publish its output using its existing deployment process. That setting controls installation links. A missing URL shows an honest unavailable state.
5. Keep the private owner console on its separately configured private origin, following existing owner-seat and authenticator requirements. Do not turn the PWA manifest into an authorization mechanism.
6. Open the app's Installation Centre in current Chrome or Edge. Use its install prompt or the browser's app installation menu. Windows Start menu and standalone launch depend on browser/OS support and policy.
7. Keep this release online-first. Restore connectivity and retry the workspace from the offline screen. Save work and close every app window before activating an update.

No external deployment, native installer, paid service, payment gateway, or hosted database migration is performed by this change.

## Future native desktop/mobile boundary

Preserve `src/lib` financial/tax/permission logic and service contracts as shared domain boundaries. Introduce a native adapter only after specifying authenticated device registration, encrypted local SQLite storage, revocation, short-lived credentials, and tenant-specific encrypted backup ownership. Keep service-role keys server-side.

Before allowing offline posting, specify journal ownership, numbering reservations, idempotency, ordering and concurrent stock constraints, immutable audit records, conflict resolution, financial-period closure, interrupted synchronization, and authoritative reconciliation. Validate those contracts against a disposable backend with replay, multi-device and tenant-switch tests. Add native printing/hardware interfaces through adapters rather than browser-specific logic inside the business engine. Local-network access and offline license verification require separate security designs. No Tauri, SQLite or native runtime dependency is installed in this stage.

## Production gates and cost

This change adds no service dependency and incurs no additional infrastructure subscription cost. Existing account costs and quotas have not been inspected. Static hosting can serve the frontend; it does not replace Supabase PostgreSQL, authentication, storage, Edge Functions, email delivery or their operational limits.

Before a commercial rollout: verify deployed RLS and grants, tenant isolation and MFA recovery; reconcile edition/backend entitlement mappings; verify full accounting/tax requirements with authoritative sources and professional review; run authenticated end-to-end tests; test invoice printing/export; configure and restore-test restricted backups; test supported browsers and installed Windows behavior; measure realistic dataset/load performance; and review the selected providers' current storage, bandwidth, invocation, email, inactivity and backup limits. No measured performance improvement or automated hosted backup is claimed by this stage.

PWA technical reference: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable

## Pre-push verification — 26 November 2026

This stage covers the installable online-first PWA, public installation guidance, financial pending-confirmation behavior, and payment-form cancellation. It does not complete the entire accounting, edition-entitlement, industry, or native-application roadmap.

Executed local checks:

- Full Vitest suite: 901 passed, 39 skipped, no failures (96 files passed, 2 skipped). Skipped tests are not counted as passes.
- Disposable PostgreSQL 16 acceptance: 347/347 contracts passed, including tenant/role isolation, atomicity, idempotency, forward upgrades and logical restore. Restore compared 12 operational tables and retained owner MFA boundaries. All fixture databases were disposed and the local test server was stopped.
- The existing 250 ms query limits passed with normal test-instance buffers: 50-stock batch 1 ms, 25-receivables batch 1 ms, eligible-invoice page 9 ms. This is synthetic local evidence, not a production capacity claim.
- Complete ERP Playwright suite: 75/75 passed. Individual test limits and assertions were unchanged; total execution was 59.1 seconds.
- Complete website Playwright suite: 51/51 passed, including generic launch selection and all industry installation/export links. Contact/delivery assertions used mocked CI endpoints; no real enquiries or emails were sent.
- PWA cache security: 5/5 passed, plus actual production Chromium installability, offline fallback, reconnection, cache exclusion and deferred-update acceptance.
- Root and website TypeScript, root lint, ERP build, separate owner build, website build and static verification passed. Website fixture configuration was restored and a normal website build was generated afterward; no environment file was overwritten.
- Website lead unit tests 16/16, preview-server tests 3/3, and supplementary migration/auth-configuration/staging-gate harness tests 11/11 passed.
- Both root dependency advisory gates reported zero vulnerabilities; the existing website advisory gate passed.

The general Installation Centre opens the shared application without forcing an industry. Industry pages retain their matching workspace links and optional shortcut exports, with supported browser installation as the primary action. Chromium on Windows sanitizes shell-integrated `.url` exports to `.download`; tests verify the requested export name, exact shortcut content, actual platform-specific saved name, and real installation link. This preserves the browser protection rather than bypassing it. See the [Chromium filename implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/filename_util_internal.cc).

PWA cache-policy and production lifecycle checks are now part of the existing GitHub CI workflow. Hosted Supabase policy/catalog state, real account/MFA recovery, branded Chrome/Edge Windows installation, provider operations and commercial readiness still require deployment-specific verification. No hosted database migration or manual deployment was performed.
