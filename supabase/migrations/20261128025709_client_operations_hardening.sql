BEGIN;
-- Retain the established command implementation behind a strictly private wrapper.
ALTER FUNCTION atlas_private.apply_industry_operation(uuid,text,uuid,jsonb) RENAME TO apply_industry_operation_base;
REVOKE ALL ON FUNCTION atlas_private.apply_industry_operation_base(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ice_batch_expiry ON atlas_private.ice_events(organization_id,tool,sku,batch) WHERE expiry IS NOT NULL;
CREATE FUNCTION atlas_private.apply_industry_operation(p_org uuid,p_tool text,p_id uuid,p_command jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE operation_kind text:=p_command->>'kind'; site_name text:=upper(btrim(coalesce(p_command->>'site','')));
 target_site text:=upper(btrim(coalesce(p_command->>'destination',''))); sku_name text:=upper(btrim(coalesce(p_command->>'sku','')));
 batch_name text:=upper(btrim(coalesce(p_command->>'batch',''))); unit_name text:=p_command->>'unit';
 qty bigint; available bigint; expiry_on date; detail_text text:=btrim(coalesce(p_command->>'detail',''));
 previous atlas_private.industry_operations;
BEGIN
 IF auth.uid() IS NULL OR public.can_write_organization_operations(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,p_tool) IS NOT TRUE THEN RAISE EXCEPTION 'Workspace write access and the correct product are required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>12000 THEN RAISE EXCEPTION 'Invalid operation request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||'/'||p_tool,2871));
 SELECT * INTO previous FROM atlas_private.industry_operations WHERE organization_id=p_org AND id=p_id;
 IF FOUND THEN
  IF previous.actor<>auth.uid() OR previous.tool<>p_tool OR previous.command<>p_command THEN RAISE EXCEPTION 'Request was already used with different details' USING ERRCODE='23505'; END IF;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM atlas_private.industry_cancellations WHERE organization_id=p_org AND id=p_id) THEN RAISE EXCEPTION 'This request was cancelled; start a new operation' USING ERRCODE='22023'; END IF;
 IF p_tool='ice-cream-distribution' AND operation_kind='receive' THEN
  expiry_on:=nullif(p_command->>'expiry','')::date;
  IF expiry_on IS NULL OR NOT isfinite(expiry_on) THEN RAISE EXCEPTION 'Enter a finite batch expiry date' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND sku=sku_name AND batch=batch_name AND expiry IS NOT NULL AND expiry<>expiry_on) THEN RAISE EXCEPTION 'Factory batch expiry must match across all freezer locations' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_tool='ice-cream-stalls' AND operation_kind='count' THEN
  SELECT coalesce(sum(delta),0) INTO available FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND site=site_name AND sku=sku_name AND batch=batch_name AND unit=unit_name;
  IF jsonb_typeof(p_command->'expected_quantity') IS DISTINCT FROM 'number' OR coalesce(p_command->>'expected_quantity','')!~'^[0-9]+$' THEN RAISE EXCEPTION 'Refresh stock before recording a count' USING ERRCODE='22023'; END IF;
  IF available<>(p_command->>'expected_quantity')::bigint THEN RAISE EXCEPTION 'Stock changed since this count was prepared; refresh and recount' USING ERRCODE='40001'; END IF;
  IF char_length(detail_text) NOT BETWEEN 5 AND 120 THEN RAISE EXCEPTION 'Enter a reason for the stock count' USING ERRCODE='22023'; END IF;
 END IF;
 IF operation_kind NOT IN ('waste','transfer') OR p_tool NOT IN ('ice-cream-stalls','ice-cream-distribution') THEN
  PERFORM atlas_private.apply_industry_operation_base(p_org,p_tool,p_id,p_command); RETURN;
 END IF;
 IF public.user_has_org_role(p_org,'owner','admin','inventory') IS NOT TRUE THEN RAISE EXCEPTION 'Stock management access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_command->'quantity') IS DISTINCT FROM 'number' OR coalesce(p_command->>'quantity','')!~'^[0-9]+$' THEN RAISE EXCEPTION 'Use whole stock quantities' USING ERRCODE='22023'; END IF;
 qty:=(p_command->>'quantity')::bigint;
 IF qty NOT BETWEEN 1 AND 100000000 OR char_length(site_name) NOT BETWEEN 1 AND 60 OR char_length(sku_name) NOT BETWEEN 1 AND 80 OR char_length(detail_text) NOT BETWEEN 5 AND 120 THEN RAISE EXCEPTION 'Provide stock quantity, location, product and a reason' USING ERRCODE='22023'; END IF;
 IF p_tool='ice-cream-distribution' THEN
  IF unit_name IS DISTINCT FROM 'case' OR char_length(batch_name) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Select the case batch' USING ERRCODE='22023'; END IF;
 ELSIF unit_name IS NULL OR unit_name NOT IN ('piece','scoop') OR batch_name<>'' THEN RAISE EXCEPTION 'Use packaged pieces or estimated scoops' USING ERRCODE='22023'; END IF;
 IF operation_kind='transfer' AND (char_length(target_site) NOT BETWEEN 1 AND 60 OR target_site=site_name) THEN RAISE EXCEPTION 'Choose a different destination location' USING ERRCODE='22023'; END IF;
 IF p_tool='ice-cream-stalls' AND EXISTS(SELECT 1 FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND day=(now() AT TIME ZONE 'Asia/Kolkata')::date AND ice_events.kind='close' AND (site=site_name OR (operation_kind='transfer' AND site=target_site))) THEN RAISE EXCEPTION 'This stall is already closed for today'; END IF;
 SELECT coalesce(sum(delta),0),min(expiry) INTO available,expiry_on FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND site=site_name AND sku=sku_name AND batch=batch_name AND unit=unit_name;
 IF qty>available THEN RAISE EXCEPTION 'Quantity exceeds stock available at this location'; END IF;
 IF operation_kind='transfer' AND p_tool='ice-cream-distribution' AND (expiry_on IS NULL OR expiry_on<(now() AT TIME ZONE 'Asia/Kolkata')::date) THEN RAISE EXCEPTION 'Expired stock must be written off, not transferred' USING ERRCODE='22023'; END IF;
 INSERT INTO atlas_private.ice_events(id,organization_id,tool,day,site,sku,batch,unit,kind,quantity,delta,reference,detail,amount_paise,method,expiry)
 VALUES(p_id,p_org,p_tool,(now() AT TIME ZONE 'Asia/Kolkata')::date,site_name,sku_name,batch_name,unit_name,CASE WHEN operation_kind='transfer' THEN 'transfer_out' ELSE 'waste' END,qty,-qty,p_id::text,detail_text,0,'',expiry_on);
 IF operation_kind='transfer' THEN
  INSERT INTO atlas_private.ice_events(id,organization_id,tool,day,site,sku,batch,unit,kind,quantity,delta,reference,detail,amount_paise,method,expiry)
  VALUES(gen_random_uuid(),p_org,p_tool,(now() AT TIME ZONE 'Asia/Kolkata')::date,target_site,sku_name,batch_name,unit_name,'transfer_in',qty,qty,p_id::text,detail_text,0,'',expiry_on);
 END IF;
 INSERT INTO atlas_private.industry_operations VALUES(p_org,p_id,auth.uid(),p_tool,p_command);
