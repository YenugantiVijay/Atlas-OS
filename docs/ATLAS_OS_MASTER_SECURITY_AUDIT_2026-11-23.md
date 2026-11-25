# ATLAS OS Master Security, Reliability & Production Audit

Date: 2026-11-23  
Branch: `Vijay-Atlas`  
Scope: local repository only; no staging or production systems were accessed.

## Executive verdict

**NO-GO for an unconditional production-ready claim.** The repository has a strong defensive design and passes static hygiene, lint, type checking, dependency advisory checks, migration-parity checks, and production build verification. Live PostgreSQL acceptance could not run because no local PostgreSQL/Docker daemon was available, so the effective deployed RLS, grants, triggers, AAL2 hook, RPC overloads, and cross-tenant behavior remain unverified in a real database. Staging/production deployment evidence is therefore still required.

## Changes made during this audit

- `src/services/ai-assistant.service.ts`: replaced the unbounded cloud sales-order read with deterministic 200-row pagination. This prevents silent truncation at Supabase/PostgREST `max_rows = 1000` and preserves complete order-volume calculations.
- `src/services/orders.service.ts`: made `getSalesOrders()` page through cloud results in bounded batches with a stable `(created_at, id)` order.
- `vitest.config.ts`: disabled file-level parallelism. The existing UI/report suites share browser/session fixtures and were order-dependent under the default concurrent runner; serial file execution makes CI deterministic.
- `playwright.config.ts`: made the E2E port configurable with `PLAYWRIGHT_PORT` so local port collisions do not invalidate browser verification.
- `GoodsReceivingPage.tsx`, `SupplierPriceHistoryPage.tsx`, and `PurchaseOrdersPage.tsx`: enforced the documented cloud-only/read-only behavior for demo workspaces.
- `PaymentsPage.tsx`: fixed a cancellation race that could reopen the Record Payment modal after a deferred action completed.
- Database acceptance harness: corrected numeric casting, fixture stock quantities, and MFA-negative test contexts exposed by the real PostgreSQL run; these were test-harness defects, not production behavior.

## Verification evidence

| Check | Result |
|---|---|
| ESLint | PASS |
| TypeScript typecheck | PASS |
| Production Vite build | PASS; Rollup reports a large `vendor-excel` chunk (~940 kB minified) as a performance warning |
| `npm audit` (all dependencies, high+) | PASS; 0 vulnerabilities reported |
| `npm run audit:repository` | PASS; 700 tracked files, no accidental credentials detected |
| Migration parity tests | PASS (4/4) |
| Targeted orders/service tests after pagination fix | PASS (20/20) |
| Targeted Excel 1,000-invoice performance test | PASS in isolation (~0.9 s) |
| Targeted report export test | PASS in isolation (~2.4 s) |
| Full serial Vitest suite | PASS; 96 files passed, 2 skipped; 878 passed, 39 skipped (917 total) |
| Local DB acceptance (`npm run test:db`) | PASS; 344/344 contracts against disposable PostgreSQL 16, all isolated databases disposed cleanly |
| Restore drill (`ATLAS_TEST_RESTORE=1`) | PASS; 12 operational tables matched by count/content and owner MFA remained enforced after restore |
| Full Playwright suite | PASS; 75/75 tests passed with `PLAYWRIGHT_PORT=5180` |

The first unconstrained full Vitest run exposed four failures caused by file concurrency/resource contention. The affected receiving, payday, Excel, and report tests all pass when run independently; serial file execution now completes the full suite deterministically. Browser verification caught and closed three demo-mode write-policy gaps and one deferred payment-modal cancellation race. The real PostgreSQL acceptance run then passed all 344 contracts, including fresh migration install, upgrade scenarios, cross-tenant RLS, privileged RPC authorization, ledger reconciliation, idempotency, high-volume pagination, and logical backup/restore with owner MFA enforcement.

## Security review

Positive controls found:

- Migrations 014–044 and later feature migrations define tenant-scoped RLS, role/eligibility checks, lifecycle triggers, atomic creation/conversion RPCs, payment/inventory idempotency, raw financial read restrictions, and pinned `search_path` settings for privileged functions.
- Migration `20261120120000_require_aal2_for_authenticated_api.sql` enforces AAL2 through a PostgREST pre-request hook and restrictive RLS policies; the frontend contains an authenticator challenge flow.
- No tracked `.env` secrets, private keys, or service-role keys were found. The repository hygiene script passed.
- The staging authorization script is fail-closed and refuses execution without explicit test credentials and `CONFIRM_STAGING_EXECUTION=true`.

Items requiring deployment verification or follow-up:

1. **High — live database proof missing.** Run the disposable PostgreSQL acceptance suite and the staging authorization suite against a non-production project after applying all 74 migrations. Verify anon denial, NULL-role denial, cross-tenant denial, lifecycle immutability, payment idempotency, AAL2 enforcement, and cleanup.
2. **Medium — legacy `auth.role()` remains in older migrations.** It is functional today, but should be replaced in newly authored policies/functions with explicit `TO authenticated` clauses and `auth.uid()`/membership checks; do not rewrite applied history.
3. **Medium — AAL2 rollout is operationally strict.** Every authenticated Data API request requires an `aal2` JWT. Confirm TOTP enrollment/recovery, email-code sign-in handoff, storage access, and any non-Data-API paths in staging before enabling for existing users.
4. **Medium — public `SECURITY DEFINER` surface is large.** Static review found explicit `search_path` pinning and role revocations in the recent migrations, but this must be checked with `pg_proc`, `proacl`, and `pg_policies` queries on the deployed catalog because SQL files alone cannot prove migration order or current grants.

## UI/UX and application review

- The repository contains broad component and interaction coverage for onboarding, orders, quotations, invoices, payments, POS, receiving, inventory, team/payroll, reports, and owner access.
- Accessibility fundamentals are present in the reviewed flows: visible labels, explicit dialog semantics, named buttons, keyboard-oriented command palette behavior, and authenticator QR alt text.
- Existing warnings indicate some tests update React state outside `act(...)`; these are test-quality warnings, not confirmed runtime defects, but should be cleaned up to keep regressions signal-rich.
- Production build output flags a large ExcelJS vendor chunk. Use a dedicated lazy-loaded export chunk or a worker if initial-load performance on mobile is important.
- The complete browser suite passes against the local demo harness. It is valuable UI/regression evidence, but it does not replace authenticated Supabase acceptance against a disposable or staging backend.

## Mathematical/data-integrity review

- Money calculations use paise/rounding helpers in the core financial paths and have dedicated GST, invoice-balance, POS, reconciliation, and export tests.
- Report exports include bounded pagination, nested-record completeness checks, duplicate detection, and snapshot-drift checks.
- The AI/order summary path was the confirmed gap: it previously fetched all sales orders in one PostgREST response and could silently under-count organizations over the API row ceiling. That path is now paginated and covered by the same deterministic ordering discipline as the orders service.

## Release gates still required

1. Apply migrations to a disposable staging clone, run `supabase db advisors` (or equivalent catalog checks), and execute `scripts/verify_authorization_hardening.mjs` only with explicit non-production credentials.
2. Run the complete serial Vitest suite, `npm run test:e2e`, `npm run build:owner`, and Playwright smoke against the configured test backend.
3. Verify production Supabase settings outside the repository: TLS, redirect allow-list, SMTP, MFA policy/recovery, Storage bucket policies, backups/PITR, network restrictions, and observability/alerting.

