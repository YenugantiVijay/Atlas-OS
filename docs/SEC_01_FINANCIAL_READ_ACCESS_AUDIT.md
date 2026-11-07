# SEC-01 — Financial Table Read Authorization Audit

Status: **Phase 1 raw-record restriction implemented on `Vijay-Atlas`; regression CI and further RPC audit pending**.
Linked roadmap: `docs/ATLAS_OS_MASTER_FEATURE_REGISTER.md`.
Date: 2026-11-07

## Verified facts from current code

- `supabase/migrations/014_harden_operational_rls_with_eligibility.sql` defines `invoices_select` and `payments_select` using `public.can_read_organization_data(organization_id)` without separately requiring an `owner`, `admin` or `accounts` role.
- Child `invoice_items_select` and `payment_allocations_select` inherit similar organization-level visibility through the parent invoice/payment.
- `src/lib/permissions.ts` allows `reports:financial` to owner/admin/accounts but not sales/inventory/viewer. All named operational roles can have `data:read`, which is not equivalent to financial report authorization.
- Migration `037_financial_report_auth_gate.sql` introduces an authenticated role-checked RPC for **report-service entry points**. It does **not** automatically revoke direct raw table reads.

### Meaning

An active same-organization employee who lacks financial-report access can potentially query the raw underlying financial tables through a direct authorized Supabase client connection, depending on the effective SQL grants and all live RLS policies. This should be validated in disposable PostgreSQL as restricted roles and against the current migration set. **Do not describe the RPC gate as complete least-privilege protection.**


## Phase 1 implementation (migration 038)

- Restrictive `SELECT` policies have been added for all four raw financial tables; unlike an additional permissive policy, these cannot be bypassed by an existing broad organization-member `SELECT` policy.
- Only active `owner`, `admin`, `accounts` members of the organization with eligible read status may see raw invoice/payment rows.
- `sales`, `inventory`, `viewer`, inactive, anonymous and cross-tenant users cannot SELECT the protected records.
- Financial pages and navigation now use the existing `reports:financial` role permission, matching the database boundary. A later permission design could add explicitly scoped sales-invoice previews without reopening full ledgers.
- New `scripts/sec01_financial_raw_read_acceptance.mjs` verifies the four tables for owner/admin/accounts/sales/inventory/viewer/inactive/cross-tenant/anonymous, using actual transaction fixtures created by prior operational acceptance tests, not fabricated raw ledger writes.
- The same test checks sales can still read the ordinary product catalog.
- No production migration is applied by writing this file. Verify CI and deployment ordering first.

**Remaining review:** SECURITY DEFINER function return shapes, dashboard aggregate visibility, other read endpoints and legacy integrations must be audited separately. SEC-01 is not fully closed merely by protecting the four raw tables.

## Operational dependencies to map before RLS changes

| Consumer | Minimum read contract to preserve |
|---|---|
| Sales and order workflows | Only the order/invoice status, customer relationship and necessary identifiers needed for authorized order operations. |
| Inventory | Only inventory-relevant order and invoice linkage, if needed by stock lifecycle. |
| Dashboard | Aggregate and scoped metrics, not necessarily complete raw financial ledgers for every role. |
| Customer screens | Only authorized customer balances and related information. |
| Accounts | Full relevant organization financial records, with current statutory/audit constraints. |
| Owner/Admin | Financial and operational visibility appropriate to the existing permissions. |
| Historical exports | Authorized owner/admin/accounts only, server-checked, eventually consistent snapshot. |

Before implementation, search all `src/services`, `src/features`, SQL functions and test fixtures for direct invoice/payment reads. Some UI components may require replacement with narrow, authorized summary RPCs.

## Proposed implementation slices (not yet shipped)

1. Inventory all direct SELECT paths for `invoices`, `invoice_items`, `payments`, `payment_allocations`, including direct REST clients and SECURITY DEFINER RPC dependencies.
2. Define least-privilege data contracts per role and operation: do **not** expose all payment allocations to users who only need a paid/unpaid indicator.
3. Build read-only restricted views or authenticated RPCs for authorized operations, with careful `search_path`, table qualification, parameter validation and execution grants.
4. Narrow SELECT RLS and/or SQL grants **only after** dependent consumers are migrated; confirm that permissive policies do not re-open access.
5. Test owner/admin/accounts/sales/inventory/viewer, inactive membership, tenant crossing, unauthenticated calls, direct REST, list pagination, negative paths and legitimate operational workflows.
6. Validate migrations on disposable local PostgreSQL and verify the existing core CI before any production rollout. Document safe deployment and rollback sequencing.

## Stop conditions

Do not deploy speculative RLS tightening, do not change production Supabase, and do not declare SEC-01 fixed until direct-SELECT bypass is blocked with realistic role-based database tests while legitimate work still succeeds.

## Next steps in master sequence

**SEC-01 implementation → FIN-01 consistent export snapshot → B2 Universal Search**.
