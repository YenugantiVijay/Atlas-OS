BEGIN;
CREATE TABLE atlas_school.staff_timetables (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,staff_id uuid NOT NULL,
 revision integer NOT NULL,effective_on date NOT NULL CHECK(isfinite(effective_on)),
 entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array' AND jsonb_array_length(entries) BETWEEN 1 AND 150),
 filename text NOT NULL CHECK(char_length(filename) BETWEEN 6 AND 120 AND filename ~* '^[a-z0-9 _().-]+\.xlsx$'),
 original_base64 text NOT NULL CHECK(char_length(original_base64) BETWEEN 8 AND 1398104),
 published_by uuid NOT NULL,published_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,staff_id) REFERENCES atlas_school.staff_identity(organization_id,staff_id),
 UNIQUE(organization_id,staff_id,revision)
);
CREATE INDEX school_timetable_effective ON atlas_school.staff_timetables(organization_id,staff_id,effective_on DESC,revision DESC);
ALTER TABLE atlas_school.staff_timetables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_school.staff_timetables FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION atlas_school.timetable_read(p_org uuid,p_staff uuid DEFAULT NULL,p_on date DEFAULT CURRENT_DATE,p_version uuid DEFAULT NULL,p_page integer DEFAULT 1,p_download boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE staff uuid:=p_staff; authority boolean; current_record jsonb; history jsonb; latest uuid;
BEGIN
 IF auth.uid() IS NULL OR public.can_read_organization_data(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,'school') IS NOT TRUE THEN RAISE EXCEPTION 'School access required' USING ERRCODE='42501'; END IF;
 authority:=coalesce(atlas_school.actor_role(p_org) IN ('owner','principal','school_admin'),false);
 IF staff IS NULL THEN SELECT a.staff_id INTO staff FROM public.staff_employee_accounts a WHERE a.organization_id=p_org AND a.user_id=auth.uid() AND a.is_active; END IF;
 IF staff IS NULL THEN RETURN jsonb_build_object('current',null,'history','[]'::jsonb,'latest_id',null,'can_publish',authority); END IF;
 IF NOT authority AND NOT EXISTS(SELECT 1 FROM public.staff_employee_accounts a WHERE a.organization_id=p_org AND a.staff_id=staff AND a.user_id=auth.uid() AND a.is_active) THEN RAISE EXCEPTION 'Own active staff timetable required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM atlas_school.staff_identity s WHERE s.organization_id=p_org AND s.staff_id=staff) THEN RAISE EXCEPTION 'School staff ID required' USING ERRCODE='42501'; END IF;
 IF p_on IS NULL OR NOT isfinite(p_on) OR p_page IS NULL OR p_page<1 OR p_page>100000 THEN RAISE EXCEPTION 'Valid date and page required' USING ERRCODE='22023'; END IF;
 SELECT t.id INTO latest FROM atlas_school.staff_timetables t WHERE t.organization_id=p_org AND t.staff_id=staff ORDER BY t.revision DESC LIMIT 1;
 SELECT jsonb_build_object('id',t.id,'revision',t.revision,'effective_on',t.effective_on,'entries',t.entries,'filename',t.filename,'published_at',t.published_at,'original_base64',CASE WHEN p_download THEN t.original_base64 ELSE NULL END) INTO current_record
 FROM atlas_school.staff_timetables t WHERE t.organization_id=p_org AND t.staff_id=staff AND (CASE WHEN p_version IS NOT NULL THEN t.id=p_version ELSE t.effective_on<=p_on END)
 ORDER BY t.effective_on DESC,t.revision DESC LIMIT 1;
 IF p_version IS NOT NULL AND current_record IS NULL THEN RAISE EXCEPTION 'Timetable version unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO history FROM (
  SELECT t.id,t.revision,t.effective_on,t.filename,t.published_at FROM atlas_school.staff_timetables t WHERE t.organization_id=p_org AND t.staff_id=staff ORDER BY t.revision DESC LIMIT 25 OFFSET(p_page-1)*25
 ) r;
 RETURN jsonb_build_object('current',current_record,'history',history,'latest_id',latest,'can_publish',authority);
END $$;

