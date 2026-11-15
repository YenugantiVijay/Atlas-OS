# PR #56 — Bulk Goods Receiving / GRN

**State:** Development only, not deployed. Cloud-only first release; Demo Mode explicitly blocks saving/posting rather than reporting fictional inventory.

## Receiving workflow

Operators select an active supplier, supplier invoice/reference, receipt date and notes. They add existing products via tenant-scoped paginated lookup. Each line accepts individual carton contents such as 12,10,11 (three unequal cartons), shorthand 5x12 (five cartons containing 12 units each), and loose units. No fixed case size is assumed. The operator can paste 1–20 TAB-separated rows with exact SKU, carton contents, loose units and purchase rate.

Saving through save_goods_receipt_draft stores a server-validated draft but **does not create movements or modify stock**. Posting requires an additional confirmation and invokes post_goods_receipt. The database revalidates supplier, products and line totals, locks receipt and products, writes exactly one GOODS_RECEIVED movement per distinct product, marks receipt POSTED and writes an audit event atomically. Posted receipts are immutable; replaying the post is a no-op.

## Security and validation

Migration 047_bulk_goods_receipts.sql adds goods_receipts with tenant RLS SELECT and revoked direct browser DML. RPCs require active owner/admin/inventory membership and operational entitlement. Only authenticated may invoke them. Lines are capped at 50, cartons at 200 per line, quantity at 1–1,000,000 units per line, and costs at two decimals. Duplicate invoice numbers for the same organization/supplier are rejected. Purchase rates are receipt snapshots; no master purchase cost or selling price updates happen here.

## Acceptance

PR #56 includes pure worksheet tests and disposable PostgreSQL role, duplicate, tenant-isolation, idempotency, inventory and audit assertions, in addition to standard lint, typecheck, Vitest, build and Playwright. Do not run the paused 200-entry Demo Mode stress test.

## Explicit exclusions

Supplier payable accrual, GST input credit, purchase order matching, batch/expiry valuation, returns/reversals and price-history maintenance are not implemented by this slice. PR #57 handles supplier price history. Demo Mode has no authoritative goods-receipt ledger in this PR, so its posting controls stay disabled.

## Deployment

GitHub merge alone **does not apply migration 047**. Staging deployment, authorization tests and a supervised real-session receipt/post verification are required before enabling cloud usage. No hosted project or genuine inventory has been mutated as part of development. If migration is missing, the UI must show the server error rather than pretend success.