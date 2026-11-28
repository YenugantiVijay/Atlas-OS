BEGIN;
CREATE TABLE atlas_private.ice_location_members (
 organization_id uuid NOT NULL REFERENCES public.organizations(id),tool text NOT NULL CHECK(tool IN ('ice-cream-stalls','ice-cream-distribution')),
 site text NOT NULL CHECK(site=upper(btrim(site)) AND char_length(site) BETWEEN 1 AND 60),user_id uuid NOT NULL REFERENCES auth.users(id),
 granted_by uuid NOT NULL,granted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,tool,site,user_id)
);
CREATE TABLE atlas_private.ice_location_access_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid NOT NULL,tool text NOT NULL,site text NOT NULL,user_id uuid NOT NULL,
 granted boolean NOT NULL,actor uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atlas_private.ice_location_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_private.ice_location_access_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_private.ice_location_members,atlas_private.ice_location_access_history FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION atlas_private.ice_site_allowed(p_org uuid,p_tool text,p_site text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND public.can_read_organization_data(p_org) AND public.workspace_has_product(p_org,p_tool)
 AND (public.user_has_org_role(p_org,'owner','admin') OR EXISTS(SELECT 1 FROM atlas_private.ice_location_members l WHERE l.organization_id=p_org AND l.tool=p_tool AND l.site=upper(btrim(p_site)) AND l.user_id=auth.uid()));
$$;
REVOKE ALL ON FUNCTION atlas_private.ice_site_allowed(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION atlas_private.apply_industry_operation(uuid,text,uuid,jsonb) RENAME TO apply_industry_operation_unscoped;
REVOKE ALL ON FUNCTION atlas_private.apply_industry_operation_unscoped(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION atlas_private.apply_industry_operation(p_org uuid,p_tool text,p_id uuid,p_command jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.can_write_organization_operations(p_org) IS NOT TRUE THEN RAISE EXCEPTION 'Workspace write access is required' USING ERRCODE='42501'; END IF;
 IF p_tool IN ('ice-cream-stalls','ice-cream-distribution') THEN
  IF atlas_private.ice_site_allowed(p_org,p_tool,p_command->>'site') IS NOT TRUE THEN RAISE EXCEPTION 'Your account is not assigned to this location. Ask the owner to grant access.' USING ERRCODE='42501'; END IF;
  IF p_command->>'kind'='transfer' AND atlas_private.ice_site_allowed(p_org,p_tool,p_command->>'destination') IS NOT TRUE THEN RAISE EXCEPTION 'Transfer requires access to both source and destination locations' USING ERRCODE='42501'; END IF;
  IF p_tool='ice-cream-distribution' AND p_command->>'kind' IN ('dispatch','return') AND public.user_has_org_role(p_org,'owner','admin') IS NOT TRUE
   AND NOT EXISTS(SELECT 1 FROM atlas_private.ice_events e WHERE e.organization_id=p_org AND e.tool=p_tool AND e.kind='promise' AND e.reference=upper(btrim(p_command->>'reference')) AND e.sku=upper(btrim(p_command->>'sku')) AND atlas_private.ice_site_allowed(p_org,p_tool,e.site)) THEN
   RAISE EXCEPTION 'The customer commitment is outside your assigned locations' USING ERRCODE='42501';
  END IF;
 END IF;
 PERFORM atlas_private.apply_industry_operation_unscoped(p_org,p_tool,p_id,p_command);
END $$;
REVOKE ALL ON FUNCTION atlas_private.apply_industry_operation(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.apply_industry_operation(uuid,text,uuid,jsonb) TO authenticated;

ALTER FUNCTION atlas_private.industry_workspace(uuid,text) RENAME TO industry_workspace_unscoped;
REVOKE ALL ON FUNCTION atlas_private.industry_workspace_unscoped(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION atlas_private.industry_workspace(p_org uuid,p_tool text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; key text; filtered jsonb; assigned_sites text[];
BEGIN
 result:=atlas_private.industry_workspace_unscoped(p_org,p_tool);
 IF p_tool NOT IN ('ice-cream-stalls','ice-cream-distribution') THEN RETURN result; END IF;
 IF public.user_has_org_role(p_org,'owner','admin') THEN RETURN result||jsonb_build_object('location_restricted',false); END IF;
 SELECT coalesce(array_agg(site),'{}'::text[]) INTO assigned_sites FROM atlas_private.ice_location_members WHERE organization_id=p_org AND tool=p_tool AND user_id=auth.uid();
 FOREACH key IN ARRAY ARRAY['stock','tills'] LOOP
  SELECT coalesce(jsonb_agg(item),'[]') INTO filtered FROM jsonb_array_elements(result->key) item WHERE item->>'site'=ANY(assigned_sites);
  result:=jsonb_set(result,ARRAY[key],filtered);
 END LOOP;
 SELECT coalesce(jsonb_agg(CASE WHEN public.user_has_org_role(p_org,'owner','admin','sales','accounts') THEN to_jsonb(e)-'organization_id' ELSE to_jsonb(e)-'organization_id'-'amount_paise' END ORDER BY e.created_at DESC,e.id),'[]') INTO filtered FROM (SELECT * FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND site=ANY(assigned_sites) ORDER BY created_at DESC,id LIMIT 50) e;
 result:=jsonb_set(result,'{events}',filtered);
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO filtered FROM (
  SELECT day,unit,sum(quantity) FILTER(WHERE kind IN ('receive','promise')) AS first,sum(quantity) FILTER(WHERE kind IN ('sale','dispatch')) AS second
  FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND day>=(now() AT TIME ZONE 'Asia/Kolkata')::date-6 AND site=ANY(assigned_sites)
  AND ((p_tool='ice-cream-stalls' AND kind IN ('receive','sale')) OR(p_tool='ice-cream-distribution' AND kind IN ('promise','dispatch'))) GROUP BY day,unit
 ) r;
 result:=jsonb_set(result,'{series}',filtered);
 SELECT coalesce(jsonb_agg(item),'[]') INTO filtered FROM jsonb_array_elements(result->'orders') item WHERE EXISTS(
  SELECT 1 FROM atlas_private.ice_events e WHERE e.organization_id=p_org AND e.tool=p_tool AND e.kind='promise' AND e.reference=item->>'reference' AND e.sku=item->>'sku' AND e.site=ANY(assigned_sites));
 RETURN jsonb_set(result,'{orders}',filtered)||jsonb_build_object('location_restricted',true,'assigned_locations',coalesce((SELECT jsonb_agg(site ORDER BY site) FROM atlas_private.ice_location_members WHERE organization_id=p_org AND tool=p_tool AND user_id=auth.uid()),'[]'));
END $$;
REVOKE ALL ON FUNCTION atlas_private.industry_workspace(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.industry_workspace(uuid,text) TO authenticated;

CREATE FUNCTION atlas_private.ice_location_access(p_org uuid,p_tool text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.can_read_organization_data(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,p_tool) IS NOT TRUE OR p_tool NOT IN ('ice-cream-stalls','ice-cream-distribution') OR public.user_has_org_role(p_org,'owner','admin') IS NOT TRUE THEN RAISE EXCEPTION 'Owner or administrator access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('sites',coalesce((SELECT jsonb_agg(site ORDER BY site) FROM(SELECT site FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool UNION SELECT site FROM atlas_private.ice_location_members WHERE organization_id=p_org AND tool=p_tool) s),'[]'),
 'members',coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role) ORDER BY u.email) FROM public.memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.organization_id=p_org AND m.is_active AND m.role NOT IN ('owner','admin')),'[]'),
 'grants',coalesce((SELECT jsonb_agg(jsonb_build_object('site',site,'user_id',user_id) ORDER BY site,user_id) FROM atlas_private.ice_location_members WHERE organization_id=p_org AND tool=p_tool),'[]'));
END $$;
CREATE FUNCTION atlas_private.set_ice_location_access(p_org uuid,p_tool text,p_site text,p_user uuid,p_grant boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE location_name text:=upper(btrim(p_site));
BEGIN
 IF auth.uid() IS NULL OR public.can_write_organization_operations(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,p_tool) IS NOT TRUE OR p_tool NOT IN ('ice-cream-stalls','ice-cream-distribution') OR public.user_has_org_role(p_org,'owner','admin') IS NOT TRUE THEN RAISE EXCEPTION 'Owner or administrator access required' USING ERRCODE='42501'; END IF;
 IF p_grant IS NULL OR location_name IS NULL OR char_length(location_name) NOT BETWEEN 1 AND 60 OR p_user IS NULL THEN RAISE EXCEPTION 'Choose a location and team member' USING ERRCODE='22023'; END IF;
 IF p_grant AND NOT EXISTS(SELECT 1 FROM public.memberships WHERE organization_id=p_org AND user_id=p_user AND is_active AND role NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'Choose an active non-administrator member' USING ERRCODE='22023'; END IF;
 IF p_grant THEN INSERT INTO atlas_private.ice_location_members(organization_id,tool,site,user_id,granted_by) VALUES(p_org,p_tool,location_name,p_user,auth.uid()) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM atlas_private.ice_location_members WHERE organization_id=p_org AND tool=p_tool AND site=location_name AND user_id=p_user; END IF;
 IF FOUND THEN INSERT INTO atlas_private.ice_location_access_history(organization_id,tool,site,user_id,granted,actor) VALUES(p_org,p_tool,location_name,p_user,p_grant,auth.uid()); END IF;
END $$;
CREATE FUNCTION public.ice_location_access(p_org uuid,p_tool text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.ice_location_access(p_org,p_tool); $$;
CREATE FUNCTION public.set_ice_location_access(p_org uuid,p_tool text,p_site text,p_user uuid,p_grant boolean) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.set_ice_location_access(p_org,p_tool,p_site,p_user,p_grant); $$;
REVOKE ALL ON FUNCTION atlas_private.ice_location_access(uuid,text),atlas_private.set_ice_location_access(uuid,text,text,uuid,boolean),public.ice_location_access(uuid,text),public.set_ice_location_access(uuid,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.ice_location_access(uuid,text),atlas_private.set_ice_location_access(uuid,text,text,uuid,boolean),public.ice_location_access(uuid,text),public.set_ice_location_access(uuid,text,text,uuid,boolean) TO authenticated;
CREATE FUNCTION atlas_private.ice_reconciliation(p_org uuid,p_tool text,p_day date,p_site text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sites text[]; stock_rows jsonb; cash_rows jsonb; all_sites boolean; money_access boolean;
BEGIN
 IF auth.uid() IS NULL OR public.can_read_organization_data(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,p_tool) IS NOT TRUE OR p_tool NOT IN ('ice-cream-stalls','ice-cream-distribution') THEN RAISE EXCEPTION 'Product workspace access required' USING ERRCODE='42501'; END IF;
 IF p_day IS NULL OR NOT isfinite(p_day) OR p_day>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Choose a valid business date, not a future date' USING ERRCODE='22023'; END IF;
 all_sites:=public.user_has_org_role(p_org,'owner','admin');money_access:=public.user_has_org_role(p_org,'owner','admin','sales','accounts');
 SELECT coalesce(array_agg(site),'{}'::text[]) INTO sites FROM atlas_private.ice_location_members WHERE organization_id=p_org AND tool=p_tool AND user_id=auth.uid();
 IF p_site IS NOT NULL AND atlas_private.ice_site_allowed(p_org,p_tool,p_site) IS NOT TRUE THEN RAISE EXCEPTION 'Location access required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY site,sku,batch,unit),'[]') INTO stock_rows FROM (
  SELECT site,sku,batch,unit,coalesce(sum(delta) FILTER(WHERE day<p_day),0)::bigint AS opening,
   coalesce(sum(delta) FILTER(WHERE day=p_day AND kind='receive'),0)::bigint AS received,
   coalesce(sum(quantity) FILTER(WHERE day=p_day AND kind IN ('sale','dispatch')),0)::bigint AS sold_or_dispatched,
   coalesce(sum(delta) FILTER(WHERE day=p_day AND kind='return'),0)::bigint AS restocked,
   coalesce(sum(delta) FILTER(WHERE day=p_day AND kind='transfer_in'),0)::bigint AS transferred_in,
   -coalesce(sum(delta) FILTER(WHERE day=p_day AND kind='transfer_out'),0)::bigint AS transferred_out,
   coalesce(sum(quantity) FILTER(WHERE day=p_day AND kind='waste'),0)::bigint AS written_off,
   coalesce(sum(delta) FILTER(WHERE day=p_day AND kind='count'),0)::bigint AS count_adjustment,
   sum(delta)::bigint AS closing
  FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND day<=p_day AND sku<>'' AND (all_sites OR site=ANY(sites)) AND (p_site IS NULL OR site=upper(btrim(p_site))) GROUP BY site,sku,batch,unit
 ) r;
 IF jsonb_array_length(stock_rows)>5000 THEN RAISE EXCEPTION 'Choose one location to reconcile at most 5000 stock rows' USING ERRCODE='22023'; END IF;
 SELECT CASE WHEN money_access AND p_tool='ice-cream-stalls' THEN coalesce(jsonb_agg(to_jsonb(r) ORDER BY site),'[]') ELSE '[]'::jsonb END INTO cash_rows FROM(
  SELECT site,max(amount_paise) FILTER(WHERE kind='open') AS opening_paise,
   coalesce(sum(amount_paise) FILTER(WHERE kind='sale' AND method='cash'),0)::bigint AS cash_sales_paise,
   coalesce(sum(amount_paise) FILTER(WHERE kind='sale' AND method='upi'),0)::bigint AS upi_sales_paise,
   max(amount_paise) FILTER(WHERE kind='close') AS counted_paise,
   max(amount_paise) FILTER(WHERE kind='open')+coalesce(sum(amount_paise) FILTER(WHERE kind='sale' AND method='cash'),0)::bigint AS expected_paise,
   max(amount_paise) FILTER(WHERE kind='close')-(max(amount_paise) FILTER(WHERE kind='open')+coalesce(sum(amount_paise) FILTER(WHERE kind='sale' AND method='cash'),0)::bigint) AS variance_paise
  FROM atlas_private.ice_events WHERE organization_id=p_org AND tool=p_tool AND day=p_day AND kind IN ('open','sale','close') AND (all_sites OR site=ANY(sites)) AND (p_site IS NULL OR site=upper(btrim(p_site))) GROUP BY site
 ) r;
 RETURN jsonb_build_object('day',p_day,'stock',stock_rows,'cash',cash_rows);
END $$;
CREATE FUNCTION public.ice_reconciliation(p_org uuid,p_tool text,p_day date,p_site text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.ice_reconciliation(p_org,p_tool,p_day,p_site); $$;
REVOKE ALL ON FUNCTION atlas_private.ice_reconciliation(uuid,text,date,text),public.ice_reconciliation(uuid,text,date,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.ice_reconciliation(uuid,text,date,text),public.ice_reconciliation(uuid,text,date,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
