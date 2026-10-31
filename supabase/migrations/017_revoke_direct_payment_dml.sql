-- ============================================================================
-- Migration 017: Revoke Direct Payment and Payment Allocation DML (DEF-009)
-- ============================================================================
-- Defect:
--   DEF-009 — Direct Payment Ledger DML Bypass
--
-- Background & Security Rationale:
--   Migration 014 created RLS policies 'payments_insert' and 'payment_allocations_insert'
--   that allowed authenticated users with 'owner', 'admin', or 'accounts' roles to
--   directly execute INSERT statements on public.payments and public.payment_allocations.
--
--   Direct client DML bypassing the authoritative atomic RPC causes critical ledger vulnerabilities:
--   1. Sequence Number Bypass: Receipt numbers are NOT generated via the authoritative
--      internal sequence allocator (allocate_document_number), leading to NULL, duplicate,
--      or non-compliant receipt numbers.
--   2. Incomplete Financial State: Direct payment insertion fails to update invoice
--      total_paid balances and fails to update invoice status (PAID / PARTIALLY_PAID).
--   3. Over-Allocation & Integrity Violations: Direct allocation insertion bypasses invoice
--      balance validation, allowing allocation amounts exceeding outstanding balances.
--   4. Audit Trail Erasure: Direct inserts do NOT record corresponding audit events in
--      public.audit_events, breaking regulatory and compliance requirements.
--
-- Precise ACL Strategy:
--   1. Blanket revocation: Revoke ALL PRIVILEGES on public.payments and
--      public.payment_allocations from PUBLIC, anon, authenticated, and service_role.
--      This strips all existing table-level privileges and eliminates inherited access
--      via the PUBLIC pseudo-role.
--   2. Drop obsolete permissive client insert policies from Migration 014:
--      - public.payments: payments_insert
--      - public.payment_allocations: payment_allocations_insert
--   3. Regrant precise minimal table-level privileges:
--      - PUBLIC: No table privileges.
--      - anon: No table privileges.
--      - authenticated: SELECT only (tenant isolation enforced by existing RLS policies
--        payments_select and payment_allocations_select).
--      - service_role: SELECT and INSERT only (trusted server-side execution; UPDATE,
--        DELETE, and TRUNCATE are prohibited to preserve statutory immutability).
--   4. Authoritative atomic RPC execution:
--      All payments and allocations must execute strictly via
--      public.record_payment_and_allocate(...), which executes with SECURITY DEFINER
--      privileges and performs comprehensive validation, locking, numbering, and auditing.
-- ============================================================================

-- 1. Blanket revocation: Strip ALL privileges from PUBLIC, anon, authenticated, and service_role
REVOKE ALL PRIVILEGES ON TABLE public.payments FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.payment_allocations FROM PUBLIC, anon, authenticated, service_role;

-- 2. Drop obsolete permissive client insert policies
DROP POLICY IF EXISTS payments_insert ON public.payments;
DROP POLICY IF EXISTS payment_allocations_insert ON public.payment_allocations;

-- 3. Regrant precise minimal table-level privileges

-- Authenticated: SELECT only (subject to existing tenant-isolated SELECT RLS policies)
GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT SELECT ON TABLE public.payment_allocations TO authenticated;

-- Service role: SELECT and INSERT only (trusted server-side admin/ingestion; mutations/deletions denied)
GRANT SELECT, INSERT ON TABLE public.payments TO service_role;
GRANT SELECT, INSERT ON TABLE public.payment_allocations TO service_role;

-- 4. Reaffirm authoritative atomic RPC execution grants
-- (Preserves exact signature from Migration 014: 9 parameters)
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(
    UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(
    UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC
) TO service_role;
REVOKE ALL ON FUNCTION public.record_payment_and_allocate(
    UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC
) FROM PUBLIC, anon;

-- 5. Table documentation comments
COMMENT ON TABLE public.payments IS
    'Statutory payment receipt ledger. Direct client DML from authenticated/anon roles is prohibited; all application payment recordings must execute via the authoritative record_payment_and_allocate RPC. Trusted server-side operations via service_role retain an explicit direct INSERT privilege for administrative/migration ingestion, while UPDATE, DELETE, and TRUNCATE remain prohibited for all roles.';
COMMENT ON TABLE public.payment_allocations IS
    'Payment to invoice allocation ledger. Direct client DML from authenticated/anon roles is prohibited; all application payment allocations must execute via the authoritative record_payment_and_allocate RPC. Trusted server-side operations via service_role retain an explicit direct INSERT privilege for administrative/migration ingestion, while UPDATE, DELETE, and TRUNCATE remain prohibited for all roles.';
