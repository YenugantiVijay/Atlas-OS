-- ============================================================================
-- MIGRATION 009: Totals Version Marker & Document-Level Discount Share
-- ============================================================================
-- REVIEW ONLY: DO NOT DEPLOY OR EXECUTE ON PRODUCTION WITHOUT STAGING VALIDATION.
--
-- Safety & Integrity Guardrails:
-- 1. Sets column default for totals_version to 1 (Legacy format).
--    The database default MUST NOT be set to 2 during rollout to prevent any
--    older application instances, background workers, or third-party integrations
--    from mistakenly tagging legacy-format totals (e.g., net subtotals) as canonical.
-- 2. New canonical application paths explicitly pass totals_version = 2 upon insert.
-- 3. Existing rows automatically receive totals_version = 1 without table rewrite
--    or modification to any historical financial amounts.
-- 4. Adds document_discount_share column to line items to persist allocated
--    document-level discounts without requiring runtime derivation.
-- ============================================================================

-- Step 1: Add totals_version to document headers defaulting to 1 (Legacy)
-- Existing rows automatically receive 1. Column default remains 1.
ALTER TABLE sales_orders 
    ADD COLUMN IF NOT EXISTS totals_version SMALLINT NOT NULL DEFAULT 1 
    CHECK (totals_version IN (1, 2));

ALTER TABLE quotations 
    ADD COLUMN IF NOT EXISTS totals_version SMALLINT NOT NULL DEFAULT 1 
    CHECK (totals_version IN (1, 2));

ALTER TABLE invoices 
    ADD COLUMN IF NOT EXISTS totals_version SMALLINT NOT NULL DEFAULT 1 
    CHECK (totals_version IN (1, 2));

-- NOTE ON FUTURE DATABASE DEFAULT TO VERSION 2:
-- A database-level default of 2 (Canonical) must NOT be introduced here.
-- It may only be introduced in a future forward-only migration (e.g. Migration 010)
-- after the following preconditions are strictly satisfied:
--   a) 100% of running application instances, background workers, and edge clients
--      have been upgraded to code that explicitly passes canonical totals.
--   b) Any external integrations/APIs writing to these tables are certified to write
--      gross subtotals and separated document discounts.
--   c) Staging monitoring verifies 0 unversioned or legacy-format writes over at least
--      one complete operational cycle.

-- Step 2: Add document_discount_share to line items
-- Represents the line item's exact apportioned share of document-level discount.
-- Precision NUMERIC(12, 2) matches unit_price, line_subtotal, and line_total in migrations 004/005.
ALTER TABLE sales_order_items 
    ADD COLUMN IF NOT EXISTS document_discount_share NUMERIC(12, 2) NOT NULL DEFAULT 0.00 
    CHECK (document_discount_share >= 0.00);

ALTER TABLE quotation_items 
    ADD COLUMN IF NOT EXISTS document_discount_share NUMERIC(12, 2) NOT NULL DEFAULT 0.00 
    CHECK (document_discount_share >= 0.00);

ALTER TABLE invoice_items 
    ADD COLUMN IF NOT EXISTS document_discount_share NUMERIC(12, 2) NOT NULL DEFAULT 0.00 
    CHECK (document_discount_share >= 0.00);

-- Step 3: Index on totals_version for efficient diagnostic partitioning
CREATE INDEX IF NOT EXISTS idx_sales_orders_totals_version ON sales_orders(organization_id, totals_version);
CREATE INDEX IF NOT EXISTS idx_quotations_totals_version ON quotations(organization_id, totals_version);
CREATE INDEX IF NOT EXISTS idx_invoices_totals_version ON invoices(organization_id, totals_version);

-- ============================================================================
-- OPERATIONAL ROLLBACK & COMPATIBILITY PROTOCOL:
-- ============================================================================
-- 1. SCHEMA RETENTION (DO NOT DROP COLUMNS):
--    If an application rollback is required, DO NOT drop totals_version, 
--    document_discount_share, or their indexes. These columns are additive and
--    non-breaking. Retaining them preserves audit metadata for any records created
--    during the deployment window. Destructive column drops must NEVER be executed
--    as part of routine rollback.
--
-- 2. APPLICATION COMPATIBILITY WARNING:
--    Older application versions DO NOT understand version-2 canonical semantics
--    (where subtotal is Gross Subtotal and discount_amount is Total Discounts).
--    Older application versions MUST NOT edit, recalculate, or convert version-2
--    documents, as older code could double-deduct discounts or overwrite canonical
--    totals with legacy net subtotals.
--
-- 3. ROLLBACK PROCEDURE IF DEFECT DETECTED:
--    a) Query whether version-2 records were created:
--       SELECT 
--         (SELECT count(*) FROM sales_orders WHERE totals_version = 2) AS v2_orders,
--         (SELECT count(*) FROM quotations WHERE totals_version = 2) AS v2_quotes,
--         (SELECT count(*) FROM invoices WHERE totals_version = 2) AS v2_invoices;
--    b) If version-2 records exist:
--       - Strongly PREFER a forward fix or deploying a compatible hotfix build.
--       - If rolling back to an older build is unavoidable, temporarily PAUSE
--         document creation, conversion, and editing of version-2 documents.
--       - Read-only viewing in the old UI is permitted ONLY if the old UI renders
--         stored values directly without re-running calculation logic.
--    c) Never delete or rewrite historical (version-1) or new (version-2) records.
-- ============================================================================
