ALTER TYPE public.business_category_type ADD VALUE IF NOT EXISTS 'ecommerce';

ALTER TABLE public.sales_orders
  ADD COLUMN online_channel text,
  ADD COLUMN online_reference text,
  ADD CONSTRAINT sales_orders_online_reference_check CHECK (
    (online_channel IS NULL AND online_reference IS NULL) OR
    (
      online_channel IS NOT NULL AND online_reference IS NOT NULL
      AND online_channel IN ('storefront', 'marketplace', 'social', 'other')
      AND online_reference = btrim(online_reference)
      AND char_length(online_reference) BETWEEN 1 AND 100
    )
  );

CREATE UNIQUE INDEX sales_orders_online_reference_key
  ON public.sales_orders (organization_id, online_channel, lower(online_reference))
  WHERE online_channel IS NOT NULL;

-- Attach the channel and reference in the same transaction as the authoritative
-- order creation. An external reference conflict rolls back the entire draft.
CREATE FUNCTION public.create_online_sales_order(
  p_org_id uuid, p_customer_id uuid, p_order_date date, p_items jsonb, p_notes text,
  p_idempotency_key uuid, p_channel text, p_reference text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_reference text := btrim(p_reference);
  v_order jsonb;
  v_saved public.sales_orders%ROWTYPE;
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('storefront', 'marketplace', 'social', 'other')
     OR v_reference IS NULL OR char_length(v_reference) NOT BETWEEN 1 AND 100
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Provide a sales channel, an order reference and a request key' USING ERRCODE = '22023';
  END IF;

  v_order := public.create_sales_order_atomic(
    p_org_id, p_customer_id, p_order_date, p_items, p_notes, NULL, p_idempotency_key
  );

  IF COALESCE((v_order->>'idempotent_replay')::boolean, false) THEN
    SELECT * INTO v_saved FROM public.sales_orders
     WHERE organization_id = p_org_id AND id = (v_order->>'id')::uuid;
    IF NOT FOUND OR v_saved.online_channel IS DISTINCT FROM p_channel
       OR lower(v_saved.online_reference) IS DISTINCT FROM lower(v_reference)
       OR COALESCE(v_saved.notes, '') <> COALESCE(p_notes, '') THEN
      RAISE EXCEPTION 'This order request key was used with different details' USING ERRCODE = '22023';
    END IF;
  ELSE
    UPDATE public.sales_orders SET online_channel = p_channel, online_reference = v_reference
     WHERE organization_id = p_org_id AND id = (v_order->>'id')::uuid
     RETURNING * INTO v_saved;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unable to save the online order reference' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN v_order || jsonb_build_object(
    'online_channel', v_saved.online_channel, 'online_reference', v_saved.online_reference
  );
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'An order with this sales channel and reference already exists' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.create_online_sales_order(uuid,uuid,date,jsonb,text,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_online_sales_order(uuid,uuid,date,jsonb,text,uuid,text,text) TO authenticated;

-- Return only workspace and trial fields needed for platform operations.
-- Platform reviewers never receive customer, payment, or identity records here.
CREATE FUNCTION atlas_private.platform_workspace_page(p_filter text, p_search text, p_offset integer)
RETURNS TABLE (
  id uuid, name varchar, created_at timestamptz, business_category text, eligibility_status text,
  declaration_updated_at timestamptz, product_lines text[], identity_present boolean, sells_electrical boolean,
  plan_tier varchar, subscription_status text, access_expires_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_reviewer(auth.uid()) THEN
    RAISE EXCEPTION 'Platform reviewer access is required' USING ERRCODE = '42501';
  END IF;
  IF p_filter IS NULL OR p_filter NOT IN ('all', 'review_required', 'pending', 'approved', 'rejected', 'undeclared')
     OR p_offset IS NULL OR p_offset < 0 OR char_length(COALESCE(p_search, '')) > 150 THEN
    RAISE EXCEPTION 'Invalid workspace search' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.created_at, e.business_category::text,
      COALESCE(e.status::text, 'undeclared'), e.updated_at, e.product_lines,
      (o.pan IS NOT NULL OR o.gstin IS NOT NULL), e.sells_electrical_products,
      s.plan_tier, s.status::text, CASE s.status::text
        WHEN 'trialing' THEN s.trial_ends_at WHEN 'past_due' THEN s.grace_period_ends_at ELSE s.current_period_ends_at END
    FROM public.organizations o
    LEFT JOIN public.organization_eligibility e ON e.organization_id = o.id
    LEFT JOIN public.organization_subscriptions s ON s.organization_id = o.id
    WHERE (p_filter = 'all' OR COALESCE(e.status::text, 'undeclared') = p_filter)
      AND (COALESCE(p_search, '') = '' OR strpos(lower(o.name), lower(p_search)) > 0)
    ORDER BY o.created_at DESC, o.id
    LIMIT 26 OFFSET p_offset;
END;
$$;

CREATE FUNCTION public.platform_workspace_page(p_filter text, p_search text, p_offset integer)
RETURNS TABLE (
  id uuid, name varchar, created_at timestamptz, business_category text, eligibility_status text,
  declaration_updated_at timestamptz, product_lines text[], identity_present boolean, sells_electrical boolean,
  plan_tier varchar, subscription_status text, access_expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT * FROM atlas_private.platform_workspace_page(p_filter, p_search, p_offset) $$;

CREATE FUNCTION atlas_private.platform_review_workspace(
  p_org_id uuid, p_expected_updated_at timestamptz, p_decision public.eligibility_status_type, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_updated timestamptz;
  v_status public.eligibility_status_type;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_reviewer(auth.uid()) THEN
    RAISE EXCEPTION 'Platform reviewer access is required' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected')
     OR char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A decision and a reason of 1 to 500 characters are required' USING ERRCODE = '22023';
  END IF;
  SELECT updated_at, status INTO v_updated, v_status FROM public.organization_eligibility
    WHERE organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND OR v_updated IS DISTINCT FROM p_expected_updated_at
     OR v_status NOT IN ('pending', 'review_required') THEN
    RAISE EXCEPTION 'The declaration changed. Refresh the queue and review it again' USING ERRCODE = '40001';
  END IF;
  RETURN public.review_organization_eligibility(
    p_org_id, p_decision, CASE WHEN p_decision = 'rejected' THEN btrim(p_reason) END, btrim(p_reason)
  );
END;
$$;

CREATE FUNCTION public.platform_review_workspace(
  p_org_id uuid, p_expected_updated_at timestamptz, p_decision public.eligibility_status_type, p_reason text
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT atlas_private.platform_review_workspace(p_org_id, p_expected_updated_at, p_decision, p_reason) $$;

GRANT USAGE ON SCHEMA atlas_private TO authenticated;
REVOKE ALL ON FUNCTION atlas_private.platform_workspace_page(text,text,integer),
  public.platform_workspace_page(text,text,integer),
  atlas_private.platform_review_workspace(uuid,timestamptz,public.eligibility_status_type,text),
  public.platform_review_workspace(uuid,timestamptz,public.eligibility_status_type,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atlas_private.platform_workspace_page(text,text,integer),
  public.platform_workspace_page(text,text,integer),
  atlas_private.platform_review_workspace(uuid,timestamptz,public.eligibility_status_type,text),
  public.platform_review_workspace(uuid,timestamptz,public.eligibility_status_type,text) TO authenticated;

ALTER TABLE public.sales_orders
  ADD COLUMN dispatch_carrier text,
  ADD COLUMN dispatch_tracking text,
  ADD COLUMN dispatched_at timestamptz,
  ADD CONSTRAINT sales_orders_dispatch_check CHECK (
    (dispatch_carrier IS NULL AND dispatch_tracking IS NULL AND dispatched_at IS NULL)
    OR (
      online_channel IS NOT NULL AND status IN ('CONFIRMED', 'FULFILLED')
      AND dispatch_carrier IS NOT NULL AND char_length(btrim(dispatch_carrier)) BETWEEN 1 AND 80
      AND dispatch_tracking IS NOT NULL AND char_length(btrim(dispatch_tracking)) BETWEEN 1 AND 100
      AND dispatched_at IS NOT NULL
    )
  );

CREATE FUNCTION atlas_private.record_online_dispatch(
  p_org_id uuid, p_order_id uuid, p_carrier text, p_tracking text, p_expected_dispatch timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_order public.sales_orders%ROWTYPE;
  v_carrier text := btrim(p_carrier);
  v_tracking text := btrim(p_tracking);
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_org_role(p_org_id, 'owner', 'admin', 'sales')
     OR NOT public.can_write_organization_operations(p_org_id) THEN
    RAISE EXCEPTION 'Permission to manage online dispatch is required' USING ERRCODE = '42501';
  END IF;
  IF v_carrier IS NULL OR char_length(v_carrier) NOT BETWEEN 1 AND 80
     OR v_tracking IS NULL OR char_length(v_tracking) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Enter a carrier and tracking reference' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.sales_orders
   WHERE organization_id = p_org_id AND id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.online_channel IS NULL OR v_order.status NOT IN ('CONFIRMED', 'FULFILLED') THEN
    RAISE EXCEPTION 'Dispatch requires a confirmed online order' USING ERRCODE = '22023';
  END IF;
  IF v_carrier IS DISTINCT FROM v_order.dispatch_carrier OR v_tracking IS DISTINCT FROM v_order.dispatch_tracking THEN
    IF v_order.dispatched_at IS DISTINCT FROM p_expected_dispatch THEN
      RAISE EXCEPTION 'Dispatch details changed. Reopen the order and review the latest details' USING ERRCODE = '40001';
    END IF;
    UPDATE public.sales_orders
       SET dispatch_carrier = v_carrier, dispatch_tracking = v_tracking, dispatched_at = v_now
     WHERE organization_id = p_org_id AND id = p_order_id
     RETURNING * INTO v_order;
    INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    VALUES (p_org_id, auth.uid(), 'ONLINE_ORDER_DISPATCH_RECORDED', 'SALES_ORDER', p_order_id,
      jsonb_build_object('carrier', v_carrier, 'correction', p_expected_dispatch IS NOT NULL));
  END IF;
  RETURN jsonb_build_object('carrier', v_order.dispatch_carrier, 'tracking', v_order.dispatch_tracking, 'recordedAt', v_order.dispatched_at);
END;
$$;

CREATE FUNCTION public.record_online_dispatch(
  p_org_id uuid, p_order_id uuid, p_carrier text, p_tracking text, p_expected_dispatch timestamptz
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT atlas_private.record_online_dispatch(p_org_id, p_order_id, p_carrier, p_tracking, p_expected_dispatch) $$;

REVOKE ALL ON FUNCTION atlas_private.record_online_dispatch(uuid,uuid,text,text,timestamptz),
  public.record_online_dispatch(uuid,uuid,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atlas_private.record_online_dispatch(uuid,uuid,text,text,timestamptz),
  public.record_online_dispatch(uuid,uuid,text,text,timestamptz) TO authenticated;
