BEGIN;
CREATE TABLE atlas_private.ice_invoice_reviews (
 dispatch_id uuid PRIMARY KEY REFERENCES atlas_private.ice_events(id),organization_id uuid NOT NULL REFERENCES public.organizations(id),
 billing_name text NOT NULL CHECK(char_length(billing_name) BETWEEN 1 AND 150),billing_address text NOT NULL CHECK(char_length(billing_address)<=1000),
 unit_price_paise bigint NOT NULL CHECK(unit_price_paise BETWEEN 0 AND 10000000000),tax_basis_points integer NOT NULL CHECK(tax_basis_points BETWEEN 0 AND 10000),
 supply text NOT NULL CHECK(supply IN ('state','territory','interstate','none')),tax_note text NOT NULL CHECK(char_length(tax_note)<=1000),
 status text NOT NULL CHECK(status IN ('draft','reviewed')),revision integer NOT NULL CHECK(revision>0),updated_by uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'reviewed' OR (char_length(billing_address)>=5 AND char_length(tax_note)>=5))
);
CREATE TABLE atlas_private.ice_invoice_review_operations (
 organization_id uuid NOT NULL,request_id uuid NOT NULL,actor uuid NOT NULL,dispatch_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,request_id)
);
ALTER TABLE atlas_private.ice_invoice_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_private.ice_invoice_review_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_private.ice_invoice_reviews,atlas_private.ice_invoice_review_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION atlas_private.ice_review_amounts(p_quantity bigint,p_price bigint,p_rate integer,p_supply text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE base numeric;tax bigint;central bigint;regional bigint;
BEGIN
 IF p_price IS NULL OR p_rate IS NULL OR p_supply IS NULL THEN RETURN NULL; END IF;
 IF p_quantity IS NULL OR p_quantity<=0 OR p_price NOT BETWEEN 0 AND 10000000000 OR p_rate NOT BETWEEN 0 AND 10000 OR p_supply NOT IN ('state','territory','interstate','none') OR (p_supply='none' AND p_rate<>0) THEN RAISE EXCEPTION 'Check case quantity, price, configured tax and supply type' USING ERRCODE='22023'; END IF;
 base:=p_quantity::numeric*p_price;
 IF base>99999999999999 THEN RAISE EXCEPTION 'Draft value exceeds the supported exact amount limit' USING ERRCODE='22023'; END IF;
 tax:=floor((base*p_rate+5000)/10000)::bigint;central:=CASE WHEN p_supply IN ('state','territory') THEN tax/2 ELSE 0 END;regional:=CASE WHEN p_supply IN ('state','territory') THEN tax-central ELSE 0 END;
 RETURN jsonb_build_object('base_paise',base::bigint,'tax_paise',tax,'cgst_paise',central,'sgst_paise',CASE WHEN p_supply='state' THEN regional ELSE 0 END,'utgst_paise',CASE WHEN p_supply='territory' THEN regional ELSE 0 END,'igst_paise',CASE WHEN p_supply='interstate' THEN tax ELSE 0 END,'total_paise',base::bigint+tax);
END $$;
REVOKE ALL ON FUNCTION atlas_private.ice_review_amounts(bigint,bigint,integer,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION atlas_private.ice_invoice_review_read(p_org uuid,p_from date,p_to date,p_page integer DEFAULT 1,p_state text DEFAULT 'all') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sites text[];all_sites boolean;result jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.can_read_organization_data(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,'ice-cream-distribution') IS NOT TRUE OR public.user_has_org_role(p_org,'owner','admin','accounts') IS NOT TRUE THEN RAISE EXCEPTION 'Distribution accounts access required' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR p_to-p_from>371 OR p_to>(now() AT TIME ZONE 'Asia/Kolkata')::date OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_state IS NULL OR p_state NOT IN ('all','needs_details','draft','reviewed') THEN RAISE EXCEPTION 'Choose a valid date range, page and review status' USING ERRCODE='22023'; END IF;
 all_sites:=public.user_has_org_role(p_org,'owner','admin');SELECT coalesce(array_agg(site),'{}'::text[]) INTO sites FROM atlas_private.ice_location_members WHERE organization_id=p_org AND tool='ice-cream-distribution' AND user_id=auth.uid();
 WITH visible AS(
  SELECT e.id,e.day,e.site,e.reference,e.sku,e.batch,e.quantity,e.created_at,r.billing_name,r.billing_address,r.unit_price_paise,r.tax_basis_points,r.supply,r.tax_note,coalesce(r.status,'needs_details') AS status,coalesce(r.revision,0) AS revision
  FROM atlas_private.ice_events e LEFT JOIN atlas_private.ice_invoice_reviews r ON r.organization_id=e.organization_id AND r.dispatch_id=e.id
  WHERE e.organization_id=p_org AND e.tool='ice-cream-distribution' AND e.kind='dispatch' AND e.day BETWEEN p_from AND p_to
   AND(all_sites OR(e.site=ANY(sites) AND EXISTS(SELECT 1 FROM atlas_private.ice_events p WHERE p.organization_id=p_org AND p.tool=e.tool AND p.kind='promise' AND p.reference=e.reference AND p.sku=e.sku AND p.site=ANY(sites))))
   AND(p_state='all' OR coalesce(r.status,'needs_details')=p_state)
 ),page_rows AS(SELECT * FROM visible ORDER BY created_at DESC,id LIMIT 25 OFFSET(p_page-1)*25)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(v)-'created_at'||jsonb_build_object(
  'customer',(SELECT max(detail) FROM atlas_private.ice_events p WHERE p.organization_id=p_org AND p.tool='ice-cream-distribution' AND p.kind='promise' AND p.reference=v.reference AND p.sku=v.sku),
  'return_quantity',(SELECT coalesce(sum(quantity),0) FROM atlas_private.ice_events p WHERE p.organization_id=p_org AND p.tool='ice-cream-distribution' AND p.kind='return' AND p.reference=v.reference AND p.sku=v.sku AND p.batch=v.batch),
  'amounts',atlas_private.ice_review_amounts(v.quantity,v.unit_price_paise,v.tax_basis_points,v.supply)) ORDER BY v.created_at DESC,v.id) FROM page_rows v),'[]'),'count',(SELECT count(*) FROM visible)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION atlas_private.save_ice_invoice_review(p_org uuid,p_dispatch uuid,p_request uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source atlas_private.ice_events;old atlas_private.ice_invoice_reviews;previous atlas_private.ice_invoice_review_operations;amounts jsonb;result jsonb;next_revision integer;
BEGIN
 IF auth.uid() IS NULL OR public.can_write_organization_operations(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,'ice-cream-distribution') IS NOT TRUE OR public.user_has_org_role(p_org,'owner','admin','accounts') IS NOT TRUE THEN RAISE EXCEPTION 'Distribution accounts write access required' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_dispatch IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>12000 OR (p_data-ARRAY['revision','billing_name','billing_address','unit_price_paise','tax_basis_points','supply','tax_note','status'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid review request' USING ERRCODE='22023'; END IF;
 SELECT * INTO source FROM atlas_private.ice_events WHERE organization_id=p_org AND id=p_dispatch AND tool='ice-cream-distribution' AND kind='dispatch';
 IF source.id IS NULL OR atlas_private.ice_site_allowed(p_org,source.tool,source.site) IS NOT TRUE THEN RAISE EXCEPTION 'Assigned dispatch required' USING ERRCODE='42501'; END IF;
 IF public.user_has_org_role(p_org,'owner','admin') IS NOT TRUE AND NOT EXISTS(SELECT 1 FROM atlas_private.ice_events p WHERE p.organization_id=p_org AND p.tool=source.tool AND p.kind='promise' AND p.reference=source.reference AND p.sku=source.sku AND atlas_private.ice_site_allowed(p_org,source.tool,p.site)) THEN RAISE EXCEPTION 'Customer commitment access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ice-review:'||p_org::text||p_dispatch::text,0));
 SELECT * INTO previous FROM atlas_private.ice_invoice_review_operations WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF previous.actor<>auth.uid() OR previous.dispatch_id<>p_dispatch OR previous.payload<>p_data THEN RAISE EXCEPTION 'Request was already used with different review details' USING ERRCODE='23505'; END IF;
  RETURN previous.result;
 END IF;
 SELECT * INTO old FROM atlas_private.ice_invoice_reviews WHERE organization_id=p_org AND dispatch_id=p_dispatch FOR UPDATE;
 IF (p_data->>'revision')::integer IS DISTINCT FROM coalesce(old.revision,0) THEN RAISE EXCEPTION 'This invoice review changed. Refresh before saving.' USING ERRCODE='40001'; END IF;
 IF (p_data->>'unit_price_paise') IS NULL OR (p_data->>'tax_basis_points') IS NULL OR (p_data->>'supply') IS NULL OR p_data->>'status' IS NULL OR p_data->>'status' NOT IN ('draft','reviewed') THEN RAISE EXCEPTION 'Enter the actual price, configured tax, supply type and draft status' USING ERRCODE='22023'; END IF;
 amounts:=atlas_private.ice_review_amounts(source.quantity,(p_data->>'unit_price_paise')::bigint,(p_data->>'tax_basis_points')::integer,p_data->>'supply');next_revision:=coalesce(old.revision,0)+1;
 INSERT INTO atlas_private.ice_invoice_reviews(dispatch_id,organization_id,billing_name,billing_address,unit_price_paise,tax_basis_points,supply,tax_note,status,revision,updated_by)
 VALUES(p_dispatch,p_org,btrim(p_data->>'billing_name'),btrim(coalesce(p_data->>'billing_address','')),(p_data->>'unit_price_paise')::bigint,(p_data->>'tax_basis_points')::integer,p_data->>'supply',btrim(coalesce(p_data->>'tax_note','')),p_data->>'status',next_revision,auth.uid())
 ON CONFLICT(dispatch_id) DO UPDATE SET billing_name=excluded.billing_name,billing_address=excluded.billing_address,unit_price_paise=excluded.unit_price_paise,tax_basis_points=excluded.tax_basis_points,supply=excluded.supply,tax_note=excluded.tax_note,status=excluded.status,revision=excluded.revision,updated_by=auth.uid(),updated_at=now();
 result:=jsonb_build_object('dispatch_id',p_dispatch,'revision',next_revision,'status',p_data->>'status','amounts',amounts);
 INSERT INTO atlas_private.ice_invoice_review_operations VALUES(p_org,p_request,auth.uid(),p_dispatch,p_data,result,now());RETURN result;
END $$;
CREATE FUNCTION public.ice_invoice_review_read(p_org uuid,p_from date,p_to date,p_page integer DEFAULT 1,p_state text DEFAULT 'all') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.ice_invoice_review_read(p_org,p_from,p_to,p_page,p_state); $$;
CREATE FUNCTION public.save_ice_invoice_review(p_org uuid,p_dispatch uuid,p_request uuid,p_data jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.save_ice_invoice_review(p_org,p_dispatch,p_request,p_data); $$;
REVOKE ALL ON FUNCTION atlas_private.ice_invoice_review_read(uuid,date,date,integer,text),public.ice_invoice_review_read(uuid,date,date,integer,text),atlas_private.save_ice_invoice_review(uuid,uuid,uuid,jsonb),public.save_ice_invoice_review(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.ice_invoice_review_read(uuid,date,date,integer,text),public.ice_invoice_review_read(uuid,date,date,integer,text),atlas_private.save_ice_invoice_review(uuid,uuid,uuid,jsonb),public.save_ice_invoice_review(uuid,uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
