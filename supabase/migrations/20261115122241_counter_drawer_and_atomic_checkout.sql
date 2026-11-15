BEGIN;

CREATE TABLE atlas_private.counter_checkout_requests (
  organization_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (organization_id, request_id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES public.counter_shifts(organization_id, id)
);
CREATE INDEX counter_checkout_requests_shift ON atlas_private.counter_checkout_requests (organization_id, shift_id);
ALTER TABLE atlas_private.counter_checkout_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE atlas_private.counter_checkout_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.counter_cash_movements (
  organization_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  request_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 9999999999.99),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, shift_id, request_id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES public.counter_shifts(organization_id, id)
);
ALTER TABLE public.counter_cash_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.counter_cash_movements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.counter_cash_movements TO authenticated;
CREATE POLICY counter_cash_movements_read ON public.counter_cash_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.counter_shifts shift
    WHERE shift.organization_id = counter_cash_movements.organization_id AND shift.id = counter_cash_movements.shift_id));

-- Past links and closed reconciliation totals remain readable. New receipt links
-- come from a counter checkout and are never inferred from timestamps or notes.
REVOKE EXECUTE ON FUNCTION public.link_counter_shift_payment(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_counter_shift_receipts(p_org_id uuid, p_shift_id uuid)
RETURNS TABLE (
  id uuid, organization_id uuid, payment_number text, customer_id uuid, customer_name text,
  amount numeric(12,2), payment_method text, payment_date date, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := public.get_user_org_role(p_org_id);
  v_opened_by uuid;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'accounts', 'sales')
     OR public.can_read_organization_data(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Counter receipts are outside this account’s access' USING ERRCODE = '42501';
  END IF;
  SELECT s.opened_by INTO v_opened_by FROM public.counter_shifts s WHERE s.organization_id = p_org_id AND s.id = p_shift_id;
  IF NOT FOUND OR (v_role = 'sales' AND v_opened_by <> v_uid) THEN
    RAISE EXCEPTION 'Counter shift is unavailable for this account' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.organization_id, p.payment_number::text, p.customer_id, c.name::text,
    p.amount, p.payment_method::text, p.payment_date, p.created_at
  FROM public.counter_shift_payments link
  JOIN public.payments p ON p.organization_id = link.organization_id AND p.id = link.payment_id
  LEFT JOIN public.customers c ON c.organization_id = p.organization_id AND c.id = p.customer_id
  WHERE link.organization_id = p_org_id AND link.shift_id = p_shift_id
  ORDER BY p.created_at, p.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_counter_shift(p_org_id uuid, p_shift_id uuid, p_closing_cash numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := public.get_user_org_role(p_org_id);
  v_shift public.counter_shifts%ROWTYPE;
  v_expected numeric(12,2);
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales')
     OR public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Counter shift cannot be closed by this account' USING ERRCODE = '42501';
  END IF;
  IF p_closing_cash IS NULL OR p_closing_cash < 0 OR p_closing_cash > 9999999999.99
     OR p_closing_cash <> round(p_closing_cash, 2) THEN
    RAISE EXCEPTION 'Enter counted cash with at most two decimal places' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_shift FROM public.counter_shifts s WHERE s.organization_id = p_org_id AND s.id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR (v_role = 'sales' AND v_shift.opened_by <> v_uid) THEN
    RAISE EXCEPTION 'Counter shift is unavailable for this account' USING ERRCODE = '42501';
  END IF;
  IF v_shift.status = 'CLOSED' THEN
    IF v_shift.closing_cash = p_closing_cash THEN RETURN to_jsonb(v_shift); END IF;
    RAISE EXCEPTION 'Counter shift is already closed with a different counted amount' USING ERRCODE = '23514';
  END IF;
  SELECT v_shift.opening_cash +
    COALESCE((SELECT sum(p.amount) FROM public.counter_shift_payments link
      JOIN public.payments p ON p.organization_id = link.organization_id AND p.id = link.payment_id
      WHERE link.organization_id = p_org_id AND link.shift_id = p_shift_id AND p.payment_method = 'CASH'), 0) +
    COALESCE((SELECT sum(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END)
      FROM public.counter_cash_movements m WHERE m.organization_id = p_org_id AND m.shift_id = p_shift_id), 0)
  INTO v_expected;
  UPDATE public.counter_shifts
  SET status = 'CLOSED', closed_by = v_uid, closed_at = now(), closing_cash = p_closing_cash,
    expected_cash = v_expected, variance = p_closing_cash - v_expected
  WHERE organization_id = p_org_id AND id = p_shift_id RETURNING * INTO v_shift;
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,details)
    VALUES (p_org_id,v_uid,'COUNTER_SHIFT_CLOSED','COUNTER_SHIFT',p_shift_id,
      jsonb_build_object('expected_cash',v_expected,'closing_cash',p_closing_cash,'variance',v_shift.variance));
  RETURN to_jsonb(v_shift);
END;
$$;

CREATE FUNCTION atlas_private.record_counter_cash_movement(
  p_org_id uuid, p_shift_id uuid, p_request_id uuid, p_direction text, p_amount numeric, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := public.get_user_org_role(p_org_id);
  v_shift public.counter_shifts%ROWTYPE;
  v_existing public.counter_cash_movements%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales')
     OR public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Counter cash cannot be recorded by this account' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_direction IS NULL OR p_direction NOT IN ('IN','OUT') OR
    p_amount IS NULL OR p_amount <= 0 OR p_amount > 9999999999.99 OR p_amount <> round(p_amount, 2)
    OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Enter a direction, positive cash amount in rupees and paise, and reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_shift FROM public.counter_shifts s WHERE s.organization_id = p_org_id AND s.id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR (v_role = 'sales' AND v_shift.opened_by <> v_uid) THEN
    RAISE EXCEPTION 'Counter shift is unavailable for this account' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM public.counter_cash_movements m
  WHERE m.organization_id = p_org_id AND m.shift_id = p_shift_id AND m.request_id = p_request_id;
  IF FOUND THEN
    IF (v_existing.recorded_by,v_existing.direction,v_existing.amount,v_existing.reason)
       IS DISTINCT FROM (v_uid,p_direction,p_amount,btrim(p_reason)) THEN
      RAISE EXCEPTION 'Cash movement request has different details' USING ERRCODE = '23505';
    END IF;
    RETURN;
  END IF;
  IF v_shift.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Open the counter shift before recording cash' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.counter_cash_movements(organization_id,shift_id,request_id,direction,amount,reason,recorded_by)
    VALUES (p_org_id,p_shift_id,p_request_id,p_direction,p_amount,btrim(p_reason),v_uid);
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.record_counter_cash_movement(uuid,uuid,uuid,text,numeric,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.record_counter_cash_movement(uuid,uuid,uuid,text,numeric,text) TO authenticated;
CREATE FUNCTION public.record_counter_cash_movement(
  p_org_id uuid, p_shift_id uuid, p_request_id uuid, p_direction text, p_amount numeric, p_reason text
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.record_counter_cash_movement(p_org_id,p_shift_id,p_request_id,p_direction,p_amount,p_reason);
$$;
REVOKE ALL ON FUNCTION public.record_counter_cash_movement(uuid,uuid,uuid,text,numeric,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_counter_cash_movement(uuid,uuid,uuid,text,numeric,text) TO authenticated;

CREATE FUNCTION atlas_private.complete_counter_checkout(
  p_org_id uuid, p_shift_id uuid, p_request_id uuid, p_customer_id uuid, p_items jsonb, p_tender text, p_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_shift public.counter_shifts%ROWTYPE;
  v_existing atlas_private.counter_checkout_requests%ROWTYPE;
  v_payload jsonb;
  v_result jsonb;
  v_order jsonb;
  v_invoice jsonb;
  v_payment jsonb;
  v_amount numeric;
  v_date date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_notes text;
BEGIN
  IF v_uid IS NULL OR public.user_has_org_role(p_org_id,'owner','admin') IS NOT TRUE
     OR public.can_read_organization_data(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Counter checkout is unavailable for this account' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_shift_id IS NULL OR p_customer_id IS NULL
     OR p_tender IS NULL OR p_tender NOT IN ('CASH','UPI') OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR char_length(COALESCE(p_notes,'')) > 1000 THEN
    RAISE EXCEPTION 'Invalid counter checkout details' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Counter checkout requires between 1 and 50 lines' USING ERRCODE = '22023';
  END IF;
  v_payload := jsonb_build_object('shift',p_shift_id,'customer',p_customer_id,'items',p_items,'tender',p_tender,'notes',p_notes);
  PERFORM pg_advisory_xact_lock(hashtext('counter_checkout:' || p_org_id::text), hashtext(p_request_id::text));
  SELECT * INTO v_existing FROM atlas_private.counter_checkout_requests r
    WHERE r.organization_id = p_org_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.actor_id <> v_uid OR v_existing.payload <> v_payload THEN
      RAISE EXCEPTION 'Counter checkout request has different details' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.result;
  END IF;
  IF public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Counter checkout requires an active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_shift FROM public.counter_shifts s WHERE s.organization_id = p_org_id AND s.id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Counter shift is unavailable' USING ERRCODE = '42501'; END IF;
  IF v_shift.status <> 'OPEN' THEN
    v_result := jsonb_build_object('state','REJECTED','message','The counter shift was closed before this sale completed.');
  ELSE
    v_notes := concat_ws(' · ', nullif(btrim(p_notes),''), 'Retail counter sale');
    -- A failed business validation rolls back the entire sale. Record its
    -- outcome so a replay can never turn a rejected sale into a second sale.
    BEGIN
      PERFORM 1 FROM public.customers c WHERE c.organization_id = p_org_id AND c.id = p_customer_id AND c.is_active FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active customer in this business' USING ERRCODE = '23514'; END IF;
      v_order := public.create_sales_order_atomic(p_org_id,p_customer_id,v_date,p_items,v_notes,NULL,gen_random_uuid());
      PERFORM public.confirm_sales_order((v_order->>'id')::uuid,p_org_id);
      v_invoice := public.create_invoice_atomic(p_org_id,p_customer_id,p_items,v_date,v_date,
        'ISSUED',v_notes,(v_order->>'id')::uuid,gen_random_uuid());
      v_amount := (v_invoice->>'total_amount')::numeric;
      v_payment := public.record_payment_and_allocate(p_org_id,p_customer_id,v_amount,p_tender,NULL,v_date,v_notes,
        (v_invoice->>'id')::uuid,v_amount,gen_random_uuid());
      INSERT INTO public.counter_shift_payments(organization_id,shift_id,payment_id,linked_by)
        VALUES (p_org_id,p_shift_id,(v_payment->>'payment_id')::uuid,v_uid);
      v_result := jsonb_build_object('state','COMPLETED','invoiceId',v_invoice->>'id','invoiceNumber',v_invoice->>'invoice_number',
        'receiptId',v_payment->>'payment_id','receiptNumber',v_payment->>'payment_number');
    EXCEPTION WHEN check_violation OR invalid_parameter_value OR raise_exception THEN
      v_result := jsonb_build_object('state','REJECTED','message',SQLERRM);
    END;
  END IF;
  INSERT INTO atlas_private.counter_checkout_requests(organization_id,shift_id,request_id,actor_id,payload,result)
    VALUES (p_org_id,p_shift_id,p_request_id,v_uid,v_payload,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.complete_counter_checkout(uuid,uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.complete_counter_checkout(uuid,uuid,uuid,uuid,jsonb,text,text) TO authenticated;
CREATE FUNCTION public.complete_counter_checkout(
  p_org_id uuid, p_shift_id uuid, p_request_id uuid, p_customer_id uuid, p_items jsonb, p_tender text, p_notes text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.complete_counter_checkout(p_org_id,p_shift_id,p_request_id,p_customer_id,p_items,p_tender,p_notes);
$$;
REVOKE ALL ON FUNCTION public.complete_counter_checkout(uuid,uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_counter_checkout(uuid,uuid,uuid,uuid,jsonb,text,text) TO authenticated;

COMMIT;
