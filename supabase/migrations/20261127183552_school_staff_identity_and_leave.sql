BEGIN;
CREATE TABLE atlas_school.staff_identity (
 organization_id uuid NOT NULL, staff_id uuid NOT NULL, school_id text NOT NULL,
 position text NOT NULL CHECK(position IN ('principal','teacher','accountant','office_staff','support_staff','school_admin')),
 revision integer NOT NULL DEFAULT 1, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,staff_id),
 FOREIGN KEY(organization_id,staff_id) REFERENCES public.staff_profiles(organization_id,id),
 CHECK(school_id=btrim(school_id) AND school_id ~ '^[A-Za-z0-9][A-Za-z0-9/-]{0,39}$')
);
CREATE UNIQUE INDEX school_staff_unique_id ON atlas_school.staff_identity(organization_id,lower(school_id));
CREATE TABLE atlas_school.staff_identity_history (
 organization_id uuid NOT NULL, staff_id uuid NOT NULL, revision integer NOT NULL, school_id text NOT NULL, position text NOT NULL,
 changed_by uuid NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,staff_id,revision)
);
CREATE TABLE atlas_school.staff_leave (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, staff_id uuid NOT NULL, requested_by uuid NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL, reason text NOT NULL CHECK(char_length(reason) BETWEEN 5 AND 500),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 reviewed_by uuid, review_note text, requested_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 FOREIGN KEY(organization_id,staff_id) REFERENCES public.staff_profiles(organization_id,id),
 CHECK(isfinite(starts_on) AND isfinite(ends_on) AND ends_on>=starts_on AND ends_on-starts_on<=365)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['staff_identity','staff_identity_history','staff_leave'] LOOP
 EXECUTE format('ALTER TABLE atlas_school.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON atlas_school.%I FROM PUBLIC,anon,authenticated,service_role',t);
END LOOP; END $$;

CREATE FUNCTION atlas_school.staff_read(p_org uuid,p_area text,p_page integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE manage boolean; admin_access boolean; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.can_read_organization_data(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,'school') IS NOT TRUE THEN RAISE EXCEPTION 'School access required' USING ERRCODE='42501'; END IF;
 manage:=public.can_manage_staff_attendance(p_org);
 admin_access:=coalesce(atlas_school.actor_role(p_org) IN ('owner','principal','school_admin'),false);
 IF p_page IS NULL OR p_page<1 OR p_page>100000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 IF p_area='unregistered' THEN
  IF NOT admin_access THEN RAISE EXCEPTION 'School authority required' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(r)),'[]'),'can_review',manage) INTO result FROM (
   SELECT p.id AS staff_id,p.display_name,p.joining_on FROM public.staff_profiles p WHERE p.organization_id=p_org AND NOT EXISTS(SELECT 1 FROM atlas_school.staff_identity s WHERE s.organization_id=p_org AND s.staff_id=p.id)
   ORDER BY p.display_name,p.id LIMIT 25 OFFSET (p_page-1)*25
  ) r; RETURN result;
 ELSIF p_area IN ('directory','self') THEN
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(r)),'[]'),'can_register',admin_access,'can_review',manage) INTO result FROM (
   SELECT s.staff_id,s.school_id,s.position,s.revision,p.display_name,p.joining_on,a.user_id,a.is_active
   FROM atlas_school.staff_identity s JOIN public.staff_profiles p ON p.organization_id=s.organization_id AND p.id=s.staff_id
   LEFT JOIN public.staff_employee_accounts a ON a.organization_id=s.organization_id AND a.staff_id=s.staff_id
   WHERE s.organization_id=p_org AND ((p_area='directory' AND (admin_access OR manage)) OR (a.user_id=auth.uid() AND a.is_active))
   ORDER BY lower(s.school_id),s.staff_id LIMIT 25 OFFSET (p_page-1)*25
  ) r; RETURN result;
 ELSIF p_area='leave' THEN
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(r)),'[]'),'can_review',manage) INTO result FROM (
   SELECT l.*,s.school_id,p.display_name FROM atlas_school.staff_leave l
   JOIN atlas_school.staff_identity s USING(organization_id,staff_id)
   JOIN public.staff_profiles p ON p.organization_id=l.organization_id AND p.id=l.staff_id
   WHERE l.organization_id=p_org AND (manage OR (l.requested_by=auth.uid() AND EXISTS(SELECT 1 FROM public.staff_employee_accounts a WHERE a.organization_id=p_org AND a.staff_id=l.staff_id AND a.user_id=auth.uid() AND a.is_active)))
   ORDER BY l.requested_at DESC,l.id LIMIT 25 OFFSET (p_page-1)*25
  ) r; RETURN result;
 END IF;
 RAISE EXCEPTION 'Unknown school staff area' USING ERRCODE='22023';
END $$;

