-- ============================================================================
-- MIGRATION 010: Robust Document Numbering Sequences & Atomic Allocator
-- ============================================================================
-- REVIEW ONLY: DO NOT DEPLOY OR EXECUTE ON PRODUCTION WITHOUT STAGING VALIDATION.
--
-- Purpose:
-- Replaces collision-prone timestamp-suffix document numbering with an atomic,
-- database-backed sequence allocator per organization, document type, and year.
-- Uses row-level locking on document_sequences to ensure race-free concurrency,
-- with database uniqueness constraints providing final duplicate defense.
--
-- Scope:
-- 1. Creates document_sequences table partitioned by (organization_id, document_type, year).
-- 2. Implements allocate_document_number RPC with row locking and collision avoidance.
-- 3. Retains all existing documents and historical number formats without renumbering.
-- ============================================================================

-- Step 1: Create document_sequences table
CREATE TABLE IF NOT EXISTS public.document_sequences (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('QUOTATION', 'SALES_ORDER', 'INVOICE')),
    year INTEGER NOT NULL CHECK (year >= 2000 AND year <= 2100),
    current_value INTEGER NOT NULL DEFAULT 0 CHECK (current_value >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, document_type, year)
);

-- Step 2: Enable RLS on document_sequences
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

-- Read policy: Organization members can inspect sequence metadata for their org
DROP POLICY IF EXISTS "Members can view org document sequences" ON public.document_sequences;
CREATE POLICY "Members can view org document sequences"
    ON public.document_sequences
    FOR SELECT
    TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
        )
    );

-- Index for sequence lookup performance
CREATE INDEX IF NOT EXISTS idx_document_sequences_lookup 
    ON public.document_sequences(organization_id, document_type, year);

-- Step 3: Atomic Sequence Allocation RPC Function
CREATE OR REPLACE FUNCTION public.allocate_document_number(
    p_org_id UUID,
    p_doc_type VARCHAR,
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS VARCHAR AS $$
DECLARE
    v_prefix VARCHAR;
    v_next_val INTEGER;
    v_candidate VARCHAR;
    v_exists BOOLEAN;
    v_has_access BOOLEAN;
    v_fy VARCHAR;
BEGIN
    -- 1. Authorization check: caller must belong to target organization or be service_role
    IF auth.role() = 'authenticated' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.memberships
            WHERE organization_id = p_org_id AND user_id = auth.uid()
        ) INTO v_has_access;

        IF NOT v_has_access THEN
            RAISE EXCEPTION 'Access denied: caller does not belong to organization %', p_org_id;
        END IF;
    END IF;

    -- 2. Validate document type and assign canonical prefix
    IF p_doc_type = 'QUOTATION' THEN
        v_prefix := 'QT';
    ELSIF p_doc_type = 'SALES_ORDER' THEN
        v_prefix := 'SO';
    ELSIF p_doc_type = 'INVOICE' THEN
        v_prefix := 'ATL';
    ELSE
        RAISE EXCEPTION 'Invalid document type: %. Must be QUOTATION, SALES_ORDER, or INVOICE.', p_doc_type;
    END IF;

    -- 3. Atomic allocation loop with row-locking and collision check
    LOOP
        -- Atomic upsert increment using row lock on (organization_id, document_type, year)
        INSERT INTO public.document_sequences (
            organization_id, 
            document_type, 
            year, 
            current_value, 
            created_at, 
            updated_at
        ) VALUES (
            p_org_id, 
            p_doc_type, 
            p_year, 
            1, 
            NOW(), 
            NOW()
        )
        ON CONFLICT (organization_id, document_type, year)
        DO UPDATE SET 
            current_value = public.document_sequences.current_value + 1,
            updated_at = NOW()
        RETURNING current_value INTO v_next_val;

        IF p_doc_type = 'INVOICE' THEN
            -- Indian GST Financial Year format: ATL/YY-YY/NNNN (GST Rule 46 compliant)
            -- Indian FY runs April 1 to March 31.
            IF EXTRACT(MONTH FROM CURRENT_DATE) < 4 THEN
                v_fy := TO_CHAR((p_year - 1) % 100, 'FM00') || '-' || TO_CHAR(p_year % 100, 'FM00');
            ELSE
                v_fy := TO_CHAR(p_year % 100, 'FM00') || '-' || TO_CHAR((p_year + 1) % 100, 'FM00');
            END IF;
            v_candidate := 'ATL/' || v_fy || '/' || LPAD(v_next_val::TEXT, 4, '0');
        ELSE
            v_candidate := v_prefix || '-' || p_year::TEXT || '-' || LPAD(v_next_val::TEXT, 4, '0');
        END IF;

        -- 4. Verify candidate does not collide with existing historical records
        IF p_doc_type = 'QUOTATION' THEN
            SELECT EXISTS (
                SELECT 1 FROM public.quotations 
                WHERE organization_id = p_org_id AND quotation_number = v_candidate
            ) INTO v_exists;
        ELSIF p_doc_type = 'SALES_ORDER' THEN
            SELECT EXISTS (
                SELECT 1 FROM public.sales_orders 
                WHERE organization_id = p_org_id AND order_number = v_candidate
            ) INTO v_exists;
        ELSIF p_doc_type = 'INVOICE' THEN
            SELECT EXISTS (
                SELECT 1 FROM public.invoices 
                WHERE organization_id = p_org_id AND invoice_number = v_candidate
            ) INTO v_exists;
        END IF;

        IF NOT v_exists THEN
            RETURN v_candidate;
        END IF;
        -- If already in table (e.g. historical data), loop advances sequence to next candidate
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Step 4: Grant execution permissions
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) TO service_role;