END $$;
REVOKE ALL ON FUNCTION atlas_private.apply_industry_operation(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.apply_industry_operation(uuid,text,uuid,jsonb) TO authenticated;
CREATE TABLE atlas_private.industry_cancellations (
 organization_id uuid NOT NULL REFERENCES public.organizations(id),id uuid NOT NULL,actor uuid NOT NULL,tool text NOT NULL,command jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,id)
);
ALTER TABLE atlas_private.industry_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_private.industry_cancellations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION atlas_private.resolve_industry_operation(p_org uuid,p_tool text,p_id uuid,p_command jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous atlas_private.industry_operations; cancelled atlas_private.industry_cancellations;
BEGIN
 IF auth.uid() IS NULL OR public.can_read_organization_data(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,p_tool) IS NOT TRUE THEN RAISE EXCEPTION 'Workspace access required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>12000 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||'/'||p_tool,2871));
 SELECT * INTO previous FROM atlas_private.industry_operations WHERE organization_id=p_org AND id=p_id;
 IF FOUND THEN
  IF previous.actor<>auth.uid() OR previous.tool<>p_tool OR previous.command<>p_command THEN RAISE EXCEPTION 'Request belongs to another operation' USING ERRCODE='42501'; END IF;
  RETURN true;
 END IF;
 SELECT * INTO cancelled FROM atlas_private.industry_cancellations WHERE organization_id=p_org AND id=p_id;
 IF FOUND AND (cancelled.actor<>auth.uid() OR cancelled.tool<>p_tool OR cancelled.command<>p_command) THEN RAISE EXCEPTION 'Request belongs to another operation' USING ERRCODE='42501'; END IF;
 INSERT INTO atlas_private.industry_cancellations(organization_id,id,actor,tool,command) VALUES(p_org,p_id,auth.uid(),p_tool,p_command) ON CONFLICT DO NOTHING;
 RETURN false;
END $$;
CREATE FUNCTION public.resolve_industry_operation(p_org uuid,p_tool text,p_id uuid,p_command jsonb) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.resolve_industry_operation(p_org,p_tool,p_id,p_command); $$;
REVOKE ALL ON FUNCTION atlas_private.resolve_industry_operation(uuid,text,uuid,jsonb),public.resolve_industry_operation(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.resolve_industry_operation(uuid,text,uuid,jsonb),public.resolve_industry_operation(uuid,text,uuid,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
