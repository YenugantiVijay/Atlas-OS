CREATE TABLE IF NOT EXISTS public.counter_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    opened_by UUID NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    opening_cash NUMERIC(12, 2) NOT NULL CHECK (opening_cash >= 0),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    closed_by UUID,
    closed_at TIMESTAMPTZ,
    closing_cash NUMERIC(12, 2),
    expected_cash NUMERIC(12, 2),
    variance NUMERIC(12, 2),
    idempotency_key UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, idempotency_key),
    CHECK (
      (status = 'OPEN' AND closed_by IS NULL AND closed_at IS NULL
        AND closing_cash IS NULL AND expected_cash IS NULL AND variance IS NULL)
      OR
      (status = 'CLOSED' AND closed_by IS NOT NULL AND closed_at IS NOT NULL
        AND closing_cash IS NOT NULL AND expected_cash IS NOT NULL AND variance IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS counter_shifts_one_open_per_organization
    ON public.counter_shifts (organization_id)
    WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS public.counter_shift_payments (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL,
    payment_id UUID NOT NULL REFERENCES public.payments(id),
    linked_by UUID NOT NULL,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (organization_id, payment_id),
    FOREIGN KEY (organization_id, shift_id)
      REFERENCES public.counter_shifts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS counter_shift_payments_shift_idx
    ON public.counter_shift_payments (organization_id, shift_id);
CREATE INDEX IF NOT EXISTS counter_shift_receipts_by_time_idx
    ON public.payments (organization_id, created_at);

ALTER TABLE public.counter_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counter_shift_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS counter_shifts_select ON public.counter_shifts;
CREATE POLICY counter_shifts_select ON public.counter_shifts
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY counter_shifts_finance_read_guard ON public.counter_shifts AS RESTRICTIVE
    FOR SELECT TO authenticated
    USING (
      public.can_read_organization_data(organization_id)
      AND (
        public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
        OR (
          public.user_has_org_role(organization_id, 'sales')
          AND opened_by = auth.uid()
        )
      )
    );
COMMENT ON POLICY counter_shifts_finance_read_guard ON public.counter_shifts IS
    'Counter cash details are visible to finance roles and sales staff only for their own shift.';

DROP POLICY IF EXISTS counter_shift_payments_select ON public.counter_shift_payments;
CREATE POLICY counter_shift_payments_select ON public.counter_shift_payments
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY counter_shift_payments_finance_read_guard ON public.counter_shift_payments AS RESTRICTIVE
    FOR SELECT TO authenticated
    USING (
      public.can_read_organization_data(organization_id)
      AND (
        public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
        OR (
          public.user_has_org_role(organization_id, 'sales')
          AND EXISTS (
            SELECT 1
            FROM public.counter_shifts AS shift
            WHERE shift.organization_id = counter_shift_payments.organization_id
              AND shift.id = counter_shift_payments.shift_id
              AND shift.opened_by = auth.uid()
          )
        )
      )
    );
COMMENT ON POLICY counter_shift_payments_finance_read_guard ON public.counter_shift_payments IS
    'Receipt links are visible to finance roles and sales staff only for their own shift.';

REVOKE ALL ON TABLE public.counter_shifts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.counter_shift_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.counter_shifts TO authenticated;
GRANT SELECT ON TABLE public.counter_shift_payments TO authenticated;
GRANT ALL ON TABLE public.counter_shifts TO service_role;
GRANT ALL ON TABLE public.counter_shift_payments TO service_role;

CREATE OR REPLACE FUNCTION public.get_counter_shift_receipts(
    p_org_id UUID,
    p_shift_id UUID
)
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    payment_number TEXT,
    customer_id UUID,
    customer_name TEXT,
    amount NUMERIC(12, 2),
    payment_method TEXT,
    payment_date DATE,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_shift public.counter_shifts%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;
    IF p_org_id IS NULL OR p_shift_id IS NULL THEN
        RAISE EXCEPTION 'Organization and shift are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF NOT public.can_read_organization_data(p_org_id)
       OR NOT public.user_has_org_role(p_org_id, 'owner', 'admin', 'accounts', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized to read counter shift receipts'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_shift
    FROM public.counter_shifts
    WHERE organization_id = p_org_id AND id = p_shift_id;
    IF NOT FOUND OR v_shift.status <> 'OPEN' THEN
        RAISE EXCEPTION 'Counter shift is not open in this business'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.user_has_org_role(p_org_id, 'owner', 'admin', 'accounts')
       AND v_shift.opened_by <> v_uid THEN
        RAISE EXCEPTION 'Only the shift opener or a finance administrator can read its receipts'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    SELECT p.id, p.organization_id, p.payment_number::TEXT, p.customer_id, c.name::TEXT,
           p.amount, p.payment_method::TEXT, p.payment_date, p.created_at
    FROM public.payments AS p
    LEFT JOIN public.customers AS c
      ON c.id = p.customer_id AND c.organization_id = p.organization_id
    WHERE p.organization_id = p_org_id
      AND p.created_at >= v_shift.opened_at
    ORDER BY p.created_at ASC, p.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_counter_shift_receipts(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_counter_shift_receipts(UUID, UUID) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_counter_shift_receipts(UUID, UUID) IS
    'Returns only receipt fields needed for reconciling an open shift, scoped to finance roles or its sales opener.';

CREATE OR REPLACE FUNCTION public.open_counter_shift(
    p_org_id UUID,
    p_opening_cash NUMERIC,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_role TEXT;
    v_shift public.counter_shifts%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;
    IF p_org_id IS NULL OR p_idempotency_key IS NULL
       OR p_opening_cash IS NULL OR p_opening_cash < 0 OR p_opening_cash > 9999999999.99 THEN
        RAISE EXCEPTION 'Organization, idempotency key, and a valid nonnegative opening cash amount are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_role := public.get_user_org_role(p_org_id);
    IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized to open a counter shift' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied for this organization' USING ERRCODE = 'insufficient_privilege';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('counter_shift:' || p_org_id::text));

    SELECT * INTO v_shift
    FROM public.counter_shifts
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_shift.opening_cash <> p_opening_cash THEN
            RAISE EXCEPTION 'Idempotency key reused with a different opening cash amount'
                USING ERRCODE = 'unique_violation';
        END IF;
        RETURN to_jsonb(v_shift);
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.counter_shifts
        WHERE organization_id = p_org_id AND status = 'OPEN'
    ) THEN
        RAISE EXCEPTION 'A counter shift is already open for this business'
            USING ERRCODE = 'unique_violation';
    END IF;

    INSERT INTO public.counter_shifts (organization_id, opened_by, opening_cash, idempotency_key)
    VALUES (p_org_id, v_uid, round(p_opening_cash, 2), p_idempotency_key)
    RETURNING * INTO v_shift;

    INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    VALUES (p_org_id, v_uid, 'COUNTER_SHIFT_OPENED', 'COUNTER_SHIFT', v_shift.id,
        jsonb_build_object('opening_cash', v_shift.opening_cash));

    RETURN to_jsonb(v_shift);
END;
$$;

CREATE OR REPLACE FUNCTION public.link_counter_shift_payment(
    p_org_id UUID,
    p_shift_id UUID,
    p_payment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_role TEXT;
    v_shift public.counter_shifts%ROWTYPE;
    v_payment public.payments%ROWTYPE;
    v_link public.counter_shift_payments%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;
    IF p_org_id IS NULL OR p_shift_id IS NULL OR p_payment_id IS NULL THEN
        RAISE EXCEPTION 'Organization, shift, and payment are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_role := public.get_user_org_role(p_org_id);
    IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized to link a counter receipt' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied for this organization' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_shift FROM public.counter_shifts
    WHERE organization_id = p_org_id AND id = p_shift_id FOR UPDATE;
    IF NOT FOUND OR v_shift.status <> 'OPEN' THEN
        RAISE EXCEPTION 'Counter shift is not open in this business'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_shift.opened_by <> v_uid AND v_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only the shift opener or a business administrator can link receipts'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_payment FROM public.payments
    WHERE organization_id = p_org_id AND id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found in this business' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_payment.created_at < v_shift.opened_at THEN
        RAISE EXCEPTION 'Only receipts recorded after this shift opened can be linked'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_link FROM public.counter_shift_payments
    WHERE organization_id = p_org_id AND payment_id = p_payment_id;
    IF FOUND THEN
        IF v_link.shift_id <> p_shift_id THEN
            RAISE EXCEPTION 'This receipt is already assigned to another shift'
                USING ERRCODE = 'unique_violation';
        END IF;
        RETURN to_jsonb(v_link);
    END IF;

    INSERT INTO public.counter_shift_payments (organization_id, shift_id, payment_id, linked_by)
    VALUES (p_org_id, p_shift_id, p_payment_id, v_uid)
    RETURNING * INTO v_link;
    INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    VALUES (p_org_id, v_uid, 'COUNTER_RECEIPT_LINKED', 'COUNTER_SHIFT', p_shift_id,
        jsonb_build_object('payment_id', p_payment_id));
    RETURN to_jsonb(v_link);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_counter_shift(
    p_org_id UUID,
    p_shift_id UUID,
    p_closing_cash NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_role TEXT;
    v_shift public.counter_shifts%ROWTYPE;
    v_expected_cash NUMERIC(12, 2);
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;
    IF p_org_id IS NULL OR p_shift_id IS NULL OR p_closing_cash IS NULL
       OR p_closing_cash < 0 OR p_closing_cash > 9999999999.99 THEN
        RAISE EXCEPTION 'Organization, shift, and a valid nonnegative counted cash amount are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_role := public.get_user_org_role(p_org_id);
    IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized to close a counter shift' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied for this organization' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_shift FROM public.counter_shifts
    WHERE organization_id = p_org_id AND id = p_shift_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Counter shift not found in this business' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_shift.status = 'CLOSED' THEN
        IF v_shift.closing_cash = round(p_closing_cash, 2) THEN
            RETURN to_jsonb(v_shift);
        END IF;
        RAISE EXCEPTION 'Counter shift is already closed with a different counted amount'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_shift.opened_by <> v_uid AND v_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only the shift opener or a business administrator can close this shift'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.organization_id = p_org_id
          AND p.created_at >= v_shift.opened_at
          AND NOT EXISTS (
            SELECT 1 FROM public.counter_shift_payments csp
            WHERE csp.organization_id = p_org_id AND csp.payment_id = p.id
          )
    ) THEN
        RAISE EXCEPTION 'Link every payment recorded since shift opening before closing the drawer'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT round(v_shift.opening_cash + COALESCE(SUM(p.amount) FILTER (WHERE p.payment_method = 'CASH'), 0), 2)
    INTO v_expected_cash
    FROM public.counter_shift_payments csp
    JOIN public.payments p
      ON p.id = csp.payment_id AND p.organization_id = csp.organization_id
    WHERE csp.organization_id = p_org_id AND csp.shift_id = p_shift_id;

    UPDATE public.counter_shifts
    SET status = 'CLOSED',
        closed_by = v_uid,
        closed_at = timezone('utc'::text, now()),
        closing_cash = round(p_closing_cash, 2),
        expected_cash = v_expected_cash,
        variance = round(p_closing_cash, 2) - v_expected_cash
    WHERE organization_id = p_org_id AND id = p_shift_id
    RETURNING * INTO v_shift;

    INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    VALUES (p_org_id, v_uid, 'COUNTER_SHIFT_CLOSED', 'COUNTER_SHIFT', v_shift.id,
        jsonb_build_object(
          'expected_cash', v_shift.expected_cash,
          'closing_cash', v_shift.closing_cash,
          'variance', v_shift.variance
        ));

    RETURN to_jsonb(v_shift);
END;
$$;

REVOKE ALL ON FUNCTION public.open_counter_shift(UUID, NUMERIC, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_counter_shift_payment(UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_counter_shift(UUID, UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_counter_shift(UUID, NUMERIC, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_counter_shift_payment(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_counter_shift(UUID, UUID, NUMERIC) TO authenticated, service_role;