CREATE FUNCTION atlas_school.timetable_publish(p_org uuid,p_staff uuid,p_id uuid,p_expected uuid,p_effective date,p_entries jsonb,p_filename text,p_original text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE latest uuid; next_revision integer; item jsonb; old atlas_school.staff_timetables; decoded bytea;
BEGIN
 IF auth.uid() IS NULL OR public.can_write_organization_operations(p_org) IS NOT TRUE OR public.workspace_has_product(p_org,'school') IS NOT TRUE OR coalesce(atlas_school.actor_role(p_org) IN ('owner','principal','school_admin'),false) IS NOT TRUE THEN RAISE EXCEPTION 'School administrator required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM atlas_school.staff_identity WHERE organization_id=p_org AND staff_id=p_staff) THEN RAISE EXCEPTION 'School staff ID required' USING ERRCODE='42501'; END IF;
 IF p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 150 OR p_original IS NULL OR char_length(p_original)>1398104 THEN RAISE EXCEPTION 'Use 1–150 periods and an Excel file up to 1 MB' USING ERRCODE='22023'; END IF;
 decoded:=decode(p_original,'base64');
 IF octet_length(decoded)>1048576 OR octet_length(decoded)<4 OR substring(decoded FROM 1 FOR 4)<>decode('504b0304','hex') THEN RAISE EXCEPTION 'Invalid Excel file' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'day') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'end') IS DISTINCT FROM 'number' OR EXISTS(SELECT 1 FROM unnest(ARRAY['activity','class','section','subject','room']) k WHERE jsonb_typeof(item->k) IS DISTINCT FROM 'string') OR (item->>'day') IS NULL OR (item->>'day')!~'^[1-7]$' OR coalesce(item->>'activity','') NOT IN ('teaching','break','free','duty')
   OR coalesce(item->>'start','')!~'^[0-9]{1,4}$' OR coalesce(item->>'end','')!~'^[0-9]{1,4}$'
   OR (item->>'start')::int NOT BETWEEN 0 AND 1439 OR (item->>'end')::int NOT BETWEEN 1 AND 1440 OR (item->>'end')::int<=(item->>'start')::int
   OR char_length(coalesce(item->>'class',''))>80 OR char_length(coalesce(item->>'section',''))>40 OR char_length(coalesce(item->>'subject',''))>100 OR char_length(coalesce(item->>'room',''))>80
   OR (item->>'activity'='teaching' AND (btrim(coalesce(item->>'class',''))='' OR btrim(coalesce(item->>'subject',''))='')) THEN RAISE EXCEPTION 'Invalid period; teaching requires class and subject' USING ERRCODE='22023'; END IF;
  IF (item - ARRAY['day','start','end','activity','class','section','subject','room'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Unexpected timetable fields' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) WITH ORDINALITY a(item,n) JOIN jsonb_array_elements(p_entries) WITH ORDINALITY b(item,n) ON a.n<b.n AND a.item->>'day'=b.item->>'day' AND (a.item->>'start')::int<(b.item->>'end')::int AND (b.item->>'start')::int<(a.item->>'end')::int) THEN RAISE EXCEPTION 'Timetable periods overlap' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||p_staff::text||'timetable',0));
 SELECT * INTO old FROM atlas_school.staff_timetables WHERE id=p_id;
 IF FOUND THEN
  IF old.organization_id=p_org AND old.staff_id=p_staff AND old.effective_on=p_effective AND old.entries=p_entries AND old.filename=p_filename AND old.original_base64=p_original THEN RETURN; END IF;
  RAISE EXCEPTION 'Timetable request ID already used' USING ERRCODE='23505';
 END IF;
 SELECT t.id,t.revision+1 INTO latest,next_revision FROM atlas_school.staff_timetables t WHERE t.organization_id=p_org AND t.staff_id=p_staff ORDER BY t.revision DESC LIMIT 1;
 IF latest IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Timetable changed; refresh and review before publishing' USING ERRCODE='40001'; END IF;
 INSERT INTO atlas_school.staff_timetables(id,organization_id,staff_id,revision,effective_on,entries,filename,original_base64,published_by) VALUES(p_id,p_org,p_staff,coalesce(next_revision,1),p_effective,p_entries,p_filename,p_original,auth.uid());
END $$;
CREATE FUNCTION public.school_timetable_read(p_org uuid,p_staff uuid DEFAULT NULL,p_on date DEFAULT CURRENT_DATE,p_version uuid DEFAULT NULL,p_page integer DEFAULT 1,p_download boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_school.timetable_read(p_org,p_staff,p_on,p_version,p_page,p_download); $$;
CREATE FUNCTION public.school_timetable_publish(p_org uuid,p_staff uuid,p_id uuid,p_expected uuid,p_effective date,p_entries jsonb,p_filename text,p_original text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_school.timetable_publish(p_org,p_staff,p_id,p_expected,p_effective,p_entries,p_filename,p_original); $$;
REVOKE ALL ON FUNCTION atlas_school.timetable_read(uuid,uuid,date,uuid,integer,boolean),public.school_timetable_read(uuid,uuid,date,uuid,integer,boolean),atlas_school.timetable_publish(uuid,uuid,uuid,uuid,date,jsonb,text,text),public.school_timetable_publish(uuid,uuid,uuid,uuid,date,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_school.timetable_read(uuid,uuid,date,uuid,integer,boolean),public.school_timetable_read(uuid,uuid,date,uuid,integer,boolean),atlas_school.timetable_publish(uuid,uuid,uuid,uuid,date,jsonb,text,text),public.school_timetable_publish(uuid,uuid,uuid,uuid,date,jsonb,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
