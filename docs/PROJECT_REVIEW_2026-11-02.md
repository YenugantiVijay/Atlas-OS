# Project review and remediation notes — 2 November 2026

The application builds and its runnable tests pass. This review found and fixed defects in tenant-specific UI state, cloud reads, financial presentation, profile saving, search, and accessibility. Important cloud transaction and large-dataset issues remain below. Passing frontend and mocked service tests does not establish production readiness.

## Scope and evidence

- Reviewed application routing, organization/authentication state, feature pages, shared components, service boundaries, storage calculations, migration definitions relevant to those services, build configuration, CI, and existing tests/documentation.
- Exercised all 13 workspace routes in Chromium at 1440px, 390px, and 320px. All 39 route/viewport combinations loaded without uncaught page exceptions or document-level horizontal overflow. Screenshots were captured; visual inspection also exposed clipped fixed-header controls that a document-width assertion missed.
- Reviewed onboarding/authentication behavior through existing component tests. Cloud reads and failures in new regression tests use mocked services/PostgREST responses.
- Baseline: 329 passing tests, 35 skipped database tests, seven passing browser tests, successful TypeScript check and production build.
- Final: **348 passing tests, zero failures, 35 skipped database tests; 14 passing Chromium tests; successful production build including strict TypeScript compilation; clean `git diff --check`.**
- No migrations were created or applied. No live database transaction/security tests, dependency advisory scan, cross-browser tests, or load tests were performed. This is a broad implementation review, not proof that every source line or historical audit document is correct.

## Implemented fixes

1. **Reset feature state when the account, organization, mode, or role changes.** Clearing React Query was insufficient because feature pages use local React state. The routed subtree and command palette now remount at that boundary, clearing old document details, drafts, search records, and AI history. The browser regression verifies that one organization's AI summary disappears after switching to another.
2. **Search the active data source.** The command palette previously read local demo storage even in cloud mode. It now calls organization-scoped product/customer services, handles loading and failures, ignores obsolete responses, filters actions by permission, and opens a filtered catalog/customer list when selecting a result.
3. **Preserve legitimate zero values.** Switching order/quotation products now respects a zero selling price and zero tax rate. Cloud product mapping preserves a zero reorder threshold; customer creation, editing, and mapping preserve zero-day credit terms. Price inputs also reject negative values through native form constraints.
4. **Include customer identity in cloud documents.** Orders, quotations, invoices, and payments now fetch and map their associated customer. Explicit tenant foreign-key names disambiguate the schema's multiple customer relationships. Previously customer search and document customer details worked in the demo but were missing in cloud responses. Live PostgREST execution remains to be verified against the deployed schema.
5. **Do not manufacture zero stock or zero debt on failed reads.** Product stock-ledger failures and customer invoice-query failures now reject the load instead of returning apparently valid zero balances.
6. **Show recoverable errors.** Dashboard, invoice, and audit views now show an error with a retry action. The dashboard no longer leaves an endless skeleton after a failed load or silently substitutes empty chart datasets.
7. **Exclude draft orders from sales.** Dashboard totals in both data modes and the sales chart now include confirmed/fulfilled orders only, matching the displayed metric description.
8. **Wait for profile saving.** The profile form now awaits the update, retains the form on failure, and reports success only after completion. Avatar removal preserves an explicit empty value. The cloud email field is read-only because this form does not implement a verified email-change workflow.
9. **Improve dialog accessibility.** Dialogs and the command palette trap keyboard focus, support Escape on the topmost dialog, restore focus, and preserve body scroll locking across sibling/nested dialogs. Dialog headings/descriptions and repeated input/select labels use unique IDs.
10. **Keep mobile controls reachable.** The organization selector shrinks and profile details collapse on narrow screens. Search, quick-create, organization, and profile controls have accessible names. The demo banner wraps instead of hiding its message. Browser tests check every header control is fully in view at 320px and 390px.
11. **Correct AI prompt routing.** The inventory valuation prompt now returns inventory value instead of accidentally taking the stock-reorder branch. Reorder recommendations exclude inactive products. The dashboard also labels its actual demo/cloud mode instead of always claiming a verified local engine.

New regression coverage is in `src/services/review-regressions.test.ts`, `src/components/ui/Modal.test.tsx`, `src/components/layout/CommandPalette.test.tsx`, `src/components/layout/Header.profile.test.tsx`, `src/features/dashboard/load-errors.test.tsx`, and `e2e/review-regressions.spec.ts`.

## Remaining high-priority issues

### 1. Order and quotation creation can leave partial documents

**Evidence:** [orders.service.ts](../src/services/orders.service.ts), `createSalesOrder` and `createQuotation`.

The header and line items are separate requests. If inserting items fails after the header commits, the service throws while leaving a header behind. Retrying can create another document. Move numbering, validation, header/items, and an idempotency record into a single database transaction. Verify rollback and concurrent retry behavior with real PostgreSQL tests.

### 2. Quotation conversion permits repeated orders

