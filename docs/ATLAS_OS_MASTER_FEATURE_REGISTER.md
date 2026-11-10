# Atlas OS — Master Feature Register (Single Source of Truth)

> **Owner:** Atlas OS product development | **Tracking branch:** `Vijay-Atlas` | **Last reconciled:** 2026-11-07
>
> **Purpose:** Make every previously discussed feature visible in one place; prevent chat-history loss and roadmap drift. This register covers the **140-item working inventory** assembled from the original Atlas OS discussions, Atlas OS 2, repository code, and design documents. It is a *planning inventory*, not a declaration that all 140 items are complete, independently audited, or equally necessary for initial launch.
>
> **Important:** Some entries are capabilities inside larger features (e.g. product search), and others are multi-year program areas. The numbers are permanent identifiers, **not 140 standalone pull requests**.

## One engineering strategy: all features tracked, controlled implementation batches

**All features remain in scope for product review, but not all should be coded in the same change.** A single unbounded implementation introduces database dependencies, merge conflicts, hard-to-isolate regressions, and costly rework in tax, finance, inventory and authentication.

Develop **vertical slices**, such as "purchase order → authorized goods receipt → stock ledger → invoice → reversal/tests". Each slice includes UI + database + permissions + audit + failure/retry + migration + tests + operational notes. Dependencies and completeness travel together.

