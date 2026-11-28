# Client setup, verification and invoice review

## Owner setup

Create a separate product workspace for each client organization. A single stall business can use its eight locations in one ice-cream stall workspace. Keep the school in its own school workspace and the distributor in its own distribution workspace. Each client owner uses their own account and subscription; an existing electrical workspace is not reused as a school or ice-cream business.

Invite staff through Team & Access with the minimum suitable role. In the stall/distribution desk, open **Staff location access → Manage location access** and grant the exact stall/depot name to each member. Owners and administrators see all locations. Other staff have no location access until assigned. Their team role still controls actions; assigning a location does not turn a viewer into a sales or inventory user. Location assignments protect the specialty ledgers and do not narrow unrelated generic ERP permissions.

Staff see only assigned stock, cash drawers, recent events and chart totals. Transfers require access to both locations. Distribution staff also need access to the originating commitment location. Their authorized order balance retains complete shared fulfillment totals. Revoking an assignment blocks the next server read/write. Private unscoped functions and raw tables cannot be used to bypass these checks.

## Fill-in workbook

Download **Atlas-Client-Handover-Templates.xlsx** from the reconciliation panel or School setup. The public file is blank and contains no client balances or personal records.

- **Eight stalls:** eight empty slots for actual location/staff details, dates, opening float, cash/UPI sales and counted cash. Expected cash excludes UPI; variance is counted minus expected.
- **Stock counts:** 200 rows for actual book and physical quantities, with unit, batch, expiry and count date. Variance is physical minus book.
- **School sample:** 20 charge/receipt allocation samples. Enter a configured tax rate, concession, allocated payment and allocated refund. For a receipt spanning several charges, enter each charge's allocation separately.
- **Billing review:** 100 dispatch samples with actual rates, explicitly configured tax and supply type. No product rate is assumed. These are review calculations, not issued invoices.
- **Instructions:** units, tax-rate entry, rounding and next steps. Workbook amounts are INR. Enter 18 for 18%, not 0.18. Enter zero explicitly when applicable. Blank inputs remain unknown rather than becoming a zero balance.

Fill amber cells. Grey cells calculate automatically. Return the completed workbook for reconciliation and client setup. The workbook does not import records or correct balances automatically.

## Server-backed reconciliation

Open **Handover & daily reconciliation → Open reconciliation**. Select the IST business date and optionally one location. The stock bridge includes opening stock, receipts, sales/dispatches, restocked returns, inbound/outbound transfers, write-offs and count adjustments. Expected closing stock is calculated from those movements.

Expected cash = opening float + cash sales. UPI is reported separately. Missing opening or closing figures remain explicitly unknown. A nonzero recorded cash variance requires investigation. Stock and cash verification downloads include blank physical verification fields. Cash CSV amounts are integer paise (100 paise = INR 1); the client setup workbook uses INR.

These reports use complete authorized ledger records, rather than only the recent-event list. Reports fail instead of silently truncating more than 5,000 stock rows; select one location if necessary. Downloads do not post corrections or verify bank settlement. Compare actual stock and cash before using a stock-count correction or approving a handover.

## Distribution invoice review

New saved dispatches automatically appear in **Invoice review after dispatch** for owners, administrators and assigned accounts staff. Each draft is linked to one immutable dispatch record. The server supplies customer commitment, order reference, SKU, batch and case quantity. Prices and tax remain unset until entered by accounts.

Choose **Prepare invoice draft**. Enter the agreed taxable rate per case, configured tax percentage and explicit supply type. The preview uses integer-paise arithmetic. CGST/SGST, CGST/UTGST or IGST are allocated according to the chosen supply; any odd domestic split paise goes to the regional component. No product GST rate or jurisdiction is inferred.

**Save invoice draft** stores the review. **Save reviewed draft** additionally requires a billing address and tax-treatment note. Saved drafts can be downloaded with their source dispatch ID and amounts. Returns for the order/SKU/batch are flagged for separate credit review and are not automatically subtracted from each partial-dispatch draft.

Drafts and reviewed drafts are not issued tax invoices. They create no receivable, payment or additional stock movement. They are separate from the generic tax-invoice ledger. Final statutory invoicing, consolidated multi-dispatch invoices and settlement remain a separate reviewed step; do not post the same stock movement again as if the ledgers were automatically synchronized.

Repeated identical saves use an idempotency key. Concurrent stale edits are rejected with a refresh instruction. Unconfirmed saves can be retried unchanged or reloaded. Accounts staff need both dispatch-location and customer-commitment-location access. Sales-only and unassigned accounts users cannot prepare financial drafts.

## Verification boundary

Testing uses disposable generated fixtures, including eight stalls and a 1,000-student school, rather than inserting fictional clients into production. Physical opening stock/cash and the actual school's sample charge/receipt still require the completed workbook and real client workspaces. Automated testing does not certify a 100% bug-free service or verify external bank settlement.

## Release verification — 28 November 2026

Production database migrations `20261128051052` and `20261128052951` were applied to `hrxjgbupjtikokqxjzbh`. ERP Hosting was deployed to https://atlas-os-8328y-erp.web.app. Live JavaScript matched the tested build by SHA-256; fresh mobile checks passed for stall, distribution and school sign-in pages without page errors. The hosted blank workbook returned HTTP 200 and matched the delivered workbook by SHA-256.

Validation: 989 unit/component tests passed (39 existing skips); 409 database acceptance checks passed; all 41 backup/restore tables matched; 86 browser tests passed. Production build, lint and type checks passed. The workbook passed native Microsoft Excel recalculation at first, middle and last rows, including blank inputs and odd-paise tax splits; the delivered blank file remained unchanged.

Production permission checks confirmed that the new public APIs are invoker functions with anonymous execution revoked, and authenticated users cannot call the old unrestricted private entry points. The security advisor still reports 33 intentionally policy-free, RPC-only private tables, existing security-definer API notices and disabled leaked-password protection. These notices are not a zero-findings security certification. See [RLS guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Actual client workspace setup and physical balance reconciliation remain pending the completed workbook. No fictional client data was inserted into production.
