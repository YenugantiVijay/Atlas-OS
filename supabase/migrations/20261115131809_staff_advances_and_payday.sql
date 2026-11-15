BEGIN;

CREATE TABLE public.staff_advances (
  organization_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  id uuid NOT NULL,
  issued_on date NOT NULL CHECK (isfinite(issued_on)),
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 99999999999),
  first_month date CHECK (isfinite(first_month) AND extract(day FROM first_month)=1),
  installment_paise bigint NOT NULL CHECK (installment_paise BETWEEN 0 AND amount_paise),
  method text NOT NULL CHECK (method IN ('cash','upi','bank')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 300 AND note=btrim(note)),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,staff_id,id),
  FOREIGN KEY (organization_id,staff_id) REFERENCES public.staff_profiles(organization_id,id),
  CHECK ((first_month IS NULL) = (installment_paise=0))
);

CREATE TABLE public.staff_paydays (
  organization_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  id uuid NOT NULL,
  period date NOT NULL CHECK (isfinite(period) AND extract(day FROM period)=1),
  gross_paise bigint NOT NULL CHECK (gross_paise BETWEEN 1 AND 99999999999),
  wage_basis_paise bigint NOT NULL CHECK (wage_basis_paise BETWEEN 0 AND gross_paise),
  other_deductions_paise bigint NOT NULL CHECK (other_deductions_paise BETWEEN 0 AND wage_basis_paise/2),
  advance_deductions_paise bigint NOT NULL CHECK (advance_deductions_paise BETWEEN 0 AND wage_basis_paise/2-other_deductions_paise),
  net_paise bigint GENERATED ALWAYS AS (gross_paise-other_deductions_paise-advance_deductions_paise) STORED,
  method text NOT NULL CHECK (method IN ('cash','upi','bank')),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  request jsonb NOT NULL,
  PRIMARY KEY (organization_id,staff_id,id),
  UNIQUE (organization_id,staff_id,period),
  FOREIGN KEY (organization_id,staff_id) REFERENCES public.staff_profiles(organization_id,id)
);

CREATE TABLE public.staff_advance_recoveries (
  organization_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  id uuid NOT NULL,
  advance_id uuid NOT NULL,
  payday_id uuid,
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 99999999999),
  received_on date NOT NULL CHECK (isfinite(received_on)),
  method text CHECK (method IN ('cash','upi','bank')),
  note text CHECK (char_length(note) BETWEEN 1 AND 300 AND note=btrim(note)),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,staff_id,id),
  UNIQUE (organization_id,staff_id,payday_id,advance_id),
  FOREIGN KEY (organization_id,staff_id,advance_id) REFERENCES public.staff_advances(organization_id,staff_id,id),
  FOREIGN KEY (organization_id,staff_id,payday_id) REFERENCES public.staff_paydays(organization_id,staff_id,id),
  CHECK ((payday_id IS NULL AND method IS NOT NULL AND note IS NOT NULL)
      OR (payday_id IS NOT NULL AND method IS NULL AND note IS NULL))
);
CREATE INDEX staff_recovery_by_advance ON public.staff_advance_recoveries (organization_id,staff_id,advance_id);

DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['staff_advances','staff_advance_recoveries','staff_paydays']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',tab);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
    EXECUTE format('CREATE POLICY pay_register_read ON public.%I FOR SELECT TO authenticated
      USING (public.can_read_organization_data(organization_id)
         AND public.user_has_org_role(organization_id,''owner'',''admin''))',tab);
  END LOOP;
END;
$$;

CREATE VIEW public.staff_advance_balances WITH (security_invoker=true) AS
SELECT a.*, a.amount_paise - applied.paid_paise AS balance_paise, applied.paid_paise
FROM public.staff_advances a
CROSS JOIN LATERAL (
  SELECT coalesce(sum(r.amount_paise),0)::bigint AS paid_paise
  FROM public.staff_advance_recoveries r
  WHERE (r.organization_id,r.staff_id,r.advance_id)=(a.organization_id,a.staff_id,a.id)
) applied;
REVOKE ALL ON public.staff_advance_balances FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.staff_advance_balances TO authenticated;

-- The staff row is the shared lock for raising, repaying and settling advances.
CREATE FUNCTION atlas_private.lock_staff_pay_account(p_org_id uuid,p_staff_id uuid)
RETURNS date LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE join_date date;
BEGIN
  IF auth.uid() IS NULL OR public.user_has_org_role(p_org_id,'owner','admin') IS NOT TRUE
     OR public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Staff pay is unavailable for this account' USING ERRCODE='42501';
  END IF;
  SELECT joining_on INTO join_date FROM public.staff_profiles s
    WHERE (s.organization_id,s.id)=(p_org_id,p_staff_id) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member is unavailable in this workspace' USING ERRCODE='42501';
  END IF;
  RETURN join_date;
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.lock_staff_pay_account(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION atlas_private.record_staff_advance(
  p_org_id uuid,p_staff_id uuid,p_id uuid,p_issued_on date,p_amount bigint,p_first_month date,
  p_installment bigint,p_method text,p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  join_date date;
  earliest date;
  existing public.staff_advances%ROWTYPE;
  actor uuid := auth.uid();
BEGIN
  join_date:=atlas_private.lock_staff_pay_account(p_org_id,p_staff_id);
  IF p_id IS NULL OR p_issued_on IS NULL OR NOT isfinite(p_issued_on)
    OR p_issued_on > (now() AT TIME ZONE 'Asia/Kolkata')::date
    OR p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 99999999999
    OR p_installment IS NULL OR p_installment NOT BETWEEN 0 AND p_amount
    OR (p_first_month IS NULL)<>(p_installment=0)
    OR p_method IS NULL OR p_method NOT IN ('cash','upi','bank')
    OR p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'Enter a past or current date, a valid advance, and payment details' USING ERRCODE='22023';
  END IF;
  earliest:=date_trunc('month',greatest(p_issued_on,join_date)::timestamp)::date;
  IF p_issued_on<join_date AND extract(day FROM join_date)<>1 THEN
    earliest:=(earliest + interval '1 month')::date;
  END IF;
  IF p_first_month IS NOT NULL AND
    (NOT isfinite(p_first_month) OR extract(day FROM p_first_month)<>1 OR p_first_month<earliest) THEN
    RAISE EXCEPTION 'Choose a valid first deduction month, starting with the first complete month for a pre-joining advance' USING ERRCODE='22023';
  END IF;
  SELECT * INTO existing FROM public.staff_advances a
    WHERE (a.organization_id,a.staff_id,a.id)=(p_org_id,p_staff_id,p_id);
  IF FOUND THEN
    IF (existing.issued_on,existing.amount_paise,existing.first_month,existing.installment_paise,existing.method,existing.note,existing.recorded_by)
     IS DISTINCT FROM (p_issued_on,p_amount,p_first_month,p_installment,p_method,btrim(p_note),actor) THEN
      RAISE EXCEPTION 'Advance request already has different details' USING ERRCODE='23505';
    END IF;
    RETURN p_id;
  END IF;
  INSERT INTO public.staff_advances(organization_id,staff_id,id,issued_on,amount_paise,first_month,installment_paise,method,note,recorded_by)
    VALUES(p_org_id,p_staff_id,p_id,p_issued_on,p_amount,p_first_month,p_installment,p_method,btrim(p_note),actor);
  RETURN p_id;
END;
$$;

CREATE FUNCTION atlas_private.record_staff_advance_repayment(
  p_org_id uuid,p_staff_id uuid,p_advance_id uuid,p_id uuid,p_received_on date,p_amount bigint,p_method text,p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  issue_date date;
  balance bigint;
  existing public.staff_advance_recoveries%ROWTYPE;
  actor uuid:=auth.uid();
BEGIN
  PERFORM atlas_private.lock_staff_pay_account(p_org_id,p_staff_id);
  SELECT issued_on,balance_paise INTO issue_date,balance FROM public.staff_advance_balances a
    WHERE (a.organization_id,a.staff_id,a.id)=(p_org_id,p_staff_id,p_advance_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advance is unavailable for this staff member' USING ERRCODE='42501';
  END IF;
  IF p_id IS NULL OR p_received_on IS NULL OR NOT isfinite(p_received_on)
    OR p_received_on NOT BETWEEN issue_date AND (now() AT TIME ZONE 'Asia/Kolkata')::date
    OR p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 99999999999
    OR p_method IS NULL OR p_method NOT IN ('cash','upi','bank')
    OR p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'Enter a valid repayment date, amount and payment details' USING ERRCODE='22023';
  END IF;
  SELECT * INTO existing FROM public.staff_advance_recoveries r
    WHERE (r.organization_id,r.staff_id,r.id)=(p_org_id,p_staff_id,p_id);
  IF FOUND THEN
    IF existing.payday_id IS NOT NULL
      OR (existing.advance_id,existing.received_on,existing.amount_paise,existing.method,existing.note,existing.recorded_by)
      IS DISTINCT FROM (p_advance_id,p_received_on,p_amount,p_method,btrim(p_note),actor) THEN
      RAISE EXCEPTION 'Repayment request already has different details' USING ERRCODE='23505';
    END IF;
    RETURN p_id;
  END IF;
  IF p_amount>balance THEN
    RAISE EXCEPTION 'Repayment exceeds the outstanding advance' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.staff_advance_recoveries(organization_id,staff_id,id,advance_id,received_on,amount_paise,method,note,recorded_by)
    VALUES(p_org_id,p_staff_id,p_id,p_advance_id,p_received_on,p_amount,p_method,btrim(p_note),actor);
  RETURN p_id;
END;
$$;

CREATE FUNCTION public.preview_staff_payday(p_org_id uuid,p_staff_id uuid,p_period date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  join_date date;
  lines jsonb;
  latest date;
  current_rate jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.can_read_organization_data(p_org_id) IS NOT TRUE
     OR public.user_has_org_role(p_org_id,'owner','admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Staff pay is unavailable for this account' USING ERRCODE='42501';
  END IF;
  SELECT joining_on INTO join_date FROM public.staff_profiles s WHERE (s.organization_id,s.id)=(p_org_id,p_staff_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member is unavailable in this workspace' USING ERRCODE='42501';
  END IF;
  IF p_period IS NULL OR NOT isfinite(p_period) OR extract(day FROM p_period)<>1
    OR p_period > (now() AT TIME ZONE 'Asia/Kolkata')::date
    OR join_date > (now() AT TIME ZONE 'Asia/Kolkata')::date
    OR (p_period+interval '1 month')::date<=join_date THEN
    RAISE EXCEPTION 'Select a current or past wage month on or after the joining month' USING ERRCODE='22023';
  END IF;
  SELECT max(p.period) INTO latest FROM public.staff_paydays p WHERE (p.organization_id,p.staff_id)=(p_org_id,p_staff_id);
  SELECT jsonb_build_object('basis',r.basis,'amount_paise',r.amount_paise,'effective_on',r.effective_on,'revision',r.revision)
    INTO current_rate FROM public.staff_pay_rate_history r
    WHERE (r.organization_id,r.staff_id)=(p_org_id,p_staff_id) AND r.is_latest AND r.effective_on<=greatest(p_period,join_date)
    ORDER BY r.effective_on DESC LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'note',a.note,'balance_paise',a.balance_paise,
    'scheduled_paise',least(a.installment_paise,d.due),'catchup_paise',d.due) ORDER BY a.issued_on,a.id),'[]'::jsonb)
    INTO lines FROM public.staff_advance_balances a
    CROSS JOIN LATERAL (SELECT greatest(0,least(a.amount_paise,a.installment_paise*(
      (extract(year FROM p_period)::integer-extract(year FROM a.first_month)::integer)*12+
      extract(month FROM p_period)::integer-extract(month FROM a.first_month)::integer+1
    ))-a.paid_paise) AS due) d
    WHERE (a.organization_id,a.staff_id)=(p_org_id,p_staff_id)
      AND a.first_month<=p_period AND a.balance_paise>0 AND d.due>0;
  RETURN jsonb_build_object('lines',lines,'latest_period',latest,'rate',current_rate,
    'snapshot',md5(jsonb_build_array(p_period,latest,current_rate,lines)::text));
END;
$$;
REVOKE ALL ON FUNCTION public.preview_staff_payday(uuid,uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_staff_payday(uuid,uuid,date) TO authenticated;

CREATE FUNCTION atlas_private.post_staff_payday(
  p_org_id uuid,p_staff_id uuid,p_id uuid,p_period date,p_gross bigint,p_wage_basis bigint,p_other bigint,
  p_limit bigint,p_method text,p_snapshot text,p_deductions jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid:=auth.uid();
  today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;
  existing public.staff_paydays%ROWTYPE;
  preview jsonb;
  request_details jsonb;
  deduction jsonb;
  advance uuid;
  amount bigint;
  due bigint;
  total bigint:=0;
  seen uuid[]:='{}';
BEGIN
  PERFORM atlas_private.lock_staff_pay_account(p_org_id,p_staff_id);
  IF p_id IS NULL OR p_snapshot IS NULL OR jsonb_typeof(p_deductions) IS DISTINCT FROM 'array'
    OR p_gross IS NULL OR p_gross NOT BETWEEN 1 AND 99999999999
    OR p_wage_basis IS NULL OR p_wage_basis NOT BETWEEN 0 AND p_gross
    OR p_other IS NULL OR p_other NOT BETWEEN 0 AND p_wage_basis/2
    OR (p_limit IS NOT NULL AND p_limit NOT BETWEEN 0 AND 99999999999)
    OR p_method IS NULL OR p_method NOT IN ('cash','upi','bank') THEN
    RAISE EXCEPTION 'Enter valid pay amounts, deductions, and payment method' USING ERRCODE='22023';
  END IF;
  request_details:=jsonb_build_array(p_period,p_gross,p_wage_basis,p_other,p_limit,p_method,p_snapshot,p_deductions);
  SELECT * INTO existing FROM public.staff_paydays p WHERE (p.organization_id,p.staff_id,p.id)=(p_org_id,p_staff_id,p_id);
  IF FOUND THEN
    IF existing.recorded_by<>actor OR existing.request<>request_details THEN
      RAISE EXCEPTION 'Payday request already has different details' USING ERRCODE='23505';
    END IF;
    RETURN p_id;
  END IF;
  preview:=public.preview_staff_payday(p_org_id,p_staff_id,p_period);
  IF (preview->>'latest_period')::date>=p_period THEN
    RAISE EXCEPTION 'This or a later wage month has already been posted' USING ERRCODE='23505';
  END IF;
  IF preview->>'snapshot'<>p_snapshot THEN
    RAISE EXCEPTION 'Pay or advance balances changed. Preview this payday again.' USING ERRCODE='40001';
  END IF;
  IF jsonb_array_length(p_deductions)>jsonb_array_length(preview->'lines') THEN
    RAISE EXCEPTION 'Choose each advance only once' USING ERRCODE='22023';
  END IF;
  FOR deduction IN SELECT value FROM jsonb_array_elements(p_deductions)
  LOOP
    advance:=(deduction->>'id')::uuid;
    amount:=(deduction->>'amount_paise')::bigint;
    SELECT (value->>'catchup_paise')::bigint INTO due FROM jsonb_array_elements(preview->'lines')
      WHERE value->>'id'=advance::text;
    IF advance IS NULL OR advance=ANY(seen) OR amount IS NULL OR due IS NULL OR amount NOT BETWEEN 1 AND due THEN
      RAISE EXCEPTION 'A deduction exceeds the amount due or repeats an advance' USING ERRCODE='23514';
    END IF;
    seen:=array_append(seen,advance);
    total:=total+amount;
  END LOOP;
  IF total>least(coalesce(p_limit,p_gross),p_wage_basis/2-p_other) THEN
    RAISE EXCEPTION 'Advance deductions exceed the available deduction limit for this wage month' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.staff_paydays(organization_id,staff_id,id,period,gross_paise,wage_basis_paise,
    other_deductions_paise,advance_deductions_paise,method,recorded_by,request)
    VALUES(p_org_id,p_staff_id,p_id,p_period,p_gross,p_wage_basis,p_other,total,p_method,actor,request_details);
  INSERT INTO public.staff_advance_recoveries(organization_id,staff_id,id,advance_id,payday_id,amount_paise,received_on,recorded_by)
    SELECT p_org_id,p_staff_id,gen_random_uuid(),(value->>'id')::uuid,p_id,(value->>'amount_paise')::bigint,today,actor
      FROM jsonb_array_elements(p_deductions);
  RETURN p_id;
END;
$$;

CREATE FUNCTION public.record_staff_advance(
  p_org_id uuid,p_staff_id uuid,p_id uuid,p_issued_on date,p_amount bigint,p_first_month date,
  p_installment bigint,p_method text,p_note text
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT atlas_private.record_staff_advance(p_org_id,p_staff_id,p_id,p_issued_on,p_amount,p_first_month,p_installment,p_method,p_note);
$$;
CREATE FUNCTION public.record_staff_advance_repayment(
  p_org_id uuid,p_staff_id uuid,p_advance_id uuid,p_id uuid,p_received_on date,p_amount bigint,p_method text,p_note text
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT atlas_private.record_staff_advance_repayment(p_org_id,p_staff_id,p_advance_id,p_id,p_received_on,p_amount,p_method,p_note);
$$;
CREATE FUNCTION public.post_staff_payday(
  p_org_id uuid,p_staff_id uuid,p_id uuid,p_period date,p_gross bigint,p_wage_basis bigint,p_other bigint,
  p_limit bigint,p_method text,p_snapshot text,p_deductions jsonb
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT atlas_private.post_staff_payday(p_org_id,p_staff_id,p_id,p_period,p_gross,p_wage_basis,p_other,p_limit,p_method,p_snapshot,p_deductions);
$$;
REVOKE ALL ON FUNCTION atlas_private.record_staff_advance(uuid,uuid,uuid,date,bigint,date,bigint,text,text), public.record_staff_advance(uuid,uuid,uuid,date,bigint,date,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.record_staff_advance(uuid,uuid,uuid,date,bigint,date,bigint,text,text), public.record_staff_advance(uuid,uuid,uuid,date,bigint,date,bigint,text,text) TO authenticated;
REVOKE ALL ON FUNCTION atlas_private.record_staff_advance_repayment(uuid,uuid,uuid,uuid,date,bigint,text,text), public.record_staff_advance_repayment(uuid,uuid,uuid,uuid,date,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.record_staff_advance_repayment(uuid,uuid,uuid,uuid,date,bigint,text,text), public.record_staff_advance_repayment(uuid,uuid,uuid,uuid,date,bigint,text,text) TO authenticated;
REVOKE ALL ON FUNCTION atlas_private.post_staff_payday(uuid,uuid,uuid,date,bigint,bigint,bigint,bigint,text,text,jsonb), public.post_staff_payday(uuid,uuid,uuid,date,bigint,bigint,bigint,bigint,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.post_staff_payday(uuid,uuid,uuid,date,bigint,bigint,bigint,bigint,text,text,jsonb), public.post_staff_payday(uuid,uuid,uuid,date,bigint,bigint,bigint,bigint,text,text,jsonb) TO authenticated;

COMMIT;
