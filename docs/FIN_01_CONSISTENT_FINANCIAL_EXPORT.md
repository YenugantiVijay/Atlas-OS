# FIN-01 — Statement-Consistent Financial Excel Exports

**Status:** First implementation on `Vijay-Atlas`; disposable PostgreSQL, TypeScript, Vitest and Playwright CI must be green on the final commit before merging.
**Date:** 2026-11-07
**Prior work:** SEC-01 phase 2 merged as PR #37; migration 039 is part of main.
**Next planned milestone:** B2 — Atlas Universal Search.

## Problem

The historical browser export loaded invoice pages, embedded line items, payment pages,
allocations and referenced invoice metadata using separate PostgREST requests.
PostgreSQL READ COMMITTED gives each request its own MVCC snapshot. A concurrent
edit can change balances or invoice status while the invoice count remains identical.
Rechecking only record counts cannot guarantee a coherent workbook.

## Implementation

- Migration `040_financial_export_single_statement_snapshot.sql` creates
  `public.get_financial_export_snapshot(org, start, end, docType, customer, status)`.
- The RPC is `LANGUAGE plpgsql STABLE SECURITY DEFINER` with fixed search path,
  mandatory `assert_financial_report_access` on the **authenticated caller**,
  input allowlisting and explicit organization filters in every SELECT.
- PostgreSQL's **single calling-statement MVCC snapshot**, inherited by reads
  performed inside a STABLE routine, keeps invoices, line items, payments,
  allocations, and cross-period invoice metadata consistent. No database
  write, persistent snapshot table, long-lived transaction or cross-request
  transaction is required.
- Rows are ordered deterministically. Server counts parents and children in
  the same snapshot, rejects inconsistent aggregates, then returns bounded JSONB.
- Browser cloud workbook generation routes through
  `reportsService.fetchSnapshotReportData`. The service checks IDs,
  organization IDs, parent-child links, duplicate rows, all child counts,
  referenced invoice completeness, financial role authorization and response
  structure. It **fails closed** when the snapshot RPC is missing or unavailable.
- Demo Mode continues to use its local in-memory reporting path.
- Previous `fetchReportData` multi-request loader remains for legacy callers
  and test fixtures but must **not** be used for certified cloud financial
  workbook downloads. Deprecate/remove when migration 040 has rolled out safely.

## Bounded behavior

- Maximum 10,000 invoices **and** 10,000 payments in the selected range.
- Maximum 100,000 combined invoice items and payment allocations.
- Maximum snapshot JSONB size: 16 MiB (server-side `pg_column_size`).
- Larger requests fail with a clear narrowing-range instruction. No partial
  exports, silent clipping, or degraded client fallback.
- These are initial safety bounds for a browser XLSX exporter; test in real
  environments before promising large-historical-report capabilities.

## Tests / release requirements

- `scripts/fin01_snapshot_acceptance.mjs` exercises actual issued invoices,
  recorded payment allocations, exact nested counts, same-org references,
  finance-only privileges and document-type filters on disposable PostgreSQL.
- `src/services/reports.snapshot.test.ts` verifies the browser routes actual
  downloads only through the snapshot RPC and refuses missing data, malformed
  counts, duplicates, broken parent references and unavailable RPCs.
- Ensure CI passes **all** TypeScript, ESLint, 146+ database contracts,
  Vitest, build, Playwright tests.
- Migration 040 must be approved and deployed **before** the matching frontend
  is released; the client intentionally blocks cloud export when the new RPC is
  absent. Never deploy to production as an automatic side effect of a PR merge.
- Verify the database accepts sustained report workloads and the user gets
  clear feedback for large exports. Maintain backup/rollback plans.

## Correctness limitations and future scope

- Count preview is still a separate query. It reflects a different moment than
  the subsequent export; it is a UI estimate, not a guaranteed workbook count.
- A long financial export may produce a large PostgreSQL JSON aggregate and
  browser workbook; safe limits are not a substitute for realistic load tests.
- An audit of `SECURITY DEFINER` functions, aggregate sales, customer credit
  limits, and valuation visibility remains tracked under SEC-01.
- The deferred 200-entry industrial-readiness test is **not run here**.

## Master plan continuity

1. Master feature register — ongoing.
2. Report preview integrity — implemented.
3. Independent website CI — implemented.
4. Website dependency compatibility — resolved.
5. SEC-01 direct financial/aggregate hardening — merged with residual policy audit.
6. **FIN-01 single-statement exported workbook — current implementation.**
7. B2 Universal Search — next.
