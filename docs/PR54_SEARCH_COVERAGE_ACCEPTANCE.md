# PR #54 — ERP Search Coverage & Validation

**Scope:** Existing Atlas OS search surfaces (Ctrl+K Universal Search and Retail Counter), with security-preserving service and database changes. This is **not** a promise of barcode, warehouse scanner, purchase-order or every future ERP feature.

## Search acceptance matrix

| Area | Supported PR #54 fields | Backend and security |
| --- | --- | --- |
| Products | Name, SKU, brand, HSN code | Cloud `getProductsPaginated`: tenant-filtered, deterministic page of 4 in global palette / 8 in POS; stock aggregated for the page using existing RPC. Demo matches the same fields locally. |
| Customers | Name, company, normalized phone (e.g. `+91 98765-43210` matches `9876543210`), **GSTIN** | `search_customer_directory` remains SECURITY INVOKER, active-member/RLS-gated, bounded at 3 global / 5 POS. Returns **only** id, name, company, phone; never GSTIN, credit, receivables or payment balances. |
| Suppliers | Name, company, normalized phone, **GSTIN** | `search_operational_records` SECURITY INVOKER, active-member/RLS-gated; max 3 per type. Minimal labels only, no finance. |
| Quotations / Sales Orders | Number or customer name/company | Existing bounded operational RPC with tenant and RLS checks. No financial totals returned. |
| Issued invoices / receipts/payments | Document reference or customer, where supported by existing RPC | Existing finance-only `search_financial_documents` RPC; role and real database membership verified, max 8 results. Sales/viewers never receive finance search results. |
| Navigation / actions | Command label, page title | Client-side allowlist and per-action permission gates. Keyboard arrows, Home/End, Enter, Escape, Ctrl+K already implemented and retained. |

## Correctness fixes

- Cloud database hits **must not be filtered again by only the displayed fields**: a GSTIN-matched customer returns name/phone but no GSTIN; a product HSN match has unrelated name/SKU. The prior second client filter hid such matches even though the backend correctly returned them. PR #54 trusts only the already-bounded, request-identity-keyed cloud response, and keeps local filter matching for Demo Mode.
- Existing asynchronous request-key invalidation still protects query, user, organization, role and palette session transitions. Existing stale-response tests remain required.
- Product stock display now shows `—` when unknown; it does not falsely report zero.
- Product and customer lookups retain their original button / keyboard selection and URL deep-link flows.
- New migration `046_search_directory_gstin_coverage.sql` adds only GSTIN predicates to the two existing invoker RPCs; no columns, financial grants, RLS bypasses or new anonymous access. Direct SQL wildcard metacharacters remain escaped by those existing RPCs.
- Product HSN search uses existing paginated read service, not an unbounded catalog download.

## CI and deployment

- Disposable PostgreSQL acceptance tests check GSTIN matches, bounded response shape, active membership, cross-tenant denial, literal wildcard escapes, per-family limits, and absence of credit/receivables fields.
- Vitest checks cloud and demo matching, retained cloud hits, parameter scope, keyboard destination links and Retail Counter selection.
- The existing build, typecheck, lint and Playwright acceptance remain merge gates.
- **Migration 046 is forward-only and must be applied through approved Supabase migration deployment**. PR merge does not deploy it. Without that migration, the UI works for existing search fields but new cloud GSTIN predicates are unavailable.

## Explicitly incomplete (future tickets)

- **Dedicated barcode/GTIN field and hardware-scanner flow:** no barcode field exists in the current `Product` model or SQL products schema. SKU may be searched, but it is **not a validated barcode workflow**.
- **Purchase orders, goods receipts, supplier invoices, returns, credit notes:** no corresponding mature searchable datasets currently exist.
- **Cross-field relevance ranking / exact-match-first at large scale:** existing product page sorts deterministically by name, not by relevance. Server-side ranking and appropriate search indexes are a later performance optimization.
- **GSTIN results in generic customer CRUD table/list search:** existing full customer list already searches GSTIN; PR #54 specifically fixes bounded directory search used by the palette and POS.
- Full-page deep links are to the destination page with `search=` query parameters; they are not yet direct object detail routes.
- Product search and customer search may require adding future business-specific fields; this PR does not create a full-text search service or change finance authorization.

**Release constraints:** Existing POS remains draft-only. No invoice, receipt, payment, credit policy, stock deduction or 200-entry industrial Demo Mode stress test in PR #54.
