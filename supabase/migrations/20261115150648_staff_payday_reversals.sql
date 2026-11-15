BEGIN;

-- Reversal metadata preserves the original payment amounts and every recovery row.
ALTER TABLE public.staff_paydays
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversed_by uuid,
  ADD COLUMN reversal_reason text,
  ADD COLUMN reversal_id uuid,
  ADD CONSTRAINT staff_payday_reversal_details CHECK (
    (reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL AND reversal_id IS NULL)
    OR
    (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL AND reversal_id IS NOT NULL
      AND char_length(reversal_reason) BETWEEN 1 AND 300 AND reversal_reason=btrim(reversal_reason))
  ),
  DROP CONSTRAINT staff_paydays_organization_id_staff_id_period_key;

CREATE UNIQUE INDEX staff_paydays_active_period
  ON public.staff_paydays (organization_id,staff_id,period) WHERE reversed_at IS NULL;
CREATE UNIQUE INDEX staff_paydays_reversal_request
  ON public.staff_paydays (organization_id,staff_id,reversal_id) WHERE reversal_id IS NOT NULL;
CREATE INDEX staff_paydays_history
  ON public.staff_paydays (organization_id,staff_id,period DESC,recorded_at DESC,id);

CREATE OR REPLACE VIEW public.staff_advance_balances WITH (security_invoker=true) AS
SELECT a.*, a.amount_paise - applied.paid_paise AS balance_paise, applied.paid_paise
FROM public.staff_advances a
CROSS JOIN LATERAL (
  SELECT coalesce(sum(r.amount_paise),0)::bigint AS paid_paise
  FROM public.staff_advance_recoveries r
  LEFT JOIN public.staff_paydays p
    ON (p.organization_id,p.staff_id,p.id)=(r.organization_id,r.staff_id,r.payday_id)
  WHERE (r.organization_id,r.staff_id,r.advance_id)=(a.organization_id,a.staff_id,a.id)
    AND p.reversed_at IS NULL
) applied;

CREATE VIEW public.staff_advance_recovery_history WITH (security_invoker=true) AS
SELECT r.*, p.reversed_at AS payday_reversed_at
FROM public.staff_advance_recoveries r
LEFT JOIN public.staff_paydays p
  ON (p.organization_id,p.staff_id,p.id)=(r.organization_id,r.staff_id,r.payday_id);
REVOKE ALL ON public.staff_advance_recovery_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.staff_advance_recovery_history TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_staff_payday(p_org_id uuid,p_staff_id uuid,p_period date)
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
    SELECT p.period INTO latest FROM public.staff_paydays p
    WHERE (p.organization_id,p.staff_id)=(p_org_id,p_staff_id) AND p.reversed_at IS NULL
    ORDER BY p.period DESC LIMIT 1;
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

CREATE OR REPLACE FUNCTION atlas_private.post_staff_payday(
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
    IF existing.reversed_at IS NOT NULL THEN
      RAISE EXCEPTION 'This payday has been reversed. Review a corrected payday before posting again.' USING ERRCODE='23505';
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

CREATE FUNCTION atlas_private.reverse_staff_payday(
  p_org_id uuid,p_staff_id uuid,p_payday_id uuid,p_id uuid,p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid:=auth.uid();
  payday public.staff_paydays%ROWTYPE;
BEGIN
  PERFORM atlas_private.lock_staff_pay_account(p_org_id,p_staff_id);
  IF p_id IS NULL OR p_payday_id IS NULL OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'Enter a reason for reversing this payday' USING ERRCODE='22023';
  END IF;
  SELECT * INTO payday FROM public.staff_paydays p
    WHERE (p.organization_id,p.staff_id,p.id)=(p_org_id,p_staff_id,p_payday_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payday is unavailable for this staff member' USING ERRCODE='42501';
  END IF;
  IF payday.reversed_at IS NOT NULL THEN
    IF (payday.reversal_id,payday.reversed_by,payday.reversal_reason) IS DISTINCT FROM (p_id,actor,btrim(p_reason)) THEN
      RAISE EXCEPTION 'This payday has already been reversed' USING ERRCODE='23505';
    END IF;
    RETURN p_payday_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_paydays p
    WHERE (p.organization_id,p.staff_id)=(p_org_id,p_staff_id) AND p.reversed_at IS NULL AND p.period>payday.period) THEN
    RAISE EXCEPTION 'Reverse the latest posted payday first' USING ERRCODE='23514';
  END IF;
  UPDATE public.staff_paydays SET reversed_at=clock_timestamp(),reversed_by=actor,reversal_reason=btrim(p_reason),reversal_id=p_id
    WHERE (organization_id,staff_id,id)=(p_org_id,p_staff_id,p_payday_id);
  RETURN p_payday_id;
END;
$$;

CREATE FUNCTION public.reverse_staff_payday(
  p_org_id uuid,p_staff_id uuid,p_payday_id uuid,p_id uuid,p_reason text
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT atlas_private.reverse_staff_payday(p_org_id,p_staff_id,p_payday_id,p_id,p_reason);
$$;
REVOKE ALL ON FUNCTION atlas_private.reverse_staff_payday(uuid,uuid,uuid,uuid,text),
  public.reverse_staff_payday(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.reverse_staff_payday(uuid,uuid,uuid,uuid,text),
  public.reverse_staff_payday(uuid,uuid,uuid,uuid,text) TO authenticated;

COMMIT;