CREATE FUNCTION atlas_school.staff_command(p_org uuid,p_action text,p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE staff uuid; card text; pos text; old atlas_school.staff_identity; req atlas_school.staff_leave; loc uuid;
BEGIN
 IF auth.uid() IS NULL OR public.can_write_organization_operations(p_org) IS NOT TRUE OR NOT public.workspace_has_product(p_org,'school') THEN RAISE EXCEPTION 'Writable school access required' USING ERRCODE='42501'; END IF;
 IF p_action='register' THEN
  IF coalesce(atlas_school.actor_role(p_org) IN ('owner','principal','school_admin'),false) IS NOT TRUE THEN RAISE EXCEPTION 'School authority required' USING ERRCODE='42501'; END IF;
  staff:=(p_data->>'staff_id')::uuid; card:=btrim(p_data->>'school_id'); pos:=p_data->>'position';
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||staff::text,0));
  SELECT * INTO old FROM atlas_school.staff_identity WHERE organization_id=p_org AND staff_id=staff FOR UPDATE;
  IF FOUND THEN
   IF old.revision IS DISTINCT FROM (p_data->>'revision')::integer THEN RAISE EXCEPTION 'Staff record changed; refresh before saving' USING ERRCODE='40001'; END IF;
   IF old.school_id IS DISTINCT FROM card THEN RAISE EXCEPTION 'School ID is permanent; change the position instead' USING ERRCODE='22023'; END IF;
   UPDATE atlas_school.staff_identity SET position=pos,revision=revision+1,updated_by=auth.uid(),updated_at=now() WHERE organization_id=p_org AND staff_id=staff;
  ELSE
   IF coalesce((p_data->>'revision')::integer,0)<>0 THEN RAISE EXCEPTION 'Staff record missing' USING ERRCODE='40001'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE organization_id=p_org AND id=staff) THEN
    INSERT INTO public.staff_profiles(id,organization_id,display_name,joining_on) VALUES(staff,p_org,btrim(p_data->>'name'),(p_data->>'joining_on')::date);
   END IF;
   INSERT INTO atlas_school.staff_identity(organization_id,staff_id,school_id,position,updated_by) VALUES(p_org,staff,card,pos,auth.uid());
   INSERT INTO public.staff_locations(id,organization_id,name) VALUES(gen_random_uuid(),p_org,'School campus') ON CONFLICT DO NOTHING;
   SELECT id INTO loc FROM public.staff_locations WHERE organization_id=p_org AND lower(name)='school campus';
   INSERT INTO public.staff_location_assignments(organization_id,staff_id,location_id) VALUES(p_org,staff,loc) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO atlas_school.staff_identity_history SELECT organization_id,staff_id,revision,school_id,position,updated_by,updated_at FROM atlas_school.staff_identity WHERE organization_id=p_org AND staff_id=staff;
 ELSIF p_action='request_leave' THEN
  SELECT a.staff_id INTO staff FROM public.staff_employee_accounts a JOIN atlas_school.staff_identity s USING(organization_id,staff_id) WHERE a.organization_id=p_org AND a.user_id=auth.uid() AND a.is_active FOR UPDATE OF a;
  IF staff IS NULL THEN RAISE EXCEPTION 'Active school staff link required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||staff::text,0));
  IF EXISTS(SELECT 1 FROM atlas_school.staff_leave l WHERE l.organization_id=p_org AND l.staff_id=staff AND l.status IN ('pending','approved') AND l.starts_on<=(p_data->>'ends_on')::date AND l.ends_on>=(p_data->>'starts_on')::date) THEN RAISE EXCEPTION 'Leave dates overlap an existing request' USING ERRCODE='22023'; END IF;
  INSERT INTO atlas_school.staff_leave(id,organization_id,staff_id,requested_by,starts_on,ends_on,reason) VALUES((p_data->>'id')::uuid,p_org,staff,auth.uid(),(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,btrim(p_data->>'reason'));
 ELSIF p_action IN ('review_leave','cancel_leave') THEN
  SELECT * INTO req FROM atlas_school.staff_leave WHERE organization_id=p_org AND id=(p_data->>'id')::uuid FOR UPDATE;
  IF req.id IS NULL OR req.status<>'pending' THEN RAISE EXCEPTION 'Pending request required; refresh records' USING ERRCODE='22023'; END IF;
  IF p_action='cancel_leave' THEN
   IF req.requested_by<>auth.uid() OR NOT EXISTS(SELECT 1 FROM public.staff_employee_accounts a WHERE a.organization_id=p_org AND a.staff_id=req.staff_id AND a.user_id=auth.uid() AND a.is_active) THEN RAISE EXCEPTION 'Own active staff request required' USING ERRCODE='42501'; END IF;
   UPDATE atlas_school.staff_leave SET status='cancelled',reviewed_at=now() WHERE id=req.id;
  ELSE
   IF public.can_manage_staff_attendance(p_org) IS NOT TRUE OR req.requested_by=auth.uid() THEN RAISE EXCEPTION 'Another attendance manager must review this request' USING ERRCODE='42501'; END IF;
   IF coalesce(p_data->>'status','') NOT IN ('approved','rejected') OR char_length(btrim(coalesce(p_data->>'note',''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Decision and review reason required' USING ERRCODE='22023'; END IF;
   UPDATE atlas_school.staff_leave SET status=p_data->>'status',reviewed_by=auth.uid(),review_note=btrim(p_data->>'note'),reviewed_at=now() WHERE id=req.id;
  END IF;
 ELSE RAISE EXCEPTION 'Unknown school staff action' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION public.school_staff_read(p_org uuid,p_area text,p_page integer DEFAULT 1) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_school.staff_read(p_org,p_area,p_page); $$;
CREATE FUNCTION public.school_staff_command(p_org uuid,p_action text,p_data jsonb) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_school.staff_command(p_org,p_action,p_data); $$;
REVOKE ALL ON FUNCTION atlas_school.staff_read(uuid,text,integer),atlas_school.staff_command(uuid,text,jsonb),public.school_staff_read(uuid,text,integer),public.school_staff_command(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_school.staff_read(uuid,text,integer),atlas_school.staff_command(uuid,text,jsonb),public.school_staff_read(uuid,text,integer),public.school_staff_command(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
