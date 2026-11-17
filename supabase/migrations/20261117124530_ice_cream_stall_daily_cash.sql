-- Record one named staff member and opening cash per stall and India business day.
-- Keep legacy closing and waste history. Only new closes include the opening float.
CREATE UNIQUE INDEX ice_events_one_open
  ON atlas_private.ice_events (organization_id, tool, day, site)
  WHERE tool='ice-cream-stalls' AND kind='open';

CREATE OR REPLACE FUNCTION atlas_private.apply_industry_operation(p_org uuid, p_tool text, p_id uuid, p_command jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  trade_day date := timezone('Asia/Kolkata', now())::date;
  kind text := p_command->>'kind';
  site_name text := upper(btrim(coalesce(p_command->>'site','')));
  product_code text := upper(btrim(coalesce(p_command->>'sku','')));
  batch_code text := upper(btrim(coalesce(p_command->>'batch','')));
  unit_code text := coalesce(p_command->>'unit','');
  ref text := upper(btrim(coalesce(p_command->>'reference','')));
  detail_text text := btrim(coalesce(p_command->>'detail',''));
  method_code text := coalesce(p_command->>'method','');
  qty bigint := coalesce((p_command->>'quantity')::bigint, 0);
  amount bigint := coalesce((p_command->>'amount_paise')::bigint, 0);
  expiry_on date := nullif(p_command->>'expiry','')::date;
  movement bigint := 0;
  available bigint;
  recorded_expiry date;
  promised bigint;
  shipped bigint;
  returned bigint;
  previous atlas_private.industry_operations%ROWTYPE;
  job atlas_private.print_jobs%ROWTYPE;
  quote_total bigint;
  line jsonb;
  next_stage text;
  opened boolean;
BEGIN
  IF actor IS NULL OR public.can_write_organization_operations(p_org) IS NOT TRUE THEN
    RAISE EXCEPTION 'Workspace write access is required' USING ERRCODE='42501';
  END IF;
  IF p_id IS NULL OR coalesce(jsonb_typeof(p_command),'') <> 'object' OR octet_length(p_command::text) > 12000
    OR p_tool IS NULL OR p_tool NOT IN ('banner-print-studio','ice-cream-stalls','ice-cream-distribution') OR kind IS NULL THEN
    RAISE EXCEPTION 'Invalid industry operation' USING ERRCODE='22023';
  END IF;
  IF NOT public.user_has_org_role(p_org,'owner','admin')
    AND NOT (public.user_has_org_role(p_org,'sales') AND kind IN ('create','advance','proof','progress','sale','close','close_day','promise','dispatch'))
    AND NOT (public.user_has_org_role(p_org,'inventory') AND kind IN ('receive','count'))
    AND NOT (public.user_has_org_role(p_org,'accounts') AND kind IN ('advance','return','close','close_day')) THEN
    RAISE EXCEPTION 'Your role cannot record this operation' USING ERRCODE='42501';
  END IF;

  -- Serialize operations within a tool and tenant, including stock checks and close.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || '/' || p_tool, 2871));
  SELECT * INTO previous FROM atlas_private.industry_operations WHERE organization_id=p_org AND id=p_id;
  IF FOUND THEN
    IF previous.actor <> actor OR previous.tool <> p_tool OR previous.command <> p_command THEN
      RAISE EXCEPTION 'Request was already used with different details' USING ERRCODE='23505';
    END IF;
    RETURN;
  END IF;

  IF p_tool='banner-print-studio' THEN
    IF kind='create' THEN
      IF coalesce(jsonb_typeof(p_command->'lines'),'') <> 'array'
         OR jsonb_array_length(p_command->'lines') NOT BETWEEN 1 AND 20 THEN
        RAISE EXCEPTION 'Enter 1 to 20 quote lines';
      END IF;
      quote_total := 0;
      FOR line IN SELECT value FROM jsonb_array_elements(p_command->'lines') LOOP
        IF coalesce(line->>'unit','') NOT IN ('piece','sq ft')
          OR char_length(btrim(coalesce(line->>'label',''))) NOT BETWEEN 1 AND 120
          OR coalesce((line->>'quantity')::numeric,0) NOT BETWEEN 0.01 AND 1000000
          OR coalesce((line->>'rate_paise')::bigint,0) NOT BETWEEN 1 AND 100000000
          OR ((line->>'unit')='piece' AND mod((line->>'quantity')::numeric,1) <> 0)
          OR mod((line->>'quantity')::numeric * 100,1) <> 0 THEN
          RAISE EXCEPTION 'Check the unit, quantity and rate on each quote line';
        END IF;
        quote_total := quote_total + round((line->>'quantity')::numeric * (line->>'rate_paise')::bigint);
      END LOOP;
      INSERT INTO atlas_private.print_jobs (id,organization_id,customer,title,due_on,lines,quoted_paise,fulfillment,created_on)
      VALUES (p_id,p_org,btrim(p_command->>'customer'),btrim(p_command->>'title'),(p_command->>'due_on')::date,
        p_command->'lines',quote_total,p_command->>'fulfillment',trade_day);
    ELSE
      SELECT * INTO job FROM atlas_private.print_jobs WHERE organization_id=p_org AND id=(p_command->>'job_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Print job was not found' USING ERRCODE='42501'; END IF;
      IF kind='advance' THEN
        IF amount < 1 OR amount > job.quoted_paise-job.paid_paise THEN RAISE EXCEPTION 'Payment exceeds the remaining balance or is zero'; END IF;
        UPDATE atlas_private.print_jobs SET paid_paise=paid_paise+amount WHERE id=job.id;
      ELSIF kind='proof' THEN
        IF job.stage NOT IN ('design','proof') OR char_length(detail_text) NOT BETWEEN 1 AND 120 OR cardinality(job.proof_history)>=50 THEN
          RAISE EXCEPTION 'Record an artwork reference while the job is in design or proof';
        END IF;
        UPDATE atlas_private.print_jobs SET stage='proof',proof_history=array_append(proof_history,detail_text) WHERE id=job.id;
      ELSIF kind='progress' THEN
        next_stage := CASE job.stage WHEN 'proof' THEN 'approved' WHEN 'approved' THEN 'printing' WHEN 'printing' THEN 'ready' WHEN 'ready' THEN 'delivered' END;
        IF next_stage IS NULL OR job.stage IS DISTINCT FROM (p_command->>'expected_stage') THEN RAISE EXCEPTION 'The job stage changed. Refresh the board'; END IF;
        UPDATE atlas_private.print_jobs SET stage=next_stage WHERE id=job.id;
      ELSE RAISE EXCEPTION 'Unknown print job operation';
      END IF;
    END IF;
  ELSE
    IF char_length(site_name) NOT BETWEEN 1 AND 60 OR char_length(detail_text)>120
       OR qty NOT BETWEEN 0 AND 100000000 OR amount NOT BETWEEN 0 AND 10000000000 THEN
      RAISE EXCEPTION 'Check the location and amounts';
    END IF;
    IF p_tool='ice-cream-stalls' THEN
      IF kind NOT IN ('receive','sale','count','open','close','close_day') THEN RAISE EXCEPTION 'Unknown stall operation'; END IF;
      IF EXISTS (SELECT 1 FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND site=site_name AND day=trade_day AND ice_events.kind='close')
      THEN RAISE EXCEPTION 'This stall is already closed for today'; END IF;
      IF kind IN ('open','close','close_day') THEN
        SELECT EXISTS (
          SELECT 1 FROM atlas_private.ice_events
          WHERE organization_id=p_org AND tool=p_tool AND site=site_name AND day=trade_day AND ice_events.kind='open'
        ) INTO opened;
        IF kind='open' AND opened THEN RAISE EXCEPTION 'This stall is already open for today'; END IF;
        IF kind='open' AND detail_text='' THEN RAISE EXCEPTION 'Enter the staff member’s name'; END IF;
        IF kind='close_day' AND NOT opened THEN RAISE EXCEPTION 'Record opening cash before closing this stall'; END IF;
        IF kind='close' AND opened THEN RAISE EXCEPTION 'Refresh Atlas OS to close a stall that has opening cash'; END IF;
        IF kind='close_day' THEN kind := 'close'; END IF;
        product_code := ''; batch_code := ''; unit_code := ''; qty := 0;
        ref := '';
        IF kind='close' THEN detail_text := ''; END IF;
      ELSIF unit_code NOT IN ('piece','scoop') OR batch_code <> '' THEN
        RAISE EXCEPTION 'Stall stock is recorded in pieces or estimated scoops';
      END IF;
      IF kind='sale' AND (method_code NOT IN ('cash','upi') OR amount < 1 OR
        (unit_code='scoop' AND detail_text NOT IN ('Cup','Cone'))) THEN
        RAISE EXCEPTION 'Record a positive cash or UPI collection and choose cup or cone for scoops';
      END IF;
    ELSE
      IF kind NOT IN ('receive','promise','dispatch','return') OR unit_code <> 'case' THEN RAISE EXCEPTION 'Distribution uses case quantities'; END IF;
      IF (kind <> 'promise' AND char_length(batch_code) NOT BETWEEN 1 AND 60)
        OR (kind='promise' AND batch_code <> '')
        OR (kind <> 'receive' AND char_length(ref) NOT BETWEEN 1 AND 80)
        OR (kind='receive' AND expiry_on IS NULL)
        OR (kind='promise' AND detail_text='') THEN
        RAISE EXCEPTION 'Provide the required batch, expiry, customer and order reference';
      END IF;
      IF kind='return' AND detail_text NOT IN ('Restock','Damaged') THEN RAISE EXCEPTION 'Choose whether to restock the return'; END IF;
      IF kind='promise' AND EXISTS (
        SELECT 1 FROM atlas_private.ice_events
        WHERE organization_id=p_org AND tool=p_tool AND reference=ref AND ice_events.kind='promise' AND lower(detail)<>lower(detail_text)
      ) THEN RAISE EXCEPTION 'Reuse the same customer for this order reference'; END IF;

    END IF;

    IF kind NOT IN ('open','close') THEN
      IF char_length(product_code) NOT BETWEEN 1 AND 80 OR (kind <> 'count' AND qty=0) THEN
        RAISE EXCEPTION 'Enter a product and valid quantity';
      END IF;
      SELECT coalesce(sum(delta),0), min(expiry) INTO available,recorded_expiry
      FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND site=site_name AND sku=product_code AND batch=batch_code AND unit=unit_code;
      movement := CASE kind WHEN 'receive' THEN qty WHEN 'sale' THEN -qty
        WHEN 'count' THEN qty-available WHEN 'dispatch' THEN -qty
        WHEN 'return' THEN CASE WHEN detail_text='Restock' THEN qty ELSE 0 END ELSE 0 END;
      IF available+movement<0 THEN RAISE EXCEPTION 'Quantity exceeds stock available at this location'; END IF;

      IF p_tool='ice-cream-distribution' THEN
        IF kind='receive' AND (expiry_on < trade_day OR (recorded_expiry IS NOT NULL AND recorded_expiry<>expiry_on)) THEN RAISE EXCEPTION 'Batch expiry is past or conflicts with the existing batch'; END IF;
        IF kind IN ('dispatch','return') THEN
          IF kind='dispatch' AND (recorded_expiry IS NULL OR recorded_expiry<trade_day) THEN RAISE EXCEPTION 'Only stock within its recorded expiry date can be dispatched'; END IF;
          SELECT coalesce(sum(quantity) FILTER (WHERE ice_events.kind='promise'),0), coalesce(sum(quantity) FILTER (WHERE ice_events.kind='dispatch'),0)
          INTO promised,shipped FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND reference=ref AND sku=product_code;
          IF kind='dispatch' AND qty>promised-shipped THEN RAISE EXCEPTION 'Dispatch quantity exceeds the unshipped commitment'; END IF;
          IF kind='return' THEN
            SELECT coalesce(sum(quantity) FILTER (WHERE ice_events.kind='dispatch'),0), coalesce(sum(quantity) FILTER (WHERE ice_events.kind='return'),0)
            INTO shipped,returned FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND reference=ref AND sku=product_code AND batch=batch_code;
            IF qty>shipped-returned THEN RAISE EXCEPTION 'Return exceeds shipped cases for this batch and order'; END IF;
            IF detail_text='Restock' AND (recorded_expiry IS NULL OR recorded_expiry<trade_day) THEN RAISE EXCEPTION 'Restock only at a freezer with the same unexpired batch on record'; END IF;
          END IF;
        END IF;
      END IF;
    END IF;
    INSERT INTO atlas_private.ice_events (id,organization_id,tool,day,site,sku,batch,unit,kind,quantity,delta,reference,detail,amount_paise,method,expiry)
    VALUES (p_id,p_org,p_tool,trade_day,site_name,product_code,batch_code,unit_code,kind,qty,movement,ref,detail_text,
      CASE WHEN kind IN ('sale','open','close','return') THEN amount ELSE 0 END, CASE WHEN kind='sale' THEN method_code ELSE '' END,
      CASE WHEN kind='receive' AND p_tool='ice-cream-distribution' THEN expiry_on END);
  END IF;

  INSERT INTO atlas_private.industry_operations VALUES (p_org,p_id,actor,p_tool,p_command);
END;
$$;

CREATE OR REPLACE FUNCTION atlas_private.industry_workspace(p_org uuid, p_tool text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  trade_day date := timezone('Asia/Kolkata',now())::date;
  show_money boolean := public.user_has_org_role(p_org,'owner','admin','sales','accounts');
BEGIN
  IF auth.uid() IS NULL OR public.can_read_organization_data(p_org) IS NOT TRUE THEN
    RAISE EXCEPTION 'Workspace read access is required' USING ERRCODE='42501';
  END IF;
  IF p_tool='banner-print-studio' THEN
    IF NOT show_money THEN RAISE EXCEPTION 'Print job access is required' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('today',trade_day,
      'jobs', (SELECT coalesce(jsonb_agg(to_jsonb(j)-'organization_id'), '[]') FROM (
        SELECT * FROM atlas_private.print_jobs WHERE organization_id=p_org
        ORDER BY (stage='delivered'), due_on, id LIMIT 100
      ) j),
      'series', (SELECT jsonb_build_array(
        count(*) FILTER (WHERE due_on<trade_day),
        count(*) FILTER (WHERE due_on=trade_day),
        count(*) FILTER (WHERE due_on BETWEEN trade_day+1 AND trade_day+7),
        count(*) FILTER (WHERE due_on>trade_day+7))
        FROM atlas_private.print_jobs WHERE organization_id=p_org AND stage<>'delivered'));
  END IF;
  IF p_tool IS NULL OR p_tool NOT IN ('ice-cream-stalls','ice-cream-distribution') THEN RAISE EXCEPTION 'Unknown industry workspace'; END IF;
  RETURN jsonb_build_object('today',trade_day,
    'stock', (SELECT coalesce(jsonb_agg(b),'[]') FROM (
      SELECT site,sku,batch,unit,sum(delta) AS quantity,min(expiry) AS expiry
      FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND sku<>''
      GROUP BY site,sku,batch,unit HAVING sum(delta)>0 ORDER BY site,sku,batch,unit
    ) b),
    'events', (SELECT coalesce(jsonb_agg(
       CASE WHEN show_money THEN to_jsonb(e)-'organization_id' ELSE to_jsonb(e)-'organization_id'-'amount_paise' END
       ORDER BY e.created_at DESC,e.id),'[]') FROM (
       SELECT * FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool ORDER BY created_at DESC,id LIMIT 50
    ) e),
    'series', (SELECT coalesce(jsonb_agg(d ORDER BY d.day),'[]') FROM (
       SELECT day,
         sum(quantity) FILTER (WHERE kind IN ('receive','promise')) AS first,
         sum(quantity) FILTER (WHERE kind IN ('sale','dispatch')) AS second,
         unit
       FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND day>=trade_day-6
         AND ((p_tool='ice-cream-stalls' AND kind IN ('receive','sale'))
           OR (p_tool='ice-cream-distribution' AND kind IN ('promise','dispatch')))
       GROUP BY day,unit
    ) d),
    'tills', (SELECT CASE WHEN show_money AND p_tool='ice-cream-stalls' THEN coalesce(jsonb_agg(t),'[]') ELSE '[]'::jsonb END
      FROM (SELECT site, coalesce(sum(amount_paise) FILTER (WHERE kind='sale' AND method='cash'),0) AS cash,
        coalesce(sum(amount_paise) FILTER (WHERE kind='sale' AND method='upi'),0) AS upi,
        max(amount_paise) FILTER (WHERE kind='open') AS opening,
        max(detail) FILTER (WHERE kind='open') AS staff,
        max(amount_paise) FILTER (WHERE kind='close') AS counted
        FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND day=trade_day GROUP BY site) t),
    'orders', (SELECT coalesce(jsonb_agg(o),'[]') FROM (
       SELECT reference,sku,max(detail) FILTER (WHERE kind='promise') AS customer,
         sum(quantity) FILTER (WHERE kind='promise') AS promised,
         coalesce(sum(quantity) FILTER (WHERE kind='dispatch'),0) AS dispatched
       FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND kind IN ('promise','dispatch')
       GROUP BY reference,sku HAVING sum(quantity) FILTER (WHERE kind='promise')>coalesce(sum(quantity) FILTER (WHERE kind='dispatch'),0)
    ) o));
END;
$$;
