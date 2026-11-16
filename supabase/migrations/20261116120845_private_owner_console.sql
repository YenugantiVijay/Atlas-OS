-- Owner access is separate from workspace membership and platform review privileges.
CREATE TABLE atlas_private.owner_console_accounts (
  slot smallint PRIMARY KEY CHECK (slot BETWEEN 1 AND 3),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atlas_private.owner_console_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE atlas_private.client_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('website', 'erp')),
  contact_email text,
  company text,
  area text NOT NULL CHECK (area IN ('general','orders','inventory','billing','payments','account','website')),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 120),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  client_update text CHECK (char_length(client_update) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE atlas_private.client_support_tickets ENABLE ROW LEVEL SECURITY;
CREATE INDEX client_support_queue_idx ON atlas_private.client_support_tickets (status, updated_at DESC, id);
CREATE INDEX client_support_author_idx ON atlas_private.client_support_tickets (organization_id, author_id, created_at DESC);

CREATE TABLE atlas_private.atlas_plan_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  product text NOT NULL CHECK (product IN ('starter','professional','enterprise_network')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'::numeric),
  paid_on date NOT NULL,
  payment_reference text NOT NULL CHECK (char_length(btrim(payment_reference)) BETWEEN 3 AND 100),
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atlas_private.atlas_plan_purchases ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX atlas_plan_purchase_reference_key ON atlas_private.atlas_plan_purchases (lower(payment_reference));
CREATE INDEX atlas_plan_purchases_paid_idx ON atlas_private.atlas_plan_purchases (paid_on, product);
CREATE INDEX atlas_plan_purchases_org_idx ON atlas_private.atlas_plan_purchases (organization_id);

CREATE TABLE atlas_private.owner_console_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_id uuid NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atlas_private.owner_console_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX owner_console_ai_requests_idx ON atlas_private.owner_console_events (actor_id,created_at DESC) WHERE action='ai_input';

REVOKE ALL ON atlas_private.owner_console_accounts, atlas_private.client_support_tickets,
  atlas_private.atlas_plan_purchases, atlas_private.owner_console_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON atlas_private.owner_console_accounts TO service_role;
GRANT USAGE ON SCHEMA atlas_private TO service_role;

CREATE FUNCTION atlas_private.owner_console_gate()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM atlas_private.owner_console_accounts a WHERE a.user_id = auth.uid()
) $$;

CREATE FUNCTION public.owner_console_gate()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT atlas_private.owner_console_gate() $$;

CREATE FUNCTION atlas_private.report_client_problem(
  p_org uuid, p_area text, p_subject text, p_body text, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid := COALESCE(p_request_id,gen_random_uuid());
BEGIN
  IF v_actor IS NULL OR NOT public.user_is_org_member(p_org) THEN
    RAISE EXCEPTION 'Workspace membership required' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('support:' || v_actor::text, 0));
  IF EXISTS (SELECT 1 FROM atlas_private.client_support_tickets
      WHERE id=v_id AND organization_id=p_org AND author_id=v_actor AND source='erp'
        AND area=p_area AND subject=btrim(p_subject) AND body=btrim(p_body)) THEN
    RETURN v_id;
  END IF;
  IF (SELECT count(*) FROM atlas_private.client_support_tickets
      WHERE organization_id=p_org AND author_id=v_actor AND created_at > now()-interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Please wait before sending another report' USING ERRCODE = '22023';
  END IF;

  INSERT INTO atlas_private.client_support_tickets (id,organization_id,author_id,source,area,subject,body)
  VALUES (v_id,p_org,v_actor,'erp',p_area,btrim(p_subject),btrim(p_body));
  RETURN v_id;
END;
$$;
CREATE FUNCTION public.report_client_problem(p_org uuid,p_area text,p_subject text,p_body text,p_request_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT atlas_private.report_client_problem(p_org,p_area,p_subject,p_body,p_request_id) $$;

CREATE FUNCTION atlas_private.my_client_problem_reports(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_is_org_member(p_org) THEN
    RAISE EXCEPTION 'Workspace membership required' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC, t.id)
    FROM (SELECT id,area,subject,status,client_update,created_at
      FROM atlas_private.client_support_tickets WHERE organization_id=p_org AND author_id=auth.uid()
      ORDER BY created_at DESC,id LIMIT 30) t),'[]');
END;
$$;
CREATE FUNCTION public.my_client_problem_reports(p_org uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT atlas_private.my_client_problem_reports(p_org) $$;

-- Only the server-side website form can submit website tickets after CAPTCHA.
CREATE FUNCTION atlas_private.record_website_support(
  p_id uuid,p_email text,p_company text,p_body text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_id IS NULL OR p_email IS NULL OR char_length(p_email) NOT BETWEEN 3 AND 254
     OR char_length(COALESCE(p_company,'')) > 160 THEN
    RAISE EXCEPTION 'Invalid website support request' USING ERRCODE = '22023';
  END IF;
  INSERT INTO atlas_private.client_support_tickets (id,source,area,subject,body,contact_email,company)
    VALUES(p_id,'website','website','Website support report',btrim(p_body),lower(p_email),nullif(btrim(p_company),''))
    ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM atlas_private.client_support_tickets
      WHERE id=p_id AND source='website' AND contact_email=lower(p_email) AND body=btrim(p_body)) THEN
    RAISE EXCEPTION 'Report reference already exists' USING ERRCODE = '23505';
  END IF;
  RETURN p_id;
END;
$$;
CREATE FUNCTION public.record_website_support(p_id uuid,p_email text,p_company text,p_body text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT atlas_private.record_website_support(p_id,p_email,p_company,p_body) $$;

REVOKE ALL ON FUNCTION public.record_website_support(uuid,text,text,text),
  atlas_private.record_website_support(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_website_support(uuid,text,text,text),
  atlas_private.record_website_support(uuid,text,text,text) TO service_role;

CREATE FUNCTION atlas_private.owner_console_request(p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_id uuid;
  v_offset int;
  v_amount numeric;
  v_date date;
  v_reference text;
  v_plan text;
  v_status text;
  v_updated timestamptz;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_month date := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_previous public.organization_subscriptions%ROWTYPE;
BEGIN
  IF NOT atlas_private.owner_console_gate() OR COALESCE(auth.jwt()->>'aal','') <> 'aal2' THEN
    RAISE EXCEPTION 'Owner access and authenticator verification required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text) > 6000 THEN
    RAISE EXCEPTION 'Invalid console request' USING ERRCODE = '22023';
  END IF;
  v_offset := COALESCE((p_data->>'offset')::integer,0);
  IF v_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'Invalid page' USING ERRCODE = '22023';
  END IF;

  CASE p_action
  WHEN 'overview' THEN
    RETURN jsonb_build_object(
      'clients',(SELECT count(*) FROM public.organizations),
      'active',(SELECT count(*) FROM public.organization_subscriptions
        WHERE status='active' AND current_period_ends_at > now()),
      'open_reports',(SELECT count(*) FROM atlas_private.client_support_tickets WHERE status<>'resolved'),
      'urgent_reports',(SELECT count(*) FROM atlas_private.client_support_tickets WHERE status<>'resolved' AND priority='urgent'),
      'overdue_reports',(SELECT count(*) FROM atlas_private.client_support_tickets WHERE status<>'resolved' AND created_at<now()-interval '48 hours'),
      'due_renewals',(SELECT count(*) FROM public.organization_subscriptions
        WHERE status='active' AND current_period_ends_at BETWEEN now() AND now()+interval '14 days'),
      'months',(SELECT jsonb_agg(to_jsonb(monthly) ORDER BY monthly.month) FROM (
        SELECT to_char(g.month,'YYYY-MM') AS month, count(p.id) AS purchases, COALESCE(sum(p.amount),0) AS revenue
        FROM generate_series(v_month-interval '5 months',v_month,interval '1 month') g(month)
        LEFT JOIN atlas_private.atlas_plan_purchases p ON p.paid_on >= g.month AND p.paid_on < g.month+interval '1 month'
        GROUP BY g.month
      ) monthly),
      'products',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.purchases DESC,t.product) FROM (
        SELECT product,count(*) AS purchases,sum(amount) AS revenue FROM atlas_private.atlas_plan_purchases
        WHERE paid_on >= v_month-interval '5 months' GROUP BY product
      ) t),'[]'),
      'report_areas',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.reports DESC,t.area) FROM (
        SELECT area,count(*) AS reports FROM atlas_private.client_support_tickets
        WHERE status<>'resolved' GROUP BY area
      ) t),'[]'),
      'recent_reports',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.id) FROM (
        SELECT id,subject,area,source,priority,created_at FROM atlas_private.client_support_tickets
        WHERE status<>'resolved' ORDER BY created_at DESC,id LIMIT 5
      ) t),'[]'),
      'updated_at',now()
    );
  WHEN 'clients' THEN
    IF char_length(COALESCE(p_data->>'search','')) > 120 THEN
      RAISE EXCEPTION 'Search is too long' USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id) FROM (
      SELECT o.id,o.name,o.created_at, COALESCE(e.status::text,'undeclared') AS eligibility_status,
        e.business_category::text,e.updated_at AS declaration_updated_at,
        e.product_lines,e.sells_electrical_products,(o.pan IS NOT NULL OR o.gstin IS NOT NULL) AS identity_present,
        s.plan_tier,s.status::text AS subscription_status,s.updated_at AS subscription_updated_at,
        s.trial_ends_at,s.current_period_ends_at,s.grace_period_ends_at,
        (SELECT max(a.created_at) FROM public.audit_events a WHERE a.organization_id=o.id) AS last_activity,
        (SELECT count(*) FROM atlas_private.client_support_tickets t WHERE t.organization_id=o.id AND t.status<>'resolved') AS open_reports
      FROM (SELECT * FROM public.organizations
        WHERE strpos(lower(name),lower(COALESCE(p_data->>'search',''))) > 0
           OR COALESCE(p_data->>'search','')=''
        ORDER BY created_at DESC,id LIMIT 26 OFFSET v_offset) o
      LEFT JOIN public.organization_eligibility e ON e.organization_id=o.id
      LEFT JOIN public.organization_subscriptions s ON s.organization_id=o.id
    ) r),'[]');
  WHEN 'tickets' THEN
    v_status := COALESCE(p_data->>'status','active');
    IF v_status NOT IN ('active','open','investigating','resolved','all') THEN
      RAISE EXCEPTION 'Invalid report filter' USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.updated_at DESC,t.id) FROM (
      SELECT s.id,s.source,s.area,s.subject,s.body,s.status,s.priority,s.contact_email,s.client_update,
        s.created_at,s.updated_at,COALESCE(o.name,s.company) AS company
      FROM atlas_private.client_support_tickets s LEFT JOIN public.organizations o ON o.id=s.organization_id
      WHERE v_status='all' OR (v_status='active' AND s.status<>'resolved') OR s.status=v_status
      ORDER BY s.updated_at DESC,s.id LIMIT 26 OFFSET v_offset
    ) t),'[]');
  WHEN 'purchases' THEN
    RETURN COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.paid_on DESC,p.created_at DESC,p.id) FROM (
      SELECT x.id,x.paid_on,x.created_at,x.product,x.amount,x.payment_reference,o.name AS company
      FROM atlas_private.atlas_plan_purchases x JOIN public.organizations o ON o.id=x.organization_id
      ORDER BY x.paid_on DESC,x.created_at DESC,x.id LIMIT 26 OFFSET v_offset
    ) p),'[]');
  WHEN 'update_ticket' THEN
    v_id := (p_data->>'id')::uuid;
    v_status := p_data->>'status';
    IF v_status IS NULL OR v_status NOT IN ('open','investigating','resolved') OR
      COALESCE(p_data->>'priority','') NOT IN ('normal','urgent') OR char_length(COALESCE(p_data->>'client_update','')) > 1000 THEN
      RAISE EXCEPTION 'Invalid ticket update' USING ERRCODE = '22023';
    END IF;
    UPDATE atlas_private.client_support_tickets SET status=v_status,priority=p_data->>'priority',
      client_update=nullif(btrim(p_data->>'client_update'),''),updated_at=clock_timestamp()
      WHERE id=v_id AND updated_at=(p_data->>'version')::timestamptz;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ticket changed. Reload it first' USING ERRCODE = '40001'; END IF;
    INSERT INTO atlas_private.owner_console_events(actor_id,action,entity_id,details)
      VALUES (v_actor,p_action,v_id,jsonb_build_object('status',v_status,'priority',p_data->>'priority'));
    RETURN jsonb_build_object('ok',true);
  WHEN 'record_purchase' THEN
    v_org := (p_data->>'organization_id')::uuid;
    v_amount := (p_data->>'amount')::numeric;
    v_date := (p_data->>'paid_on')::date;
    v_plan := p_data->>'product';
    v_reference := btrim(p_data->>'reference');
    IF v_amount IS NULL OR v_amount NOT BETWEEN 0.01 AND 9999999999.99 OR v_amount<>round(v_amount,2)
      OR v_date IS NULL OR v_date>v_today OR v_date<date '2020-01-01'
      OR COALESCE(v_plan,'') NOT IN ('starter','professional','enterprise_network')
      OR v_reference IS NULL OR char_length(v_reference) NOT BETWEEN 3 AND 100 THEN
      RAISE EXCEPTION 'Enter a valid payment amount, date, edition, and reference' USING ERRCODE = '22023';
    END IF;
    INSERT INTO atlas_private.atlas_plan_purchases(organization_id,product,amount,paid_on,payment_reference,recorded_by)
      VALUES(v_org,v_plan,v_amount,v_date,v_reference,v_actor)
      ON CONFLICT (lower(payment_reference)) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM atlas_private.atlas_plan_purchases
        WHERE lower(payment_reference)=lower(v_reference) AND organization_id=v_org AND product=v_plan
          AND amount=v_amount AND paid_on=v_date;
      IF v_id IS NULL THEN RAISE EXCEPTION 'Payment reference already recorded for different details' USING ERRCODE = '23505'; END IF;
    ELSE
      INSERT INTO atlas_private.owner_console_events(actor_id,action,entity_id,details)
        VALUES(v_actor,p_action,v_id,jsonb_build_object('organization_id',v_org,'product',v_plan));
    END IF;
    RETURN jsonb_build_object('id',v_id);
  WHEN 'set_subscription' THEN
    v_org := (p_data->>'organization_id')::uuid;
    v_status := p_data->>'status';
    v_plan := p_data->>'product';
    v_date := (p_data->>'end_date')::date;
    v_updated := (p_data->>'version')::timestamptz;
    v_reference := btrim(p_data->>'reason');
    IF COALESCE(v_status,'') NOT IN ('active','canceled')
      OR v_reference IS NULL OR char_length(v_reference) NOT BETWEEN 3 AND 500
      OR (v_status='active' AND (COALESCE(v_plan,'') NOT IN ('starter','professional','enterprise_network')
          OR v_date IS NULL OR v_date<v_today OR v_date>v_today+1096)) THEN
      RAISE EXCEPTION 'Provide valid access dates, an edition and a reason' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_previous FROM public.organization_subscriptions WHERE organization_id=v_org FOR UPDATE;
    IF NOT FOUND OR v_previous.updated_at IS DISTINCT FROM v_updated THEN
      RAISE EXCEPTION 'Subscription changed or has not been initialized' USING ERRCODE = '40001';
    END IF;
    IF v_status='active' AND NOT EXISTS (SELECT 1 FROM public.organization_eligibility WHERE organization_id=v_org AND status='approved') THEN
      RAISE EXCEPTION 'Business verification must be approved before activating access' USING ERRCODE = '22023';
    END IF;
    UPDATE public.organization_subscriptions SET status=v_status::public.subscription_status_type,
      plan_tier=CASE WHEN v_status='active' THEN v_plan ELSE v_previous.plan_tier END,
      current_period_starts_at=CASE WHEN v_status='active' THEN COALESCE(
        CASE WHEN v_previous.status='active' AND v_previous.current_period_ends_at>now() THEN v_previous.current_period_starts_at END,now())
        ELSE v_previous.current_period_starts_at END,
      current_period_ends_at=CASE WHEN v_status='active' THEN ((v_date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')
        ELSE least(v_previous.current_period_ends_at,now()) END,
      grace_period_ends_at=NULL,updated_at=clock_timestamp()
      WHERE organization_id=v_org;
    INSERT INTO atlas_private.owner_console_events(actor_id,action,entity_id,details)
      VALUES(v_actor,p_action,v_org,jsonb_build_object('previous',v_previous.status,'status',v_status,'product',v_plan,'reason',v_reference));
    RETURN jsonb_build_object('ok',true);
  WHEN 'review_declaration' THEN
    RETURN public.platform_review_workspace((p_data->>'organization_id')::uuid,(p_data->>'version')::timestamptz,
      (p_data->>'decision')::public.eligibility_status_type,p_data->>'reason');
  WHEN 'ai_input' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('owner-summary:'||v_actor::text,0));
    IF (SELECT count(*) FROM atlas_private.owner_console_events
        WHERE actor_id=v_actor AND action='ai_input' AND created_at>now()-interval '24 hours') >= 10
       OR EXISTS (SELECT 1 FROM atlas_private.owner_console_events
        WHERE actor_id=v_actor AND action='ai_input' AND created_at>now()-interval '1 minute') THEN
      RAISE EXCEPTION 'AI summary limit reached' USING ERRCODE = '54000';
    END IF;
    INSERT INTO atlas_private.owner_console_events(actor_id,action,entity_id,details)
      VALUES(v_actor,p_action,v_actor,'{}');
    RETURN atlas_private.owner_console_request('overview','{}') - 'recent_reports' ||
      jsonb_build_object('recent_reports', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT area,source,priority,
          left(regexp_replace(regexp_replace(body,'[[:alnum:]._%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}','[email]','gi'),
            '[[:digit:]][[:digit:] .()+-]{8,}[[:digit:]]','[number]','g'),500) AS excerpt
        FROM atlas_private.client_support_tickets WHERE status<>'resolved' ORDER BY updated_at DESC,id LIMIT 12
      ) s),'[]'));
  ELSE
    RAISE EXCEPTION 'Unknown console action' USING ERRCODE = '22023';
  END CASE;
END;
$$;
CREATE FUNCTION public.owner_console_request(p_action text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT atlas_private.owner_console_request(p_action,p_data) $$;

REVOKE ALL ON FUNCTION public.owner_console_gate(),atlas_private.owner_console_gate(),
  public.report_client_problem(uuid,text,text,text,uuid),atlas_private.report_client_problem(uuid,text,text,text,uuid),
  public.my_client_problem_reports(uuid),atlas_private.my_client_problem_reports(uuid),
  public.owner_console_request(text,jsonb),atlas_private.owner_console_request(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_console_gate(),atlas_private.owner_console_gate(),
  public.report_client_problem(uuid,text,text,text,uuid),atlas_private.report_client_problem(uuid,text,text,text,uuid),
  public.my_client_problem_reports(uuid),atlas_private.my_client_problem_reports(uuid),
  public.owner_console_request(text,jsonb),atlas_private.owner_console_request(text,jsonb) TO authenticated;
