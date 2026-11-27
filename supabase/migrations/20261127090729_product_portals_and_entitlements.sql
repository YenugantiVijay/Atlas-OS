BEGIN;
CREATE TABLE atlas_private.staff_portal_members (
 organization_id uuid NOT NULL REFERENCES public.organizations(id), user_id uuid NOT NULL REFERENCES auth.users(id),
 marked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,user_id)
);
ALTER TABLE atlas_private.staff_portal_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_private.staff_portal_members FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO atlas_private.staff_portal_members(organization_id,user_id)
 SELECT organization_id,user_id FROM public.staff_employee_accounts UNION SELECT organization_id,user_id FROM public.staff_clock_sessions;
CREATE FUNCTION atlas_private.mark_staff_portal_member() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO atlas_private.staff_portal_members(organization_id,user_id) VALUES(NEW.organization_id,NEW.user_id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION atlas_private.mark_staff_portal_member() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mark_staff_portal_member AFTER INSERT OR UPDATE ON public.staff_employee_accounts FOR EACH ROW EXECUTE FUNCTION atlas_private.mark_staff_portal_member();

CREATE TABLE atlas_private.workspace_products (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 product text NOT NULL CHECK(product IN ('electrical','electronics','hardware','retail-wholesale','agricultural-inputs','ecommerce','small-business','banner-print-studio','ice-cream-stalls','ice-cream-distribution','school')),
 bound_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atlas_private.workspace_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_private.workspace_products FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION atlas_private.product_for_category(category public.business_category_type) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE category::text WHEN 'electrical_retail' THEN 'electrical' WHEN 'electrical_wholesale_distributor' THEN 'electrical' WHEN 'hardware_electrical' THEN 'hardware'
 WHEN 'hardware_trade' THEN 'hardware' WHEN 'electronics_trade' THEN 'electronics' WHEN 'general_wholesale' THEN 'retail-wholesale'
 WHEN 'agricultural_inputs' THEN 'agricultural-inputs' WHEN 'ecommerce' THEN 'ecommerce' WHEN 'general_retail' THEN 'small-business'
 WHEN 'banner_print_studio' THEN 'banner-print-studio' WHEN 'ice_cream_stalls' THEN 'ice-cream-stalls' WHEN 'ice_cream_distribution' THEN 'ice-cream-distribution' WHEN 'school' THEN 'school' END;
$$;
REVOKE ALL ON FUNCTION atlas_private.product_for_category(public.business_category_type) FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO atlas_private.workspace_products(organization_id,product)
 SELECT organization_id,atlas_private.product_for_category(business_category) FROM public.organization_eligibility
 WHERE atlas_private.product_for_category(business_category) IS NOT NULL;
CREATE FUNCTION atlas_private.bind_workspace_product() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE code text:=atlas_private.product_for_category(NEW.business_category); bound text;
BEGIN
 SELECT product INTO bound FROM atlas_private.workspace_products WHERE organization_id=NEW.organization_id;
 IF bound IS NULL AND code IS NOT NULL AND nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-atlas-product','') IS NOT NULL AND code<>coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-atlas-product' THEN RAISE EXCEPTION 'Choose the product associated with this sign-in entry.' USING ERRCODE='22023'; END IF;
 IF code IS NOT NULL AND bound IS NOT NULL AND code<>bound THEN RAISE EXCEPTION 'This workspace is bound to another product. Create a separate workspace and subscription.' USING ERRCODE='22023'; END IF;
 IF code IS NOT NULL THEN INSERT INTO atlas_private.workspace_products(organization_id,product) VALUES(NEW.organization_id,code) ON CONFLICT(organization_id) DO NOTHING; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.bind_workspace_product() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bind_workspace_product BEFORE INSERT OR UPDATE ON public.organization_eligibility FOR EACH ROW EXECUTE FUNCTION atlas_private.bind_workspace_product();
CREATE FUNCTION atlas_private.workspace_has_product(p_org uuid,p_product text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.user_is_org_member(p_org) AND EXISTS(SELECT 1 FROM atlas_private.workspace_products p WHERE p.organization_id=p_org AND p.product=p_product);
$$;
REVOKE ALL ON FUNCTION atlas_private.workspace_has_product(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.workspace_has_product(uuid,text) TO authenticated;
CREATE FUNCTION public.workspace_has_product(p_org uuid,p_product text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.workspace_has_product(p_org,p_product); $$;
REVOKE ALL ON FUNCTION public.workspace_has_product(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workspace_has_product(uuid,text) TO authenticated;


-- A product URL is a request, never a grant. Historical reads still follow the original subscription rules.
CREATE OR REPLACE FUNCTION public.can_read_organization_data(p_org_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.user_is_org_member(p_org_id)
 AND NOT EXISTS(SELECT 1 FROM public.organization_eligibility WHERE organization_id=p_org_id AND status='rejected')
 AND (nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-atlas-product','') IS NULL
   OR EXISTS(SELECT 1 FROM atlas_private.workspace_products p WHERE p.organization_id=p_org_id AND p.product=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-atlas-product'));
$$;
-- Preserve the existing eligibility/date/edition write predicate, adding the product boundary.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.can_write_organization_operations(uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'public.user_is_org_member(p_org_id)','public.user_is_org_member(p_org_id) AND public.can_read_organization_data(p_org_id)');
 EXECUTE definition;
END $$;

-- Each specialty and school entry point verifies its fixed product even when the client omits headers.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('atlas_private.apply_industry_operation(uuid,text,uuid,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'  PERFORM pg_advisory_xact_lock',E'  IF NOT public.workspace_has_product(p_org,p_tool) THEN RAISE EXCEPTION ''This workspace subscription does not include this product'' USING ERRCODE=''42501''; END IF;\n  PERFORM pg_advisory_xact_lock'); EXECUTE definition;
 SELECT pg_get_functiondef('atlas_private.industry_workspace(uuid,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'  IF p_tool=',E'  IF NOT public.workspace_has_product(p_org,p_tool) THEN RAISE EXCEPTION ''This workspace subscription does not include this product'' USING ERRCODE=''42501''; END IF;\n  IF p_tool='); EXECUTE definition;
 SELECT pg_get_functiondef('atlas_school.actor_role(uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'WHERE auth.uid() IS NOT NULL', 'WHERE public.workspace_has_product(p_org,''school'') AND auth.uid() IS NOT NULL'); EXECUTE definition;
 SELECT pg_get_functiondef('public.create_online_sales_order(uuid,uuid,date,jsonb,text,uuid,text,text)'::regprocedure) INTO definition;
 definition:=replace(definition,E'BEGIN\n',E'BEGIN\n  IF NOT public.workspace_has_product(p_org_id,''ecommerce'') THEN RAISE EXCEPTION ''E-commerce product access required'' USING ERRCODE=''42501''; END IF;\n'); EXECUTE definition;
 SELECT pg_get_functiondef('atlas_private.record_online_dispatch(uuid,uuid,text,text,timestamptz)'::regprocedure) INTO definition;
 definition:=replace(definition,E'BEGIN\n',E'BEGIN\n  IF NOT public.workspace_has_product(p_org_id,''ecommerce'') THEN RAISE EXCEPTION ''E-commerce product access required'' USING ERRCODE=''42501''; END IF;\n'); EXECUTE definition;
END $$;

CREATE TABLE atlas_school.portal_links (
 organization_id uuid NOT NULL, user_id uuid NOT NULL, student_id uuid NOT NULL,
 portal text NOT NULL CHECK(portal IN ('parent','student')), linked_by uuid NOT NULL, linked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,user_id,student_id,portal),
 FOREIGN KEY(organization_id,user_id) REFERENCES public.memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,student_id) REFERENCES atlas_school.students(organization_id,id)
);
ALTER TABLE atlas_school.portal_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_school.portal_links FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION atlas_private.atlas_portal_access(p_org uuid,p_product text DEFAULT NULL,p_portal text DEFAULT 'workspace') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE product text; school_role text; portals jsonb:='[]';
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_read_organization_data(p_org) THEN RAISE EXCEPTION 'Workspace access required' USING ERRCODE='42501'; END IF;
 SELECT p.product INTO product FROM atlas_private.workspace_products p WHERE p.organization_id=p_org;
 IF product IS NULL THEN RAISE EXCEPTION 'The workspace product has not been bound. Contact support.' USING ERRCODE='42501'; END IF;
 IF product='school' THEN
   school_role:=atlas_school.actor_role(p_org);
   IF school_role IN ('owner','principal','school_admin') THEN portals:=portals||'"school_admin"'::jsonb; END IF;
   IF school_role IN ('owner','principal','school_admin','admissions') THEN portals:=portals||'"admissions"'::jsonb; END IF;
   IF school_role IN ('owner','principal','school_admin','teacher') THEN portals:=portals||'"teacher"'::jsonb; END IF;
   IF school_role IN ('owner','principal','school_admin','accountant') THEN portals:=portals||'"school_accounts"'::jsonb; END IF;
   IF school_role IN ('owner','principal','school_admin','teacher','accountant','admissions') THEN portals:=portals||'"workspace"'::jsonb; END IF;
   IF EXISTS(SELECT 1 FROM atlas_school.portal_links l WHERE l.organization_id=p_org AND l.user_id=auth.uid() AND l.portal='parent') THEN portals:=portals||'"parent"'::jsonb; END IF;
   IF EXISTS(SELECT 1 FROM atlas_school.portal_links l WHERE l.organization_id=p_org AND l.user_id=auth.uid() AND l.portal='student') THEN portals:=portals||'"student"'::jsonb; END IF;
 ELSE
   IF public.user_has_org_role(p_org,'owner','admin') THEN portals:=portals||'"owner"'::jsonb; END IF;
   IF (public.user_has_org_role(p_org,'owner','admin','sales','inventory','accounts') OR (public.user_has_org_role(p_org,'viewer') AND NOT EXISTS(SELECT 1 FROM atlas_private.staff_portal_members a WHERE a.organization_id=p_org AND a.user_id=auth.uid()))) THEN portals:=portals||'"workspace"'::jsonb; END IF;
 END IF;
 IF public.can_manage_staff_attendance(p_org) THEN portals:=portals||'"manager"'::jsonb; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_employee_accounts a WHERE a.organization_id=p_org AND a.user_id=auth.uid() AND a.is_active) THEN portals:=portals||'"employee"'::jsonb; END IF;
 RETURN jsonb_build_object('product',product,'portals',portals,'allowed',(p_product IS NULL OR p_product=product) AND portals ? p_portal);
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.atlas_portal_access(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.atlas_portal_access(uuid,text,text) TO authenticated;
CREATE FUNCTION public.atlas_portal_access(p_org uuid,p_product text DEFAULT NULL,p_portal text DEFAULT 'workspace') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.atlas_portal_access(p_org,p_product,p_portal); $$;
REVOKE ALL ON FUNCTION public.atlas_portal_access(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.atlas_portal_access(uuid,text,text) TO authenticated;

CREATE FUNCTION atlas_private.atlas_product_workspaces(p_product text,p_portal text DEFAULT 'workspace') RETURNS TABLE(organization_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE item record;
BEGIN
 FOR item IN SELECT p.organization_id FROM atlas_private.workspace_products p WHERE p.product=p_product AND public.user_is_org_member(p.organization_id) LOOP
  IF public.can_read_organization_data(item.organization_id) THEN
   IF coalesce((public.atlas_portal_access(item.organization_id,p_product,p_portal)->>'allowed')::boolean,false) THEN organization_id:=item.organization_id; RETURN NEXT; END IF;
  ELSIF public.user_has_org_role(item.organization_id,'owner') AND EXISTS(SELECT 1 FROM public.organization_eligibility e WHERE e.organization_id=item.organization_id AND e.status='rejected') AND p_portal IN ('workspace','owner','school_admin') THEN
   -- Owners retain the rejected-workspace identity recovery screen, not operational data.
   organization_id:=item.organization_id; RETURN NEXT;
  END IF;
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION atlas_private.atlas_product_workspaces(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.atlas_product_workspaces(text,text) TO authenticated;
CREATE FUNCTION public.atlas_product_workspaces(p_product text,p_portal text DEFAULT 'workspace') RETURNS TABLE(organization_id uuid) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM atlas_private.atlas_product_workspaces(p_product,p_portal); $$;
REVOKE ALL ON FUNCTION public.atlas_product_workspaces(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.atlas_product_workspaces(text,text) TO authenticated;

CREATE FUNCTION atlas_private.school_link_portal(p_org uuid,p_user uuid,p_student uuid,p_portal text,p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.workspace_has_product(p_org,'school') OR NOT public.user_has_org_role(p_org,'owner') OR (p_active IS DISTINCT FROM false AND public.can_write_organization_operations(p_org) IS NOT TRUE) THEN RAISE EXCEPTION 'School owner access required' USING ERRCODE='42501'; END IF;
 IF p_active IS NULL OR p_portal NOT IN ('parent','student') OR p_portal IS NULL OR (p_active AND NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.organization_id=p_org AND m.user_id=p_user AND m.is_active)) THEN RAISE EXCEPTION 'Choose an active member and parent/student portal' USING ERRCODE='22023'; END IF;
 IF p_active THEN INSERT INTO atlas_school.portal_links VALUES(p_org,p_user,p_student,p_portal,auth.uid(),now()) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM atlas_school.portal_links WHERE organization_id=p_org AND user_id=p_user AND student_id=p_student AND portal=p_portal; END IF;
 INSERT INTO atlas_school.audit(organization_id,actor,action,subject,before_data,after_data) VALUES(p_org,auth.uid(),'portal_link',p_student,NULL,jsonb_build_object('user_id',p_user,'portal',p_portal,'active',p_active));
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.school_link_portal(uuid,uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.school_link_portal(uuid,uuid,uuid,text,boolean) TO authenticated;
CREATE FUNCTION public.school_link_portal(p_org uuid,p_user uuid,p_student uuid,p_portal text,p_active boolean) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.school_link_portal(p_org,p_user,p_student,p_portal,p_active); $$;
REVOKE ALL ON FUNCTION public.school_link_portal(uuid,uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.school_link_portal(uuid,uuid,uuid,text,boolean) TO authenticated;

CREATE FUNCTION atlas_private.school_my_records(p_org uuid,p_portal text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce((public.atlas_portal_access(p_org,'school',p_portal)->>'allowed')::boolean,false) OR p_portal NOT IN ('parent','student') THEN RAISE EXCEPTION 'Linked parent/student access required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'admission_no',s.admission_no,
   'enrolments',coalesce((SELECT jsonb_agg(jsonb_build_object('year',y.name,'class',c.name,'section',c.section,
     'balance_paise',(SELECT coalesce(sum(b.total_paise-b.concession_paise-b.paid_paise),0) FROM atlas_school.charge_balances b WHERE b.organization_id=p_org AND b.enrolment_id=e.id),
     'attendance',coalesce((SELECT jsonb_agg(a) FROM (SELECT DISTINCT ON(a.day) a.day,a.status,a.reason FROM atlas_school.attendance a WHERE a.organization_id=p_org AND a.enrolment_id=e.id AND a.day>=(now() AT TIME ZONE 'Asia/Kolkata')::date-30 ORDER BY a.day DESC,a.revision DESC) a),'[]'),
     'receipts',coalesce((SELECT jsonb_agg(jsonb_build_object('number',r.receipt_no,'day',r.paid_on,'amount_paise',r.amount_paise,'returned_paise',(SELECT coalesce(sum(f.amount_paise),0) FROM atlas_school.refunds f WHERE f.organization_id=p_org AND f.receipt_id=r.id AND f.status='approved'))) FROM atlas_school.receipts r WHERE r.organization_id=p_org AND r.enrolment_id=e.id),'[]')) ORDER BY y.starts_on DESC)
     FROM atlas_school.enrolments e JOIN atlas_school.classes c ON c.id=e.class_id JOIN atlas_school.years y ON y.id=e.year_id WHERE e.organization_id=p_org AND e.student_id=s.id),'[]')) ORDER BY s.name),'[]')
 INTO result FROM atlas_school.students s WHERE s.organization_id=p_org AND EXISTS(SELECT 1 FROM atlas_school.portal_links l WHERE l.organization_id=p_org AND l.student_id=s.id AND l.user_id=auth.uid() AND l.portal=p_portal);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.school_my_records(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.school_my_records(uuid,text) TO authenticated;
CREATE FUNCTION public.school_my_records(p_org uuid,p_portal text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.school_my_records(p_org,p_portal); $$;
REVOKE ALL ON FUNCTION public.school_my_records(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.school_my_records(uuid,text) TO authenticated;

CREATE FUNCTION atlas_private.school_portal_links(p_org uuid,p_student uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.workspace_has_product(p_org,'school') OR NOT public.user_has_org_role(p_org,'owner') THEN RAISE EXCEPTION 'School owner access required' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',l.user_id,'portal',l.portal)) FROM atlas_school.portal_links l WHERE l.organization_id=p_org AND l.student_id=p_student),'[]');
END; $$;
REVOKE ALL ON FUNCTION atlas_private.school_portal_links(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.school_portal_links(uuid,uuid) TO authenticated;
CREATE FUNCTION public.school_portal_links(p_org uuid,p_student uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_private.school_portal_links(p_org,p_student); $$;
REVOKE ALL ON FUNCTION public.school_portal_links(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.school_portal_links(uuid,uuid) TO authenticated;
-- Business records are unavailable to a school subscription or an attendance-only viewer.
CREATE FUNCTION atlas_private.business_access(p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.can_read_organization_data(p_org)
 AND EXISTS(SELECT 1 FROM atlas_private.workspace_products p WHERE p.organization_id=p_org AND p.product<>'school')
 AND NOT (public.user_has_org_role(p_org,'viewer') AND EXISTS(SELECT 1 FROM atlas_private.staff_portal_members a WHERE a.organization_id=p_org AND a.user_id=auth.uid()));
$$;
REVOKE ALL ON FUNCTION atlas_private.business_access(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_private.business_access(uuid) TO authenticated;
DO $$ DECLARE item record; parent text; business_tables text[]:=ARRAY['products','customers','suppliers','stock_movements','quotations','sales_orders','invoices','payments','goods_receipts','purchase_orders','supplier_price_history','document_sequences','counter_shifts','counter_shift_payments','stock_count_sessions','stock_count_lines','opening_stock_batches','product_batches','godowns']; BEGIN
 FOR item IN SELECT t.table_name FROM information_schema.tables t JOIN information_schema.columns c ON c.table_schema=t.table_schema AND c.table_name=t.table_name WHERE t.table_schema='public' AND c.column_name='organization_id' AND t.table_name=ANY(business_tables) LOOP
   EXECUTE format('CREATE POLICY atlas_product_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (atlas_private.business_access(organization_id)) WITH CHECK (atlas_private.business_access(organization_id))',item.table_name);
 END LOOP;
 FOR item IN SELECT * FROM (VALUES('quotation_items','quotations','quotation_id'),('sales_order_items','sales_orders','sales_order_id'),('invoice_items','invoices','invoice_id'),('payment_allocations','payments','payment_id'),('goods_receipt_items','goods_receipts','goods_receipt_id'),('purchase_order_items','purchase_orders','purchase_order_id')) AS x(child,owner_table,parent_key) LOOP
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=item.child AND column_name=item.parent_key) THEN
   EXECUTE format('CREATE POLICY atlas_product_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.%I parent WHERE parent.id=%I AND atlas_private.business_access(parent.organization_id)))',item.child,item.owner_table,item.parent_key);
  END IF;
 END LOOP;
END $$;

-- Guard privileged business RPCs as well as raw tables. Preserve signatures and existing role/edition checks.
-- The classification is limited to org-scoped functions that directly reference business ledgers.
DO $$ DECLARE fn record; definition text; org_arg text; body text; BEGIN
 FOR fn IN SELECT p.*,n.nspname,l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname IN ('public','atlas_private') AND p.prosecdef AND p.prokind='f'
   AND p.proname !~ '(staff|payday|advance|salary|team|school|portal|workspace|platform|owner|eligibility|organization|business_access)'
   AND p.prosrc ~ '\m(products|customers|suppliers|stock_movements|quotations|sales_orders|invoices|payments|goods_receipts|purchase_orders|supplier_price_history|document_sequences|counter_shifts)\M'
 LOOP
  SELECT name INTO org_arg FROM unnest(fn.proargnames) name WHERE name IN ('p_org_id','p_org','p_organization_id') LIMIT 1;
  IF org_arg IS NULL THEN CONTINUE; END IF;
  definition:=pg_get_functiondef(fn.oid);
  IF fn.lanname='plpgsql' THEN
    definition:=regexp_replace(definition,E'BEGIN\r?\n',format(E'BEGIN\n  -- Atlas product boundary\n  IF NOT atlas_private.business_access(%I) THEN RAISE EXCEPTION ''Business product access required'' USING ERRCODE=''42501''; END IF;\n',org_arg));
    EXECUTE definition;
  ELSIF fn.lanname='sql' AND fn.provolatile='s' AND btrim(fn.prosrc) ~* '^(SELECT|WITH)' THEN
    body:=regexp_replace(btrim(fn.prosrc),';\s*$','');
    definition:=replace(definition,fn.prosrc,format('SELECT atlas_result.* FROM (%s) atlas_result WHERE atlas_private.business_access(%I)',body,org_arg));
    EXECUTE definition;
  END IF;
 END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
