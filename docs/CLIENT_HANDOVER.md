# Client operations hardening and handover

## Eight ice-cream stalls

Create a separate named location for each of the eight stalls. Record opening float and the responsible staff member each IST business day. Receive packaged pieces or estimated scoops, record cash and UPI collections separately, then count closing stock and cash. Expected cash is opening float plus recorded cash sales; UPI is excluded. Counts are stock observations, not sales, and do not invent cash collections.

Transfer stock using **Transfer stock**, specifying the source, destination, product, quantity and reason. Both movements commit together and retries cannot duplicate them. Use **Write off stock** for melted, spoiled or damaged stock. Write-offs do not issue customer credits or change cash. Each adjustment retains its reason and history. A closing stock count must be based on the currently displayed balance; if another receipt/sale/transfer changes it, refresh and recount. Closed stalls reject additional movements that day.

## Ice-cream distribution launch

Start with factory receipt references, SKU, factory batch, case quantity, freezer and expiry. The same SKU/batch must use the same expiry across locations. Move cases between freezers through atomic transfers. Record customer commitments, then partial or complete dispatches against the same order reference. Dispatch cannot exceed stock or the unshipped commitment. Returns cannot exceed shipped cases for the order/batch. Restock only unexpired batches; damaged returns do not increase sellable stock. Expired cases can be written off but cannot be dispatched or transferred.

Commitments do not reserve inventory, and returns do not automatically reopen a completed commitment. The specialty stock/cash ledger is separate from the generic product/invoice ledger. Dispatches, return allowances and stall collections do not automatically create GST invoices, journal entries, bank settlement or payment-gateway verification. Avoid recording the same physical stock movement in both ledgers as if they were synchronized. Confirm the client's invoicing process before distribution handover.

## School workflow

School admin configures the profile, academic year, classes, fee categories and staff permissions. Import existing students using the CSV preview. The latest selected file wins even when a previous file finishes reading later. Successful entry forms clear entered values while retaining configured defaults; a fee collector must enter an amount again before recording another collection. Server-generated numbered receipts, paise calculations, payment allocations, concessions, refunds and immutable snapshots remain authoritative.

Staff IDs/positions, attendance and leave: see SCHOOL_STAFF.md. Personal Excel timetables and effective dates: see STAFF_TIMETABLES.md. Parent/student links and product entitlements: see PRODUCT_PORTALS.md. No timetable or printed ID automatically grants access to student records.

## Connection loss and uncertain saves

Unconfirmed specialty saves preserve their original request per account, organization, product and portal, including across reloads. Editing is blocked. **Retry unchanged operation** reuses the original idempotency key. **Check status / cancel if unsaved** confirms an already committed request or records a cancellation under the same transaction lock. Delayed attempts with a cancelled ID cannot post later. This avoids guessing whether cash or stock was already recorded. Recovery does not automatically replay offline operations.

## Verification boundaries

Synthetic scenarios cover eight separate cash drawers, transfers, wastage, stale counts, split distribution deliveries/returns/expiry, and a 1,000-student school with 20 classes, exact configured fee tax, 100 collections and teacher class isolation. A disposable restore compares counts and contents for 37 tables, including stock events, cancellation records, school financial records, staff, leave and original timetable files. These tests use generated data, not production client records.

Automated verification cannot establish zero bugs or validate unsupplied client workflows. Before real-client opening balances are entered, reconcile a sample physical stock count and cash day for each of the eight locations and a sample school receipt against the client's records. No production records have been altered to simulate these scenarios.

## Release verification — 28 November 2026

Applied migration 20261128025709 to production Supabase project hrxjgbupjtikokqxjzbh. Verified 396 database contracts, including a 37-table restore rehearsal; 978 full-suite unit/component tests passed with 39 existing skips; the final physical-count baseline regression passed separately; 82 browser tests passed, followed by a focused rerun of both ice-cream workflows. TypeScript, lint and production build passed. No generated client scenarios were run against production data.

The new cancellation table intentionally denies direct client access and uses guarded RPCs. Production confirms anonymous recovery execution is denied and authenticated users cannot bypass the new wrapper through the private base function. Security advisor warnings for legacy functions and leaked-password protection remain unchanged from DEPLOYMENT_2026_11_27.md. Private-table informational no-policy notices increase to 29 as expected.

Staff permissions in the specialty workspace are currently workspace-wide, not restricted per named stall. Establish the intended cashier access policy before issuing staff accounts. This release does not add temperature sensors, payment gateways or automatic statutory filing.
