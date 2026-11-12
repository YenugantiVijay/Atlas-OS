# Atlas OS — Initial Source, Security and Cleanup Audit

Date: 12 November 2026. Scope: ERP React/Vite code, website Astro code, independent acceptance control center, GitHub CI and **read-only** Supabase staging checks. Production and the 200-entry Demo Mode industrial test are excluded. Follow Vijay-Atlas → tests → PR → main.

## Evidence-based findings

- At the starting point, GitHub contained 472 tracked files and 79 directory entries (551 total tree entries), 48 real Supabase SQL migrations, 83 test/spec files, and 109 historical documents. Do not indiscriminately delete historical audits, migrations, lockfiles, or tests.
- PR #62 was already merged and the sole development branch was fast-forwarded to main.
- Staging SQL audit found no ordinary/partitioned public tables with RLS disabled. There are 61 public functions, 49 SECURITY DEFINER functions, 39 executable by authenticated, and zero SECURITY DEFINER functions executable by anon. This is not proof that all authenticated authorization rules are safe.
- Database Security Advisor reports one informational policy-free service-only website lead limiter table plus 39 warnings about authenticated-callable SECURITY DEFINER functions. Some RPCs are intentionally public to authorized users; review per-function tenant, role and session guards before revoking.
- Performance Advisor reports 32 unindexed foreign-key relationships, two per-row RLS auth expression optimizations, and several unused-index notices. An index with zero observed usage in a nearly empty database is not automatically safe to delete.
- Staging has one real Auth user, one organization, one membership, zero goods receipts and zero stock movements. Real multi-tenant and full GRN/posting/quote acceptance remain blocked.

## Cleanup confirmed safe by code ownership and runtime imports

- The old 14-file Hatchable backend implementation is unused by the standalone Acceptance Control Center (running site/local/server.mjs and its own data store). Delete its old source and retired Hatchable-specific migrations **from Git only**; this does not delete its remote hosted database or any Atlas OS Supabase migration.
- Remove tracked atlas-os-website/.astro/types.d.ts, a generated file already excluded by the website's .gitignore.
- Remove the confirmed unused root application dependencies @hookform/resolvers, @supabase/ssr and react-hook-form, plus the now-orphaned cookie transitive dependency. The lockfile is updated in the same commit. The dependency references were cross-checked against the entire scanned source tree and lockfile reverse dependencies.
- Add a read-only CI gate to reject accidental tracked generated files, private environment files, obvious secret-key/private-key material, regression-suite removal and reintroduction of the retired runtime. Remaining static dependency candidates are review-only.

## Newly confirmed critical development-server exposure

The root vite.config.ts previously used server.host=true while the lockfile contained Vite 6.4.5. Maintainer advisory GHSA-p4f5-76q4-ffq7 (published 10 November 2026) affects this version if the development server is reachable over the network. This is a development-workstation risk, not evidence of a production static-build compromise. Default development binding has been restricted to 127.0.0.1 with a strict port, and the repository hygiene test now rejects host:true / 0.0.0.0. Vite was subsequently upgraded and locked to the verified patched 6.4.6 release, with package.json and package-lock.json updated together. localhost binding and the hygiene guard remain in place; do not expose development endpoints to the public network.

Advisory: https://github.com/vitejs/vite/security/advisories/GHSA-p4f5-76q4-ffq7

## Confirmed preview file exposure risk addressed

The old atlas-os-website/scripts/serve-preview.mjs listened on 0.0.0.0 and joined a decoded, untrusted URL path directly onto dist, without a containment check. This created a potential arbitrary file-read path during LAN preview (for example dot-dot navigation to website source/config files). It is now localhost-only and rejects encoded Windows/Unix parent segments, bad escapes, unsupported methods, and symlinks outside the static build root. A dedicated Node preview HTTP regression suite runs in website CI. Production Firebase hosting uses a different static server and was not modified.

## Dependency supply-chain triage (CI npm audit, 12 November 2026)

- Full application npm dependency audit: **14 advisories** (11 moderate, 1 high, 2 critical) at time of scan. Production-only audit: 5 (4 moderate, 1 high). This audit explicitly does not dismiss them just because tests pass.
- **Vitest 3 / tinypool (2 critical)**: development/test-runner dependency; upgrade to Vitest 4.1.12+ needs focused compatibility testing, not automatic forced major migration.
- **Zod 3 (high)**: constrained-array memory exhaustion. Next review every untrusted validation boundary and apply input-size caps while planning Zod 4 migration. Do not force-upgrade without running operational validation tests.
- **React Router 6 (moderate)**: open-redirect/SSR-hydration advisories. Current application is a client-side hash router, not React Router SSR. Still plan a validated v7 upgrade, and review user-controlled navigation input.
- **UUID via ExcelJS 4 (moderate)**: exported Excel workbooks are generated using `.xlsx.writeBuffer()` in src/lib/excel.ts; no untrusted workbook loading path currently identified. Avoid the audit-suggested incompatible downgrade without targeted export tests.
- **Vitest mocker / TypeScript ESLint minimatch**: build/test tool dependency issues; upgrade in separate CI-reviewed PRs.
- **Vite 6.4.5 dev-server advisory**: root Vite upgraded to **6.4.6** and localhost-bound; this patched update must pass CI and Playwright before merge.
- The CI audit inventories known issues but is intentionally nonblocking until severity, exposure, migration and regression plans are approved.

## Prioritized unresolved verification

| Severity | Finding | Required next proof |
| --- | --- | --- |
| Release blocker | No staging tenant B or separate role accounts | Test real issued JWTs for two organizations and owner/admin/inventory/accounts/sales roles; check denied cross-tenant REST/RPC requests and server audit trails |
| Release blocker | Real authenticated GRN/quote flow incomplete | Create a test product, verify notebook survives navigation, save DRAFT with zero movement/price events, post exactly once with 122 units, check duplicate replay and unchanged selling price |
| High review | 39 authenticated SECURITY DEFINER RPC advisory warnings | Inventory and review each function's active membership, tenant and role checks, search_path, grant and calling contract; test via low-privilege JWTs before changes |
| Medium | 32 FK/index performance advisories | Examine busiest goods receipts, price history, ledger and invoice queries with EXPLAIN on representative staging data before narrow indexed migrations |
| Medium | Two RLS auth expression optimization warnings | Use SELECT-wrapped auth.uid() where appropriate in a separate reviewed migration and rerun RLS acceptance |
| Medium | Hardcoded website canonical fallback (atlasos.business) | Verify owned HTTPS domain and enforce PUBLIC_SITE_URL before public website release |
| Medium | Potential unused dependencies and obsolete code | Inspect static dependency candidates plus dynamic/peer imports; change package.json and lockfile together in a subsequent focused PR |
| Low | Full repository security automation | Expand secret scanning, SCA, supply-chain auditing and browser accessibility/performance budgets in controlled follow-ups |

## Release status

NO-GO for live production until authenticated staging acceptance, performance and security exceptions are reviewed. The historical database and authorization CI tests still run. This audit is an initial verified pass, **not** a claim to have proven every code path safe.

Evidence: GitHub PR #62, Supabase staging Security and Performance Advisors, standalone Acceptance Control Center.
