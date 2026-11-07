-- ============================================================================
-- Migration 038: SEC-01 — Authoritative raw financial-record SELECT boundary
-- ============================================================================
-- Financial report authorization via RPC (037) does NOT protect ordinary
-- PostgREST SELECT requests. Apply restrictive policies to the four raw
-- financial tables so no permissive legacy/current policy can grant bypass.
--
-- Existing operational RPCs are SECURITY DEFINER and continue to enforce
-- their own business authorization. Financial dashboard aggregate RPCs remain
-- intentionally available via their separate organization read contract.
-- ============================================================================
BEGIN;

-- The underlying invoices and payment ledgers contain full amounts, customer
-- relationships and financial details. Only active accounts/admin/owner members
-- of the same non-rejected organization may query raw rows.
CREATE POLICY sec01_invoices_finance_read_guard
    ON public.invoices AS RESTRICTIVE
    FOR SELECT TO authenticated
    USING (
        public.can_read_organization_data(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
    );

CREATE POLICY sec01_payments_finance_read_guard
    ON public.payments AS RESTRICTIVE
    FOR SELECT TO authenticated
    USING (
        public.can_read_organization_data(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
    );

-- Explicit child policies: do not depend solely on the parent having the right
-- policies. A child row cannot be exposed via embedded/nested PostgREST reads.
CREATE POLICY sec01_invoice_items_finance_read_guard
    ON public.invoice_items AS RESTRICTIVE
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.invoices AS i
            WHERE i.id = invoice_id
              AND public.can_read_organization_data(i.organization_id)
              AND public.user_has_org_role(i.organization_id, 'owner', 'admin', 'accounts')
        )
    );

CREATE POLICY sec01_payment_allocations_finance_read_guard
    ON public.payment_allocations AS RESTRICTIVE
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.payments AS p
            WHERE p.id = payment_id
              AND public.can_read_organization_data(p.organization_id)
              AND public.user_has_org_role(p.organization_id, 'owner', 'admin', 'accounts')
        )
    );

-- Migration 036 defines this READ-ONLY invoice lookup as SECURITY DEFINER.
-- That bypasses table RLS and originally checked only organization membership.
-- It MUST run as the invoker so migration 038's restrictive invoice policy
-- applies even to direct RPC calls with forged customer/exact invoice IDs.
ALTER FUNCTION public.get_eligible_payment_invoices(UUID, UUID, TEXT, INTEGER, INTEGER, UUID)
    SECURITY INVOKER;

COMMENT ON POLICY sec01_invoices_finance_read_guard ON public.invoices IS
    'SEC-01: Raw invoice details require active owner/admin/accounts membership.';
COMMENT ON POLICY sec01_payments_finance_read_guard ON public.payments IS
    'SEC-01: Raw payments require active owner/admin/accounts membership.';
COMMENT ON POLICY sec01_invoice_items_finance_read_guard ON public.invoice_items IS
    'SEC-01: Restricts invoice line-item reads even if another permissive SELECT policy exists.';
COMMENT ON POLICY sec01_payment_allocations_finance_read_guard ON public.payment_allocations IS
    'SEC-01: Restricts payment allocation reads even if another permissive SELECT policy exists.';

COMMIT;