**Evidence:** [orders.service.ts](../src/services/orders.service.ts), `convertQuotationToOrder`; [QuotationsPage.tsx](../src/features/quotations/QuotationsPage.tsx).

Cloud conversion has no converted-state guard, creates an order in separate requests, and changes the quotation to `ACCEPTED`. The UI hides conversion only for `CONVERTED`, so conversion stays available. The demo follows a different lifecycle. Use a transaction that locks the quotation, enforces the conversion policy, creates one linked order, and marks it `CONVERTED`; add concurrent conversion tests. A client-only status check would not resolve the race.

### 3. Reads silently truncate large datasets

**Evidence:** [config.toml](../supabase/config.toml) configures `max_rows = 1000`; product/customer/dashboard and document services use unpaginated reads.

Product stock is summed from returned stock movements; receivables are summed from returned invoices. Once a response reaches the API row limit, these can become incomplete totals without an error. Lists, search, and reports are affected too. Use database aggregate queries for totals and pagination for lists, with test fixtures exceeding 1,000 rows. Fixing failed reads in this change does not fix truncation.

### 4. Payment retries can duplicate receipts

**Evidence:** [payments.service.ts](../src/services/payments.service.ts), `recordPayment`; migration 014's `record_payment_and_allocate` signature.

The call has no stable request idempotency key. If a payment commits but its response is lost, repeating the call can record another payment, particularly for unallocated receipts or balances that still allow another allocation. The existing warning after a confirmation-fetch failure covers only one failure path. Add a persisted request key and payload fingerprint inside the payment transaction, preserve it across retries, and test ambiguous commit outcomes.

## Additional functional and UX follow-ups

- **Cloud team management is incomplete.** `OrgContext.loadRemoteData` loads memberships for the signed-in user only, while `TeamPage` renders that collection as the organization roster. Load the authorized organization roster separately. Member update services also need affected-row verification before reporting success. Cloud invitation dispatch is explicitly unavailable.
- **Quick-create forms open before dependencies finish loading.** Orders, quotations, and payments call `loadData()` and immediately initialize forms from the previous/empty customer and product arrays. Wait for a successful load, provide a visible selection placeholder, and show actionable empty states when no customers/products exist.
- **Role-specific buttons are inconsistent.** Several feature pages gate writes by eligibility/subscription alone. This can offer actions that the user's role cannot perform, which the database then rejects. Apply the existing permission matrix to page buttons, URL-triggered forms, and submit handlers without changing server authorization.
- **Business dates and overdue logic need one convention.** Date fields and totals use UTC `toISOString().split('T')[0]`, while users operate in India. Early-morning local entries can receive the previous date. AI overdue checks compare a due-date midnight to the current instant and can mark an invoice due today overdue. Use a defined business timezone and compare calendar dates consistently.
- **Image uploads are not fully persisted in cloud mode.** Product forms submit `imageUrl`, and settings submit `logoUrl`, but their cloud write payloads omit them; the checked-in migrations do not define those columns. Implement a storage/schema contract or hide unavailable controls in cloud mode. Several optional edit fields also send `undefined` when cleared, which causes update payloads to retain the old database value.
- **Connection verification overclaims reachability.** `verifySupabaseConnection` treats a successful `auth.getSession()` as proof the Auth endpoint is reachable. The installed SDK can satisfy that call from local session storage. Use a real endpoint check or accurately label this as a local session/configuration check. Sidebar configuration status is also displayed as “Connected.”
- **Invoice printing needs a print layout.** `InvoicesPage` calls `window.print()` while the document is inside a scrollable modal; there are no print styles. Isolate the invoice, remove fixed positioning/height limits, hide navigation and action controls, and verify a multipage PDF.
- **AI approval can report persistence that failed.** The proposal approval flow ignores the result of the noncritical `auditService.logEvent`, then announces that the requisition was recorded. Check the outcome and distinguish an advisory acknowledgment from a durable procurement record; apply action permissions.
- **Mobile refinements remain.** Dense document forms need visible labels for every line-item field, larger touch targets, and less cramped two-column sections. Add an unsaved-changes warning before deliberate organization/navigation changes. Small chart text and hover-only detail need keyboard/mobile alternatives.
- **Documentation/CI expectations drift.** README lists five migrations while 23 exist, references a reports directory/feature absent from the current router, and says coverage/lint scripts are declared when `package.json` contains neither. CI runs the default suite without provisioning the skipped database tests. Update the documentation and add a disposable database job before treating CI as evidence of database correctness.

## Suggested implementation order

1. Implement and verify atomic order/quotation/conversion workflows and payment idempotency in a disposable database.
2. Replace incomplete client-side aggregates and introduce pagination.
3. Finish organization roster, permission-aware forms, and quick-create loading behavior.
4. Unify dates, complete image persistence and printing, then finish accessibility and mobile form refinements.

Changes from this review are local and uncommitted. The database and backend follow-ups above remain open.
