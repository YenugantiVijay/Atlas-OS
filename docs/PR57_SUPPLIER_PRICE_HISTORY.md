# PR #57 — Supplier Price History

**Scope:** Append-only supplier-specific purchase rate snapshots and manual supplier notices. Built on PR #56 goods receiving. No master product-price updates, no inventory revaluation, no supplier accounts payable accrual, and no automatic price prediction.

## Real operator workflow

1. Open **Inventory → Supplier Price History**. Owners, admins, inventory and accounts can review history. Owners/admins/inventory can also record new supplier quotes.
2. Choose supplier and active product, enter a new price per current product UOM, effective date and **required evidence/reference** (e.g. vendor WhatsApp message, price circular or quotation number).
3. View the latest previous dated rate for that supplier/product, with difference/percentage and an advisory highlight at changes of 5% or more. This is an alert in the form, **not** an automated notification or prediction.
4. Record the quote. Save is idempotent by a stable entry UUID. A retry cannot create duplicate entries, and conflicting reuse of the same entry ID is rejected. Records are append-only.
5. Whenever an authorized GRN is posted in PR #56, the database captures each line's actual purchase cost into the same timeline **inside the GRN posting transaction**. Quote and GRN entries have distinct source labels and references. Draft GRNs never generate supplier-price events.

## Database migration `048_supplier_price_history.sql`

- Creates `supplier_price_history` with supplier/product snapshots, unit cost, effective date, recorded timestamp, actor, source type `SUPPLIER_QUOTE`/`GOODS_RECEIPT`, reference and optional posted-receipt FK.
- Stores `unit_cost NUMERIC(12,2)`; positive and zero rates accepted, negative/fractional beyond two decimals rejected by explicit RPC validation. Manual effective date cannot be in the future. A reason of 3–500 characters is mandatory for manual entries.
- RLS allows **SELECT** only for active authorized users with owner/admin/inventory/accounts roles in the relevant tenant. Clients have no INSERT/UPDATE/DELETE grants. Append-only trigger prohibits direct updates/deletes even under privileged SQL paths.
- `record_supplier_price_quote` checks `auth.uid()`, real membership, role and `can_write_organization_operations` before validating supplier/product ownership and inserting a record plus audit event. SQL-level UUID idempotency prevents duplicate retries.
- A private `AFTER UPDATE OF status` trigger only captures prices for `DRAFT → POSTED` GRNs; it does not trigger for draft saves or replayed postings. The trigger and GRN post run within a single transaction. A failing write rolls back stock movements, receipt status and price records together.
- Forward-only backfill captures **already posted** migration-047 GRNs, without altering their stock, purchase costs, sale prices, GST values or ledger. No attempt is made to fabricate historical supplier quotations that the operator never entered.
- Monetary source snapshots are immutable; the price shown is a historical *rate per unit*, **not** a valuation policy, sale-price override or purchase payable.

## Tests and acceptance

- Disposable PostgreSQL acceptance `scripts/pr57_supplier_price_history_acceptance.mjs` verifies: trigger captured PR56 posted GRN rate, exact prior rate, duplicate quote retry, conflict with reused UUID, cross-org and sales-role denial, revoked DML, privileged append-only guard, no stock/product master modifications and exactly one audit event.
- Vitest service tests verify bounded/tenant-filtered/as-of history search, correct RPC call contract and failure handling. Pure unit tests cover rate parsing, deltas and 5% advisory threshold. Role tests assert accounts read-only and sales/viewers have no rate access.
- Playwright covers the page's Demo Mode warnings/disabled writes and horizontally scrollable mobile timeline.
- Original 200-entry industrial Demo Mode test remains paused until project completion.

## Rollout constraints

`048_supplier_price_history.sql` depends on `047_bulk_goods_receipts.sql` and is not deployed merely by merging the PR. Test migrations and authorization in a staging organization and run supervised cloud-session acceptance before recording real supplier notices. No connected hosted Supabase data were modified during PR #57 development.

## Known limitations (not falsely declared finished)

- No automated supplier price discovery; vendors determine changes, and staff must enter/confirm a notice or post a receipt.
- The recent timeline currently shows the latest 60 effective-dated entries; a bounded per-supplier/product lookup supplies the last comparable as-of rate. Complete pagination/exports and more advanced ranking can follow.
- No retrospective updates to existing manual product purchase-cost fields, no stock revaluation, no average/FIFO accounting recalculation, no advance alert notifications, and no supplier invoice/GST input-credit bookkeeping.
- Receipts from PR #56 continue to be cloud-only, and this PR does not create a Demo Mode price ledger.