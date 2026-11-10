# SEC-02 — Privileged RPC Authorization & Staging Release Gate (PR #50)

**Status:** Code committed to `Vijay-Atlas`; disposable-DB CI must pass before merge. **No live Supabase project was modified.**

## Evidence and source

Read-only inspection of connected primary Supabase project on 2026-11-10:
- Primary project `Atals-OS`: active; migration history recorded through **043**.
- Separate project `ATLAS-OS-Staging`: **inactive**. Migration listing timed out; schema, data and test credentials are **not verified**.
- Public tables: 26/26 have RLS enabled. This is not a guarantee that every policy/RPC is safe.
- Public functions: 54 total, 43 SECURITY DEFINER; 37 callable by authenticated and 0 by anon.
- Three search-path advisor warnings: `prevent_audit_log_mutation`, `mask_pan`, `mask_gstin`.
- Audit diagnostic `inspect_audit_privacy_compliance()` ran with SECURITY DEFINER and an authenticated grant. Its owner/admin authorization branch referred to **`public.organization_members`**, which is absent from the current schema (the real membership table is `public.memberships`). Its result scans **global audit totals across organizations**. This function must **not** become an authenticated per-org API.
- Legacy `allocate_document_number(org, type, year)` validated active membership, business eligibility and subscription, but did **not** check a specific role. This allowed a viewer with an active tenant and subscription to advance external document sequences by calling the RPC directly. `src/services/numbering.service.ts` still calls this RPC, so blunt removal would break existing compatibility.
- The **37** other authenticated-callable SECURITY DEFINER functions need per-function authorization review, but their grant alone is not proof of a vulnerability.

## PR #50 change — migration 044

`supabase/migrations/044_harden_privileged_rpc_and_search_paths.sql`:

1. Keep legacy numbering API working for authorized operators, while enforcing:
   - `QUOTATION` and `SALES_ORDER`: active **owner/admin/sales** member.
   - `INVOICE`: active **owner/admin/accounts** member.
   - `RECEIPT`: never directly allocatable; receipt numbering is part of atomic payment RPC.
   - All existing active membership, eligibility and subscription checks remain.
   - Authenticated nonmember, viewer, inventory-only and cross-tenant callers must fail with SQLSTATE `42501`.
   - **Important**: Document-number preallocation is legacy compatibility, not the preferred atomic document creation strategy. Future cleanup should avoid advancing statutory sequence values outside successful business transactions.
2. Revoke global `inspect_audit_privacy_compliance()` execution from `PUBLIC`, `anon`, and `authenticated`, leaving only `service_role`. Do **not** return global audit totals to one tenant's owner/admin.
3. Pin `search_path = pg_catalog, pg_temp` on the three built-in-only functions flagged by the security advisor, without changing their implementation or redaction behavior.

No existing customer, product, invoice, stock or payment rows are modified by this migration.

## Disposable PostgreSQL acceptance

`scripts/sec02_privileged_rpc_acceptance.mjs` is run via `scripts/run_local_db_acceptance.mjs` after the master runner provisions an isolated database and applies **all migrations**.

Checks:
- Actual database-role grants, not just React route guards.
- Anonymous and owner denial for global audit diagnostic; successful service-role access.
- Owner allowed for own quotation and denied against another organization.
- Denials for viewer and inventory roles on sales/invoice numbering.
- Sales allowed for sales-order allocation but denied invoice numbering.
- Accounts allowed invoice allocation but denied sales-order allocation.
- Direct receipt allocation blocked.
- All three search paths pinned in `pg_proc`; mask functions still redact sensitive identifiers.
- Org B's fixture remains unchanged; Org A's role restored even if tests fail.
- Existing FIN-01, SEC-01, B2, lifecycle, financial and stock tests still run.

**Safety:** Test runner rejects non-local PostgreSQL connection hosts and creates a disposable isolated database. Never run these authorization-fixture mutations directly on production.

## Staging prerequisites — NOT yet satisfied

1. Restore/resume `ATLAS-OS-Staging` in the Supabase dashboard (review any plan/billing implications before doing so).
2. Confirm it is a designated throwaway test environment with **no real customer data** and has separate credentials.
3. Confirm staging migration history and check discrepancies with repository `001`–`044`; **do not** use production credentials to run tests.
4. Configure the existing guarded `scripts/verify_authorization_hardening.mjs` with explicit `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, and `CONFIRM_STAGING_EXECUTION=true` **only after** confirming the script's cleanup expectations and staging-only project target. Secrets must not be committed to GitHub, logs or client builds.
5. Apply migration 044 to staging only after current staging backups/checkpoints and diff review. Run the security advisor, deployment smoke tests and rollback rehearsal.
6. Confirm the six-role matrix, account revocation, tenant crossover, financial search/report denial paths and the POS draft workflow from real authenticated sessions.
7. Resolve any confirmed security defects before scheduling production migration; production rollout requires separate approval, a verified backup and recovery plan.

## Remaining explicit release blockers

- `ATLAS-OS-Staging` inactive: end-to-end cloud acceptance remains **unverified**.
- Supabase Auth **leaked-password protection** is flagged by advisor. Enable through Auth configuration if available on the plan, after review.
- Security advisor still flags other authenticated-callable privileged functions; map each to required consumer, direct callers, `auth.uid()`, membership, role and table-level implications before changing grants.
- Database performance advisor flagged 28 unindexed FK notices, 2 auth/RLS initplan notices, 1 duplicate index warning and 12 unused-index notices. Measure production workloads before index drops/additions.
- Website real contact/demo lead delivery, checkout/payment policies, full purchase/GRN, returns and subscription entitlements are separate product milestones.
- The **200-entry Demo Mode stress test remains paused** until feature development is complete.

## Rollback / no-deployment rule

PR merge is **not** a database deployment. Migration 044 is forward-only and should be rolled out with controlled release procedures. Do not undo a security fix by restoring authenticated EXECUTE on `inspect_audit_privacy_compliance()` without an independent tenant-scoped alternative and reviewed access contract. If staging fails, stop rollout and diagnose with test evidence; never run a destructive rollback or reset on a production project.