**Branch workflow:** `Vijay-Atlas` (the user's only ongoing development branch) → review PR → `main` (merged and tested). After merging, fast-forward/rebase the development branch as appropriate, without losing local work. Avoid extra branches unless necessary for a risky hotfix.

## Status legend

- **I — Implemented foundation:** matching production-source code/migrations exist; *not* a claim of certified readiness.
- **P — Partial:** some code exists, but major behavior or end-to-end verification is incomplete.
- **D — Design only:** documented as an intended architecture/decision; do not call it a shipped feature.
- **N — Not implemented:** discussed or planned, no verified full implementation found.
- **F — Deferred:** consciously held for a later industry, integration, or program phase.

Status classifications reflect a repository-level review and conversation recovery; **re-audit code and tests before promoting any item to verified**. When evidence conflicts, prefer actual tests + live code over historic roadmap checkboxes.

## Waves and release gates

| Wave | Purpose | Boundary |
|---|---|---|
| **W0 — Integrity & launch blockers** | Close direct financial read exposure, make historical export coherent, verify core access, functional website lead delivery, release/security checks | Must not regress existing invoicing and ledger behavior |
| **W1 — Distributor operating MVP** | Universal search; retail/POS; configurable credit/payment; product variants and UOM; returns/credit notes; purchase/GRN; quick stock intake | Must have transactional, permission, inventory and accounting tests |
| **W2 — Commercial readiness** | Subscription payment lifecycle, proven onboarding and trials, desktop packaging, customer support, import/export, real pilots | Public claims must match actual tested capabilities |
| **W3 — Advanced operations & automation** | Branches and owner governance; advanced approvals; sophisticated AI; WhatsApp; integrations | Requires domain contracts and operational evidence |
| **W4 — Industry expansion/network** | Optional business modules, non-distributor industries, lot/expiry intelligence, supplier/buyer network | No universal-sector claims without dedicated workflow validation |

### Non-negotiable cross-cutting work (not counted among the original 140)

- **SEC-01**: Least-privilege direct financial-table access; database-checked report gate is already present but broad table SELECT needs mapping.
- **FIN-01**: Consistent snapshot financial exports; count consistency alone is not full transactional consistency.
- **QA-01**: Authenticated end-to-end cloud tests, concurrency, negative paths, and performance/backup restoration.
- **WEB-01**: Replace demo/contact/notification browser-local "success" behavior with real server delivery and clear failure states.
- **OPS-01**: Rehearsed backup/recovery, monitoring, rollback and support before accepting real business workloads.
- **COM-01**: Qualified tax/legal review where relevant, evidence-backed product claims, and supervised first-customer pilots.
- **PILOT-01**: The separate 200-entry Demo Mode industrial test **remains paused until development is complete**.

### Current near-term sequence

1. Reconcile and test PR #34's Essentials / All Tools implementation (now merged into `main`).
2. B1.2 direct financial data authorization and consistent export snapshot design/implementation.
3. B2 permission-safe Universal Search.
4. W1 end-to-end retail + payment/credit policies + purchase/GRN + quick entry + product variants/units + returns in dependency-aware batches.
5. Website real lead delivery, release distribution, paid-plan lifecycle, recovery and supervised pilot readiness.
6. Advanced approved architecture (multi-branch, co-owners, approvals), automation, and later-sector extensions.

**Feature completion contract:** A feature is only "Verified" when corresponding UI/API/RPC/RLS paths, audit, data migration, concurrency and negative tests, authorized & unauthorized roles, error recovery, accessibility, and realistic operator usage have been checked as applicable. "Implemented foundation" is not enough for production.

## Wave W0 implementation log

| Slice | Status | Code evidence | Acceptance boundary |
|---|---|---|---|
| **W0-01: Financial report preview count integrity** | **Implemented and verified in GitHub CI #42281903266** | `src/features/reports/SalesReceiptsReportPage.tsx` and its unit tests | Older filter/organization requests cannot overwrite the latest counts; failed/invalid previews show no misleading numbers, visibly report errors, and block the export button; export success no longer states potentially stale preview totals. GitHub Actions [run #42281903266](https://github.com/YenugantiVijay/Atlas-OS/actions/runs/42281903266) passed ESLint, TypeScript, PostgreSQL acceptance, Vitest, build, and Playwright. |
| **SEC-01: Direct financial-table read policies** | **Raw-table restrictions implemented; security validation and RPC/aggregate audit pending** | Existing `invoices_select` and `payments_select` in migration `014` allow broad active-organization reads; reporting RPC in migration `037` is only an entry gate | Must map sales/accounts/inventory read needs before narrowing RLS or introducing scoped views. |
| **FIN-01: Consistent multi-query export snapshot** | **Single-statement export implemented; validation and rollout pending** | `src/services/reports.service.ts` has count and nested-row checks | Count rechecks are not a PostgreSQL transactional snapshot; do not claim fully consistent exports yet. |

## Edition and navigation decision log

See [Edition & Navigation Design](./ATLAS_OS_EDITION_AND_NAVIGATION_DESIGN.md).

- **W0-02: Website dependency compatibility** — restored the compatible Astro 4 / @astrojs/react 3 / @astrojs/tailwind 5 locked baseline, rather than forcing peer installation; independent website CI has passed this baseline.
- **UX-01: Compact navigation** — Simple View and Full Navigation remain preferences only. Simple View now groups authorized tools into Dashboard, Sales, Inventory, Finance, Settings. Subscription access is unchanged.
- **COM-02: Proposed editions** — website presents Atlas Essentials and Professional honestly without unapproved pricing, guarantees or payment links. Paid entitlements, billing and module enforcement are **not yet implemented**.
- **Order preserved** — after website compatibility, continue **SEC-01** least-privilege direct financial reads, **FIN-01** snapshot export, then **B2** Universal Search. The 140-feature register remains authoritative.

**SEC-01 first review:** [Financial read-access audit](./SEC_01_FINANCIAL_READ_ACCESS_AUDIT.md) maps the broad raw table SELECT policies, user-role mismatch, and required migration/test approach. This is a review milestone, **not** an RLS fix.

**SEC-01 security change (W0):** Migration `038_restrict_raw_financial_reads.sql` now adds restrictive `SELECT` policies for invoice/payment parents and children, and changes the payment-eligible-invoice lookup to run as SQL invoker so RLS cannot be bypassed. UI finance routes are limited to owner/admin/accounts. `scripts/sec01_financial_raw_read_acceptance.mjs` exercises real PostgreSQL roles and direct RPC/row reads. **CI and deeper aggregate/RPC access review remain required; no production database migration was applied.**

**SEC-01 phase 2 (2026-11-07; pending CI):** Migration `039_financial_aggregate_role_gates.sql` gates four customer-receivable/summary RPCs by real finance membership and redacts private receivables totals from the general dashboard for non-financial roles. Customer listing now preserves access without substituting false zero balances. Added restricted-role PostgreSQL assertions to `scripts/sec01_financial_raw_read_acceptance.mjs`. Review [SEC-01 audit](./SEC_01_FINANCIAL_READ_ACCESS_AUDIT.md). **Other aggregate/privileged-function audits remain open; FIN-01 export snapshots and B2 Universal Search are still next, in order.**

**FIN-01 first implementation (2026-11-07):** Migration `040_financial_export_single_statement_snapshot.sql` provides a role-checked, bounded, *single-statement MVCC* invoice/payment/child/reference JSON snapshot. Cloud Excel downloads now use only that verified snapshot; legacy multi-request fetch is not the certified export path. Dedicated browser tests and disposable PostgreSQL contract tests added. Review [FIN-01 architecture and release gates](./FIN_01_CONSISTENT_FINANCIAL_EXPORT.md). **CI pending; no production database changes.** B2 Universal Search remains next in the master sequence.

**Step 7 — B2 Universal Search (first slice, 2026-11-09):** The existing Ctrl+K command palette now prevents Sales/Inventory/Viewer from navigating to raw finance routes (invoices/payments/reports), matching SEC-01's database and route permissions. Customer search also matches normalized phone digits (minimum three) in the current organization's already-authorized customer directory, with regression tests. **B2 remains PARTIAL:** cross-module invoice/receipt search, bounded server-side queries, keyboard result navigation, and permissions-safe financial results remain open. Full implementation must avoid loading unbounded complete catalogs for every query. FIN-01 PR #38 was merged as `31c60c6`; `main` and `Vijay-Atlas` synchronized. The 200-entry industrial test remains deferred.

**Step 7 — B2 financial document search (2026-11-09):** Migration `041_financial_document_search.sql` adds a bounded, authenticated, finance-role checked search for invoice numbers, payment receipt numbers, transaction references and customer names. The Ctrl+K palette integrates debounced finance-only results; invoice/payment list pages accept linked `?search=` filters. New Vitest and real PostgreSQL role/tenant acceptance tests are included. **B2 remains partial until CI passes and full server-side bounded product/customer/other-record search is implemented.** PR #39 merged (`19d769b`); current work is on `Vijay-Atlas`. No production migration is applied; deploy migration 041 before releasing the corresponding frontend. The 200-entry industrial test remains deferred.

**B2 bounded product/customer search (2026-11-09):** Cloud Ctrl+K product/customer discovery now debounces input and asks the existing tenant-scoped `getProductsPaginated`/`getCustomersPaginated` services for a maximum of **4 products and 3 customers**, rather than loading the organization's entire catalogs when opening the palette. Demo Mode retains its in-memory search. Unit tests updated to verify bounded query behavior. Search remains partial: normalized phone matching through cloud PostgREST, richer record families, and full interaction/performance acceptance are still open. No new migration for this batch; FIN-01 and financial search migrations 040/041 still require approved deployment before corresponding cloud features work. The 200-entry industrial readiness test remains paused.\n\n**B2 keyboard result navigation (2026-11-09; pending PR CI):** Ctrl+K results now have arrow-key selection, Enter activation, selection highlighting, and regression tests for permission-filtered navigation. This is a UI interaction slice, not full Universal Search completion. Cloud normalized-phone search, additional record families, and full scale/interaction acceptance remain open. No production migrations or deferred 200-entry demo test were run.

**PR #43 — B2 cloud phone search (2026-11-09; pending verification):** Migration `042_customer_directory_phone_search.sql` adds a bounded `SECURITY INVOKER` directory RPC that retains ordinary customer-table RLS, requires active organization access and normalizes stored/entered phone digits before matching. The cloud Ctrl+K palette now uses this small directory response (name/company/phone only); it never fetches credit limits or receivables and fails closed if the migration is missing. Added service, UI, and disposable PostgreSQL role/tenant regression tests. Existing name/company search and Demo Mode behavior remain. **B2 stays PARTIAL** until full multi-record search, scale and operator validation. Deploy migration 042 through the approved process before shipping the matching cloud frontend. No live Supabase migration or 200-entry stress test performed.

**PR #44 — B2 operational cross-module lookup (2026-11-09; awaiting full CI):** Migration `043_operational_universal_search.sql` adds a `SECURITY INVOKER` RLS-respecting, per-family bounded server lookup for suppliers (name/company/normalized phone), quotations (number/customer), and sales orders (number/customer). Ctrl+K includes these minimal labels with role-aware navigation and company/phone reference, while Demo Mode searches its small local catalogs. Supplier, quotation, and order pages accept `?search=` links. New TypeScript and disposable PostgreSQL tests cover response contract, denial paths, wildcard escaping, and tenant isolation. **This is not complete B2 certification**: cross-module scale, operator flows, and remaining data families still need work. Migration 043 must be approved/deployed before releasing the cloud frontend; merge alone does not deploy any database migration. 200-entry Demo Mode industrial test remains paused.

**PR #45 — Universal Search reliability hardening (2026-11-09; pending CI):** Ctrl+K result lists now bind asynchronous product/customer, financial, and operational responses to the active organization, authenticated user, role and query; old responses are hidden immediately on identity/role/term changes. Keyboard result selection clamps after result-set changes, supports Home/End and a polite screen-reader selection announcement. Search input is capped at 100 characters; the empty state no longer falsely appears beside matching financial records. Finance and operational RPC errors expose retry actions, and small Demo Mode catalogs are cached only for the current open session/user/org (not fetched for every keystroke). Regression tests cover stale in-flight responses, role demotion, account switching, keyboard navigation, retries and demo catalog reuse. **No new migration**; existing migrations 040–043 remain separate production deployment gates. **B2 is hardened but not certified at production scale** until realistic tenant workload, actual production authorization and full operator-flow validation. The postponed 200-entry Demo Mode test remains paused until overall project completion.

**PR #46 — Retail Counter foundation + shared brand/preview (2026-11-09; pending CI):** The official website's navy/teal hexagonal SVG now matches the ERP application's sidebar/header mark and favicon, with a Vitest byte-for-byte asset check. The Astro marketing site gained a root `index.html` **preview launcher only** and a one-click `preview-website.cmd` that starts its live-reload Astro dev server at port 4321; the real website remains `src/pages/index.astro` and produces `dist/index.html` during build. A role-gated `/pos` Retail Counter now supports selecting existing customers, querying up to 8 products per cloud search, scanning names/SKUs, adding single units or bulk whole-unit quantities, per-line discounts and GST preview. Checkout calls the existing idempotent `createSalesOrder` authority **to save a DRAFT only**, revalidating customer active/tenant membership and preserving retry keys. It cannot confirm orders, deduct stock, issue invoices, collect payments or generate receipts, and it does not offer walk-in anonymous customers or multi-unit conversions yet. Unit/UI checks cover input validation, role restrictions and retry behavior. **F-047 and F-048 remain partial**, while F-049–057 are not declared shipped. No new migration or production rollout; ensure earlier migration 042 is deployed before cloud POS customer search is released. Deferred 200-entry Demo Mode stress test remains paused.

**Website preview correction (2026-11-09):** The initial PR #46 root `atlas-os-website/index.html` was only a launcher, so opening it through VS Code Live Server displayed a card and its localhost button failed whenever Astro was not running. The root HTML now renders a **responsive standalone homepage immediately**, with real anchor navigation and a small illustrative tabbed workspace; it is not the canonical multi-page Astro build and requires manual synchronization if Astro page content changes. For the complete authentic website and live reload, `preview-website.cmd` starts Astro, uses a readiness probe to confirm the actual Atlas OS homepage, and only then opens the browser. Website static verification explicitly guards against restoring a broken launcher. No production hosting or database deployment was performed.

**SEC-02 / PR #50 — Privileged RPC hardening (2026-11-10; CI and deployment gated):** Read-only inspection of live Supabase found migration history through 043, an inactive staging project, three mutable search-path warnings, and 37 authenticated-callable SECURITY DEFINER functions needing review. Confirmed defects: direct `allocate_document_number` allowed an active viewer to reserve document sequences without a role check; global `inspect_audit_privacy_compliance` was authenticated-callable and referenced an obsolete membership table. Migration 044 adds role-based number allocation for permitted sales/accounts operators, makes the global audit diagnostic service-role-only, and fixes the three built-in-only function paths. Added isolated PostgreSQL acceptance for owner/sales/accounts/viewer/inventory, cross-tenant/anonymous, service diagnostic and masking behavior. **No production/staging schema has been changed, and this PR does not certify all privileged RPCs.** Staging activation, live auth tests, remaining advisors, full ERP workflows and the deferred 200-entry Demo Mode test remain release gates. See [SEC-02 evidence and staging gate](./SEC_02_PRIVILEGED_RPC_STAGING_GATE.md).

**PR #51 — Real marketing enquiry delivery (2026-11-10; CI and production rollout pending):** Contact, Demo Request and desktop-release notification forms no longer claim success after saving only to browser localStorage. Added a public Supabase Edge Function (exact origin CORS, mandatory Cloudflare Turnstile validation, strict input limits, server-only salted rate-limit hashes and Resend notification with idempotency), migration 045 for service-role-only atomic throttling, client fail-closed unconfigured/error handling, Node API regression cases and isolated PostgreSQL acceptance plus website Playwright form coverage. All external provider calls in CI are mocked; **no real email has been sent, no live database changes applied, and no website deployed**. Deployment requires a verified real inbox, approved service secrets, staged migration, public website build variables, real end-to-end email proof and privacy review. See [PR #51 deployment checklist](./PR51_WEBSITE_LEAD_DELIVERY.md). The deferred 200-entry ERP Demo Mode industrial test remains paused.

**PR #52 — Canonical website preview restoration (2026-11-10; pending CI):** The original multi-page Astro website (`atlas-os-website/src/pages/index.astro`, the signature CapabilityOrbit and interactive React product showcase) was always intact. The separately authored source-root `atlas-os-website/index.html` introduced in PR #47 displayed a **different simplified homepage** in VS Code Live Server and caused brand/design confusion. PR #52 removes that duplicate instead of editing the original website design. `preview-website.cmd` remains the one-click Windows launcher for the real Astro dev server; its readiness probe now confirms signature original-site markup. The authentic `index.html` is generated automatically at `dist/index.html` by `npm run build` (it is not maintained by hand). Added CI static checks preventing duplicate source homepages and Playwright coverage for the original orbit, hydrated preview, real route links, and responsive mobile navigation. No ERP, database or production hosting change. See `atlas-os-website/README.md` for the correct preview workflow. The 200-entry Demo Mode stress test remains paused.

**PR #53 — Retail Counter billing workstation and compact profile (2026-11-10; pending CI):** Replaced the draft POS's large card-per-item layout with a compact, accessible and horizontally scrollable billing worksheet (Sl., product/SKU, HSN, quantity, UOM, read-only master selling rate, discount, GST rate, shared-engine line amount, stock, remove) and responsive product/customer search + summary. F2 lookup, Arrow keys + Enter result selection, Ctrl+Enter valid draft save and standard Tab operation added. Product/line caps and all current tenant, role, idempotent draft-order, customer revalidation and inventory-confirmation boundaries remain. The app header's top-right identity trigger now displays **user name + role**, not a second, truncated organization name. Added Vitest component and page tests and Demo Mode Playwright workstation coverage. **F-047/F-048 remain partial**, because retail checkout, statutory billing, receipts, settlement/credit policy and UOM variants are NOT implemented by this UI PR. Universal/barcode search remains separate PR #54. See [PR #53 acceptance notes](./PR53_RETAIL_COUNTER_WORKSTATION.md). No Supabase migration, real billing/payment deployment, or 200-entry industrial Demo Mode run.

**PR #54 — Search field parity and bounded cloud results (2026-11-10; pending CI):** Existing role-scoped Universal Search already covered navigation, products, customers, suppliers, quotations, orders, invoices and payments/receipts. This PR fills real gaps rather than duplicating those services: **HSN matching** in paginated product search (cloud and Demo Mode), **GSTIN matching** for customer and supplier directory RPCs (forward-only migration `046_search_directory_gstin_coverage.sql`), and fixes the client-side second filter that hid valid HSN/GSTIN cloud results because the matching private field was absent from returned labels. Retains request-identity isolation, cloud bounded results, finance-only results and current keyboard navigation. POS lookup describes real supported fields and has new lookup tests. **F-067/068 gain documented coverage, F-069 remains P** because dedicated barcode/GTIN and not-yet-built purchase-document search are still outstanding, and full-scale search relevance ranking is not complete. Merge does not deploy migration 046. See [PR #54 matrix](./PR54_SEARCH_COVERAGE_ACCEPTANCE.md). 200-entry Demo Mode stress test remains paused.

## Feature inventory

| ID | Feature | Status | Wave |
|---:|---|:---:|:---:|

### Core ERP

| ID | Feature | Status | Wave |
|---:|---|:---:|:---:|
| F-001 | Business dashboard | I | W0 |
| F-002 | Product management | I | W0 |
| F-003 | SKU management | I | W0 |
| F-004 | Product categories | I | W0 |
| F-005 | Product brands | I | W0 |
| F-006 | Product images | P | W1 |
| F-007 | HSN code fields | I | W0 |
| F-008 | Basic product units of measurement | P | W1 |
| F-009 | Inventory movement ledger | I | W0 |
| F-010 | Opening stock recording | I | W0 |
| F-011 | Stock availability checks | I | W0 |
| F-012 | Negative-stock prevention | I | W0 |
| F-013 | Low-stock alerts | I | W0 |
| F-014 | Customer management | I | W0 |
| F-015 | Supplier management | I | W0 |
| F-016 | Quotations | I | W0 |
| F-017 | Sales orders | I | W0 |
| F-018 | Sales-order invoicing | I | W0 |
| F-019 | GST-aware invoices | I | W0 |
| F-020 | Invoice numbering | I | W0 |
| F-021 | Customer payment records | I | W0 |
| F-022 | Outstanding receivables | I | W0 |
| F-023 | Sales and receipts Excel reports | I | W0 |
| F-024 | Team membership management | I | W0 |
| F-025 | Audit events | I | W0 |

### Inventory & Procurement

| ID | Feature | Status | Wave |
|---:|---|:---:|:---:|
| F-026 | Quick inventory spreadsheet-style entry | N | W1 |
| F-027 | Complete bulk stock receiving workflow | P | W1 |
| F-028 | Purchase orders | N | W1 |
| F-029 | Goods receipt note (GRN) | N | W1 |
| F-030 | Supplier invoice/PO/GRN matching | N | W1 |
| F-031 | Duplicate supplier bill prevention | N | W1 |
| F-032 | Barcode scanning | N | W2 |
| F-033 | Product variants | N | W1 |
| F-034 | Advanced unit conversions | N | W1 |
| F-035 | Comprehensive stock reservations | P | W1 |
| F-036 | Multi-warehouse inventory | D | W3 |
| F-037 | Inter-branch stock transfers | D | W3 |
| F-038 | Physical inventory reconciliation | P | W1 |
| F-039 | Damaged/quarantined stock | N | W1 |
| F-040 | Purchase returns | N | W2 |
| F-041 | Customer sales returns | N | W1 |
| F-042 | Lot/batch tracking | F | W4 |
| F-043 | Expiry-date management | F | W4 |
| F-044 | FEFO stock allocation | F | W4 |
| F-045 | Expiry-risk dashboard | F | W4 |

### Wholesale, Retail, Payments

| ID | Feature | Status | Wave |
|---:|---|:---:|:---:|
| F-046 | Wholesale order processing end-to-end | P | W1 |
| F-047 | Single-item retail selling | P | W1 |
| F-048 | Retail counter/POS billing | P | W1 |
| F-049 | Walk-in customer checkout | N | W1 |
| F-050 | Retail vs wholesale price levels | N | W1 |
| F-051 | Customer-specific price lists | N | W2 |
| F-052 | Quantity-based tiered discounts | P | W1 |
| F-053 | Credit limit enforcement | P | W1 |
| F-054 | Credit days and terms enforcement | P | W1 |
| F-055 | Full Payment Required policy | N | W1 |
| F-056 | Credit Allowed policy | N | W1 |
| F-057 | Split/mixed payment methods per bill | N | W1 |
| F-058 | Partial invoice payments | I | W0 |
| F-059 | Remote payment requests | N | W2 |
| F-060 | Payment QR generation | N | W2 |
| F-061 | Payment settlement verification | N | W1 |
| F-062 | Invoice print/presentation | I | W0 |
| F-063 | Receipt generation and delivery | P | W1 |
| F-064 | GST credit notes | N | W1 |
| F-065 | Refund management | N | W2 |

### Search & AI

| ID | Feature | Status | Wave |
|---:|---|:---:|:---:|
| F-066 | Ctrl+K command palette | I | W0 |
| F-067 | Product search | I | W0 |
| F-068 | Customer search | I | W0 |
| F-069 | Atlas Universal Search | P | W1 |
| F-070 | Search invoices by number from anywhere | P | W1 |
| F-071 | Global receipt/payment search | N | W1 |
| F-072 | Customer phone lookup globally | P | W1 |
| F-073 | Permission-aware global search | P | W1 |
| F-074 | Rule-based business summaries | I | W0 |
| F-075 | Low-stock recommendations | I | W0 |
| F-076 | Overdue receivables insights | I | W0 |
| F-077 | AI requisition proposal approval | P | W2 |
| F-078 | Generative AI provider integration | N | W3 |
| F-079 | Demand/stock forecasting | N | W3 |
| F-080 | AI WhatsApp order interpretation | F | W3 |
| F-081 | General human approval framework for AI actions | P | W3 |

### Organization, Security, Enterprise Governance

| ID | Feature | Status | Wave |
|---:|---|:---:|:---:|
| F-082 | Multi-organization support | I | W0 |
| F-083 | Existing six-role RBAC | I | W0 |
| F-084 | Custom organization roles | D | W3 |
| F-085 | Separate Primary Owner governance | D | W3 |
| F-086 | Co-Owners | D | W3 |
| F-087 | Ownership transfer | D | W3 |
| F-088 | Verified owner recovery | D | W3 |
| F-089 | Co-Owner recovery quorum | D | W3 |
| F-090 | Multi-branch structure | D | W3 |
| F-091 | Branch-scoped employee permissions | D | W3 |
| F-092 | Regional management | D | W3 |
| F-093 | Branch-specific stock balances | D | W3 |
| F-094 | Central customer master plus branch masking | P | W3 |
| F-095 | Branch-specific invoices | D | W3 |
| F-096 | General approval workflows | D | W3 |
| F-097 | Organization-defined approval thresholds | D | W3 |
| F-098 | Two-person high-risk approvals | D | W3 |
| F-099 | Separation of duties on approvals | D | W3 |
| F-100 | Approval expiration/resubmission | D | W3 |
| F-101 | Advanced employee deprovisioning | P | W3 |
| F-102 | Fraud/dispute holds | D | W3 |
| F-103 | Category-specific retention/archival | D | W3 |
| F-104 | Account recovery notices | D | W3 |

### SaaS & Cross-Industry

| ID | Feature | Status | Wave |
|---:|---|:---:|:---:|
| F-105 | Supabase user authentication | I | W0 |
| F-106 | Business onboarding | I | W0 |
| F-107 | PAN/GSTIN field validation | I | W0 |
| F-108 | Industry eligibility declaration/review controls | I | W0 |
| F-109 | Automated supported-business eligibility decision | I | W0 |
| F-110 | End-to-end human eligibility review operations | P | W2 |
| F-111 | Server-calculated seven-day trial | I | W0 |
| F-112 | Subscription state and access checks | P | W2 |
| F-113 | Subscription payment gateway and renewals | N | W2 |
| F-114 | Customer plan entitlements and commercial tiers | P | W2 |
| F-115 | Essentials workspace navigation | I | W0 |
| F-116 | All Tools workspace navigation | I | W0 |
| F-117 | Organization-selectable business modules | D | W4 |
| F-118 | Industry capability profiles | D | W4 |
| F-119 | Generic cross-industry ERP | F | W4 |
| F-120 | Upgrade/downgrade handling | N | W2 |
| F-121 | Customer subscription billing portal | N | W2 |

### Website, Desktop, Integrations, Network

| ID | Feature | Status | Wave |
|---:|---|:---:|:---:|
| F-122 | Atlas OS marketing website | I | W0 |
| F-123 | Interactive marketing product preview | I | W0 |
| F-124 | Public pricing presentation | I | W0 |
| F-125 | Public desktop download center | I | W0 |
| F-126 | Verified Windows desktop installer | N | W2 |
| F-127 | Electron/Tauri desktop packaging | N | W2 |
| F-128 | Desktop auto-updates | N | W2 |
| F-129 | Backend-delivered demo requests | P | W0 |
| F-130 | Backend-delivered contact enquiries | N | W0 |
| F-131 | Backend-delivered download release notifications | N | W2 |
| F-132 | WhatsApp inbound customer orders | F | W3 |
| F-133 | WhatsApp order stock checks | F | W3 |
| F-134 | WhatsApp order employee approval | F | W3 |
| F-135 | Automated WhatsApp order/receipt messages | F | W3 |
| F-136 | WhatsApp payment requests | F | W3 |
| F-137 | General CSV import and accounting export | P | W2 |
| F-138 | BUSY/Tally interoperability | N | W3 |
| F-139 | Supplier-buyer discovery network | D | W4 |
| F-140 | Automated buyer/supplier procurement coordination | D | W4 |

## Evidence map (starting points, not certification)

| Domain | Main sources to re-check when implementing |
|---|---|
| Business application & routes | `src/features/`, `src/services/`, `src/app/router.tsx`, `src/types/index.ts` |
| Stock, orders, invoices, money & security | `supabase/migrations/001-037`, `scripts/run_local_db_acceptance.mjs`, `src/services/*test.ts` |
| Search | `src/components/layout/CommandPalette.tsx`; cross-module search remains to be expanded |
| AI | `src/features/ai/AIPage.tsx`; rule-based assistant/proposals, not proven generative production AI |
| Workspace | `src/lib/workspace-view.ts`, `src/components/layout/Sidebar.tsx`, PR #34 |
| Website | `atlas-os-website/`, especially demo/contact/download components |
| Advanced ownership/branch/approval architecture | `docs/PHASE_5_0B_2_APPROVED_PRODUCT_DECISIONS.md`, `docs/PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` |
| Original roadmap | `docs/ROADMAP.md` (historical checklist, not the current authoritative completion source) |
| This inventory's product provenance | Prior Atlas OS and Atlas OS 2 discussions; statuses represent the best available reconstruction, and unverified details must remain tentative |

## Working with this register

For every development task:
1. Identify one or more **F-IDs** and any **SEC/FIN/QA/WEB/OPS** dependencies.
2. Update status, supporting commit/PR/test evidence, and any revised release wave **in the same PR as the implementation**.
3. Record new feature ideas here when discussed, before implementation; never rely on a pinned chat as the sole record.
4. Never mark a feature complete solely because its page exists or a document calls it "designed".
5. Do not remove a deferred feature without an explicit product decision. Track its revisit trigger.
6. Keep this file current and avoid competing "master" lists that become inconsistent.
7. Maintain no more than one main active workstream on `Vijay-Atlas` at a time unless an urgent security fix requires isolation.

## Follow-up register improvements (optional, not blockers)

- Add per-feature **acceptance checklists, test evidence, owner, last reviewed date and dependency IDs** as implementation starts. Avoid inventing evidence on 140 entries.
- Use one linked GitHub issue per **work package**, not 140 automatically generated issues. Link issues to F-IDs.
- Once a week, reconcile current PRs, open blockers, and planned work with this file.
- Mark W1/W2 release-cut inclusions explicitly after user/customer prioritization; do not silently promise every program area for v1.
