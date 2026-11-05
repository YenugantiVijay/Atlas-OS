-- ============================================================================
-- Migration 032: Cleanup Obsolete create_product_atomic Overload
-- ============================================================================
-- History and Technical Rationale:
--   1. Migration 022 introduced the initial atomic product creation function:
--        public.create_product_atomic(
--          UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, NUMERIC,
--          NUMERIC, NUMERIC, VARCHAR, INTEGER, BOOLEAN, INTEGER, TEXT
--        )
--   2. Migration 024 updated the signature to support optional product image URLs
--      and reordered parameters to align with domain model requirements:
--        public.create_product_atomic(
--          UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, NUMERIC,
--          INTEGER, VARCHAR, TEXT, VARCHAR, INTEGER, TEXT, TEXT
--        )
--   3. Migration 031 was applied to production while both signatures remained in the
--      database. Because the parameter types and positions differed, PostgreSQL
--      retained the Migration 022 function as an overload. When callers invoke the
--      function with named parameter subsets omitting trailing parameters (e.g. p_image_url),
--      PostgreSQL raises SQLSTATE 42725 ("function create_product_atomic is not unique").
--   4. This forward-only migration removes the obsolete Migration 022 signature
--      cleanly and idempotently without CASCADE, preserving all dependencies.
--
-- CRITICAL WARNING TO FUTURE DEVELOPERS:
--   DO NOT reintroduce conflicting overloads of public.create_product_atomic.
--   Any future additions or parameter alterations must either use CREATE OR REPLACE
--   with the EXACT parameter types and positions of the Migration 024 signature,
--   or explicitly drop any superseded signature in a forward-only migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop Only the Obsolete Migration 022 Function Signature (WITHOUT CASCADE)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_product_atomic(
    UUID,      -- p_org_id
    VARCHAR,   -- p_sku
    VARCHAR,   -- p_name
    VARCHAR,   -- p_brand
    VARCHAR,   -- p_category
    TEXT,      -- p_description
    VARCHAR,   -- p_uom
    NUMERIC,   -- p_purchase_cost
    NUMERIC,   -- p_selling_price
    NUMERIC,   -- p_tax_rate
    VARCHAR,   -- p_hsn_code
    INTEGER,   -- p_reorder_threshold
    BOOLEAN,   -- p_is_active
    INTEGER,   -- p_opening_stock
    TEXT       -- p_notes
);

-- ----------------------------------------------------------------------------
-- 2. Affirm Presence and Security Grants on the Authoritative Migration 024 Signature
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_product_atomic(
    UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, NUMERIC,
    INTEGER, VARCHAR, TEXT, VARCHAR, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.create_product_atomic(
    UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, NUMERIC,
    INTEGER, VARCHAR, TEXT, VARCHAR, INTEGER, TEXT, TEXT
) TO authenticated;
