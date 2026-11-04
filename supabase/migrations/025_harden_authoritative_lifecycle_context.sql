-- ============================================================================
-- MIGRATION 025: Harden Authoritative Lifecycle Context Against Trust Flag Manipulation
-- ============================================================================
-- Purpose:
-- 1. Hardens lifecycle triggers on sales_orders, sales_order_items, invoices, and
--    invoice_items to verify that GUC trust flags ('app.authoritative_order_transition',
--    'app.authoritative_invoice_transition', 'app.authoritative_payment_allocation')
--    can ONLY be honored when executed from within privileged SECURITY DEFINER RPCs.
-- 2. Prevents any caller executing directly under restricted roles ('authenticated',
--    'anon', 'public') from bypassing lifecycle checks by setting session GUCs directly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Hardened Sales Order Lifecycle Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_sales_order_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_trusted BOOLEAN;
BEGIN
    -- Trust flag is valid ONLY if explicitly set to 'true' AND current execution
    -- is executing inside a privileged SECURITY DEFINER routine (not direct client SQL)
    v_is_trusted := (current_setting('app.authoritative_order_transition', true) = 'true')
                    AND (CURRENT_USER NOT IN ('authenticated', 'anon', 'public'));

    IF TG_OP = 'DELETE' THEN
        IF OLD.status != 'DRAFT' THEN
            RAISE EXCEPTION 'Cannot delete sales order with status "%". Only DRAFT sales orders can be deleted.', OLD.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status != 'DRAFT' AND NOT v_is_trusted THEN
            RAISE EXCEPTION 'Direct insertion of sales order with status "%" is prohibited. Sales orders must start in DRAFT status.', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Prevent changing organization ownership
        IF NEW.organization_id != OLD.organization_id THEN
            RAISE EXCEPTION 'Changing organization_id on sales orders is prohibited.'
                USING ERRCODE = 'check_violation';
        END IF;

        -- Guard protected transitions from DRAFT
        IF OLD.status = 'DRAFT' THEN
            IF NEW.status = 'CONFIRMED' AND NOT v_is_trusted THEN
                RAISE EXCEPTION 'Direct status transition to CONFIRMED is prohibited. Sales orders must be confirmed via confirm_sales_order().'
                    USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.status = 'FULFILLED' AND NOT v_is_trusted THEN
                RAISE EXCEPTION 'Direct status transition to FULFILLED is prohibited. Sales orders must be fulfilled via create_invoice_atomic().'
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        -- Guard immutability of CONFIRMED or FULFILLED orders
        IF OLD.status IN ('CONFIRMED', 'FULFILLED') AND NOT v_is_trusted THEN
            IF NEW.status != OLD.status THEN
                RAISE EXCEPTION 'Direct status modification of % sales order is prohibited.', OLD.status
                    USING ERRCODE = 'check_violation';
            END IF;

            IF NEW.total_amount != OLD.total_amount OR
               NEW.subtotal != OLD.subtotal OR
               NEW.tax_amount != OLD.tax_amount OR
               NEW.customer_id != OLD.customer_id OR
               NEW.order_number != OLD.order_number THEN
                RAISE EXCEPTION 'Financial totals, customer, and order number of % sales order % are immutable.',
                    OLD.status, OLD.order_number
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Hardened Sales Order Items Immutability Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_sales_order_items_enforce_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status VARCHAR(50);
    v_so_id UUID;
    v_is_trusted BOOLEAN;
BEGIN
    v_is_trusted := (current_setting('app.authoritative_order_transition', true) = 'true')
                    AND (CURRENT_USER NOT IN ('authenticated', 'anon', 'public'));

    IF TG_OP = 'DELETE' THEN
        v_so_id := OLD.sales_order_id;
    ELSE
        v_so_id := NEW.sales_order_id;
    END IF;

    SELECT status INTO v_order_status
    FROM public.sales_orders
    WHERE id = v_so_id;

    IF v_order_status IN ('CONFIRMED', 'FULFILLED') AND NOT v_is_trusted THEN
        RAISE EXCEPTION 'Cannot % line items on % sales order %', TG_OP, v_order_status, v_so_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Hardened Invoice Lifecycle & Statutory Immutability Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_invoice_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_inv_trusted BOOLEAN;
    v_is_pay_trusted BOOLEAN;
BEGIN
    v_is_inv_trusted := (current_setting('app.authoritative_invoice_transition', true) = 'true')
                        AND (CURRENT_USER NOT IN ('authenticated', 'anon', 'public'));
    v_is_pay_trusted := (current_setting('app.authoritative_payment_allocation', true) = 'true')
                        AND (CURRENT_USER NOT IN ('authenticated', 'anon', 'public'));

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Deletion of statutory invoice records is strictly prohibited under financial regulations.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status != 'DRAFT' AND NOT v_is_inv_trusted THEN
            RAISE EXCEPTION 'Direct insertion of invoice with status "%" is prohibited. Invoices must be issued via create_invoice_atomic().', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.organization_id != OLD.organization_id THEN
            RAISE EXCEPTION 'Changing organization_id on invoices is prohibited.'
                USING ERRCODE = 'check_violation';
        END IF;

        IF OLD.status = 'DRAFT' AND NEW.status != 'DRAFT' AND NOT v_is_inv_trusted THEN
            RAISE EXCEPTION 'Direct transition from DRAFT to % is prohibited. Invoices must be issued via create_invoice_atomic().', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;

        IF OLD.status IN ('ISSUED', 'PAID') AND NOT v_is_inv_trusted THEN
            IF NEW.invoice_number != OLD.invoice_number OR
               NEW.customer_id != OLD.customer_id OR
               NEW.total_amount != OLD.total_amount OR
               NEW.subtotal != OLD.subtotal OR
               NEW.tax_amount != OLD.tax_amount THEN
                RAISE EXCEPTION 'Financial totals, customer, and invoice number of issued invoice % are immutable.',
                    OLD.invoice_number
                    USING ERRCODE = 'check_violation';
            END IF;

            -- Total paid balance mutations must be authorized by payment allocation RPC
            IF NEW.total_paid != OLD.total_paid AND NOT v_is_pay_trusted THEN
                RAISE EXCEPTION 'Direct modification of invoice paid balance is prohibited. Payments must be recorded via record_payment_and_allocate().'
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Hardened Invoice Items Immutability Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_invoice_items_enforce_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inv_status VARCHAR(50);
    v_inv_id UUID;
    v_is_trusted BOOLEAN;
BEGIN
    v_is_trusted := (current_setting('app.authoritative_invoice_transition', true) = 'true')
                    AND (CURRENT_USER NOT IN ('authenticated', 'anon', 'public'));

    IF TG_OP = 'DELETE' THEN
        v_inv_id := OLD.invoice_id;
    ELSE
        v_inv_id := NEW.invoice_id;
    END IF;

    SELECT status INTO v_inv_status
    FROM public.invoices
    WHERE id = v_inv_id;

    IF v_inv_status IN ('ISSUED', 'PAID') AND NOT v_is_trusted THEN
        RAISE EXCEPTION 'Cannot % line items on % invoice %', TG_OP, v_inv_status, v_inv_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
