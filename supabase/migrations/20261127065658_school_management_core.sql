BEGIN;
CREATE SCHEMA atlas_school;
REVOKE ALL ON SCHEMA atlas_school FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA atlas_school TO authenticated;

CREATE TABLE atlas_school.settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
  address text NOT NULL DEFAULT '' CHECK (char_length(address)<=1000),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone)<=30),
  email text NOT NULL DEFAULT '' CHECK (char_length(email)<=150),
  logo_url text NOT NULL DEFAULT '' CHECK (logo_url='' OR logo_url ~ '^https://'),
  board text NOT NULL DEFAULT '' CHECK (char_length(board)<=100),
  grading_notes text NOT NULL DEFAULT '' CHECK(char_length(grading_notes)<=1000),
  receipt_prefix text NOT NULL DEFAULT 'SCH' CHECK (receipt_prefix ~ '^[A-Z0-9-]{1,12}$'),
  next_receipt bigint NOT NULL DEFAULT 1 CHECK (next_receipt>0)
);
CREATE TABLE atlas_school.roles (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('principal','school_admin','admissions','teacher','accountant')),
  PRIMARY KEY(organization_id,user_id),
  FOREIGN KEY(organization_id,user_id) REFERENCES public.memberships(organization_id,user_id)
);
CREATE TABLE atlas_school.years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES atlas_school.settings(organization_id),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  starts_on date NOT NULL CHECK (isfinite(starts_on)), ends_on date NOT NULL CHECK (isfinite(ends_on)),
  CHECK(ends_on>=starts_on), UNIQUE(organization_id,id), UNIQUE(organization_id,name)
);
CREATE TABLE atlas_school.terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, year_id uuid NOT NULL,
  name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 80), starts_on date NOT NULL, ends_on date NOT NULL,
  CHECK(isfinite(starts_on) AND isfinite(ends_on) AND ends_on>=starts_on),
  FOREIGN KEY(organization_id,year_id) REFERENCES atlas_school.years(organization_id,id),
  UNIQUE(organization_id,year_id,name)
);
CREATE TABLE atlas_school.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, year_id uuid NOT NULL,
  name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 80),
  section text NOT NULL CHECK(char_length(btrim(section)) BETWEEN 1 AND 40),
  FOREIGN KEY(organization_id,year_id) REFERENCES atlas_school.years(organization_id,id),
  UNIQUE(organization_id,id), UNIQUE(organization_id,year_id,id), UNIQUE(organization_id,year_id,name,section)
);
CREATE TABLE atlas_school.teacher_classes (
  organization_id uuid NOT NULL, user_id uuid NOT NULL, class_id uuid NOT NULL,
  PRIMARY KEY(organization_id,user_id,class_id),
  FOREIGN KEY(organization_id,user_id) REFERENCES atlas_school.roles(organization_id,user_id),
  FOREIGN KEY(organization_id,class_id) REFERENCES atlas_school.classes(organization_id,id)
);
CREATE TABLE atlas_school.calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, year_id uuid NOT NULL,
  day date NOT NULL CHECK(isfinite(day)), label text NOT NULL CHECK(char_length(btrim(label)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK(kind IN ('holiday','event','working_day')),
  FOREIGN KEY(organization_id,year_id) REFERENCES atlas_school.years(organization_id,id),
  UNIQUE(organization_id,year_id,day,label)
);
CREATE TABLE atlas_school.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES atlas_school.settings(organization_id),
  admission_no text NOT NULL CHECK(char_length(btrim(admission_no)) BETWEEN 1 AND 40),
  name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 150), dob date CHECK(isfinite(dob)),
  guardian_name text NOT NULL CHECK(char_length(btrim(guardian_name)) BETWEEN 1 AND 150),
  guardian_phone text NOT NULL CHECK(char_length(btrim(guardian_phone)) BETWEEN 5 AND 30),
  guardian_email text NOT NULL DEFAULT '' CHECK(char_length(guardian_email)<=150),
  address text NOT NULL DEFAULT '' CHECK(char_length(address)<=1000),
  previous_school text NOT NULL DEFAULT '' CHECK(char_length(previous_school)<=150),
  joining_on date NOT NULL CHECK(isfinite(joining_on)),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,admission_no)
);
CREATE TABLE atlas_school.enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, student_id uuid NOT NULL,
  year_id uuid NOT NULL, class_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),
  FOREIGN KEY(organization_id,student_id) REFERENCES atlas_school.students(organization_id,id),
  FOREIGN KEY(organization_id,year_id,class_id) REFERENCES atlas_school.classes(organization_id,year_id,id),
  UNIQUE(organization_id,student_id,year_id), UNIQUE(organization_id,id), UNIQUE(organization_id,class_id,id)
);
CREATE TABLE atlas_school.admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES atlas_school.settings(organization_id),
  applicant text NOT NULL CHECK(char_length(btrim(applicant)) BETWEEN 1 AND 150),
  guardian_name text NOT NULL CHECK(char_length(btrim(guardian_name)) BETWEEN 1 AND 150),
  phone text NOT NULL CHECK(char_length(btrim(phone)) BETWEEN 5 AND 30),
  desired_class text NOT NULL DEFAULT '' CHECK(char_length(desired_class)<=80),
  note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),
  status text NOT NULL DEFAULT 'enquiry' CHECK(status IN ('enquiry','application','review','approved','rejected','admitted')),
  student_id uuid, revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,student_id) REFERENCES atlas_school.students(organization_id,id),
  UNIQUE(organization_id,id)
);
CREATE TABLE atlas_school.attendance (
  organization_id uuid NOT NULL, enrolment_id uuid NOT NULL, class_id uuid NOT NULL, day date NOT NULL CHECK(isfinite(day)),
  revision integer NOT NULL CHECK(revision>0), status text NOT NULL CHECK(status IN ('present','absent','late','half_day','leave')),
  reason text NOT NULL DEFAULT '' CHECK(char_length(reason)<=1000),
  recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,enrolment_id,day,revision),
  FOREIGN KEY(organization_id,class_id,enrolment_id) REFERENCES atlas_school.enrolments(organization_id,class_id,id)
);
CREATE TABLE atlas_school.fee_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES atlas_school.settings(organization_id),
  name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 100), UNIQUE(organization_id,id), UNIQUE(organization_id,name)
);
CREATE TABLE atlas_school.fee_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, class_id uuid NOT NULL, category_id uuid NOT NULL,
  label text NOT NULL CHECK(char_length(btrim(label)) BETWEEN 1 AND 100), due_on date NOT NULL CHECK(isfinite(due_on)),
  amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 99999999999),
  tax_basis_points integer NOT NULL DEFAULT 0 CHECK(tax_basis_points BETWEEN 0 AND 10000),
  tax_note text NOT NULL CHECK(char_length(btrim(tax_note)) BETWEEN 1 AND 300),
  FOREIGN KEY(organization_id,class_id) REFERENCES atlas_school.classes(organization_id,id),
  FOREIGN KEY(organization_id,category_id) REFERENCES atlas_school.fee_categories(organization_id,id),
  UNIQUE(organization_id,id), UNIQUE(organization_id,class_id,category_id,label,due_on)
);
CREATE TABLE atlas_school.charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, enrolment_id uuid NOT NULL, schedule_id uuid,
  label text NOT NULL, due_on date NOT NULL, base_paise bigint NOT NULL CHECK(base_paise>0),
  tax_paise bigint NOT NULL CHECK(tax_paise>=0), tax_basis_points integer NOT NULL, tax_note text NOT NULL,
  FOREIGN KEY(organization_id,enrolment_id) REFERENCES atlas_school.enrolments(organization_id,id),
  FOREIGN KEY(organization_id,schedule_id) REFERENCES atlas_school.fee_schedules(organization_id,id),
  UNIQUE(organization_id,id), UNIQUE(organization_id,enrolment_id,schedule_id)
);
CREATE TABLE atlas_school.concessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, charge_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK(amount_paise>0), reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 1000),
  requested_by uuid NOT NULL, reviewed_by uuid, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,charge_id) REFERENCES atlas_school.charges(organization_id,id), UNIQUE(organization_id,id)
);
CREATE TABLE atlas_school.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, enrolment_id uuid NOT NULL,
  receipt_no text NOT NULL, paid_on date NOT NULL CHECK(isfinite(paid_on)), method text NOT NULL CHECK(method IN ('cash','upi','bank','cheque')),
  reference text NOT NULL DEFAULT '' CHECK(char_length(reference)<=200),
  amount_paise bigint NOT NULL CHECK(amount_paise>0), recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  school_snapshot jsonb NOT NULL, student_snapshot jsonb NOT NULL,
  FOREIGN KEY(organization_id,enrolment_id) REFERENCES atlas_school.enrolments(organization_id,id),
  UNIQUE(organization_id,id), UNIQUE(organization_id,receipt_no)
);
CREATE TABLE atlas_school.allocations (
  organization_id uuid NOT NULL, receipt_id uuid NOT NULL, charge_id uuid NOT NULL, amount_paise bigint NOT NULL CHECK(amount_paise>0),
  PRIMARY KEY(organization_id,receipt_id,charge_id),
  FOREIGN KEY(organization_id,receipt_id) REFERENCES atlas_school.receipts(organization_id,id),
  FOREIGN KEY(organization_id,charge_id) REFERENCES atlas_school.charges(organization_id,id)
);
CREATE TABLE atlas_school.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, receipt_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK(amount_paise>0), kind text NOT NULL CHECK(kind IN ('refund','reversal')),
  reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 1000), method text NOT NULL CHECK(method IN ('cash','upi','bank','cheque')),
  reference text NOT NULL DEFAULT '' CHECK(char_length(reference)<=200), refunded_on date NOT NULL CHECK(isfinite(refunded_on)),
  requested_by uuid NOT NULL, reviewed_by uuid, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
  FOREIGN KEY(organization_id,receipt_id) REFERENCES atlas_school.receipts(organization_id,id), UNIQUE(organization_id,id)
);
CREATE TABLE atlas_school.refund_allocations (
  organization_id uuid NOT NULL, refund_id uuid NOT NULL, receipt_id uuid NOT NULL, charge_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK(amount_paise>0), PRIMARY KEY(organization_id,refund_id,charge_id),
  FOREIGN KEY(organization_id,refund_id) REFERENCES atlas_school.refunds(organization_id,id),
  FOREIGN KEY(organization_id,receipt_id,charge_id) REFERENCES atlas_school.allocations(organization_id,receipt_id,charge_id)
);
CREATE TABLE atlas_school.operations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id), request_id uuid NOT NULL,
  actor uuid NOT NULL, action text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,request_id)
);
CREATE TABLE atlas_school.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid NOT NULL, actor uuid NOT NULL,
  action text NOT NULL, subject uuid, before_data jsonb, after_data jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE item text; BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='atlas_school' LOOP
    EXECUTE format('ALTER TABLE atlas_school.%I ENABLE ROW LEVEL SECURITY',item);
    EXECUTE format('REVOKE ALL ON atlas_school.%I FROM PUBLIC,anon,authenticated,service_role',item);
  END LOOP;
END $$;
CREATE INDEX school_students_search ON atlas_school.students(organization_id,admission_no,name);
CREATE INDEX school_enrolments_class ON atlas_school.enrolments(organization_id,class_id,status);
CREATE INDEX school_attendance_day ON atlas_school.attendance(organization_id,class_id,day,enrolment_id,revision DESC);
CREATE INDEX school_receipts_period ON atlas_school.receipts(organization_id,paid_on,id);
CREATE INDEX school_charges_student ON atlas_school.charges(organization_id,enrolment_id,due_on);

CREATE FUNCTION atlas_school.actor_role(p_org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN public.user_has_org_role(p_org,'owner') THEN 'owner' ELSE
    (SELECT r.role FROM atlas_school.roles r WHERE r.organization_id=p_org AND r.user_id=auth.uid()) END
  WHERE auth.uid() IS NOT NULL AND public.can_read_organization_data(p_org);
$$;
REVOKE ALL ON FUNCTION atlas_school.actor_role(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION atlas_school.class_allowed(p_org uuid,p_class uuid,p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_role IN ('owner','principal','school_admin','admissions','accountant') OR (p_role='teacher' AND EXISTS (
   SELECT 1 FROM atlas_school.teacher_classes t WHERE t.organization_id=p_org AND t.class_id=p_class AND t.user_id=auth.uid()));
$$;
REVOKE ALL ON FUNCTION atlas_school.class_allowed(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE VIEW atlas_school.charge_balances WITH (security_invoker=true) AS
SELECT c.*, c.base_paise+c.tax_paise AS total_paise,
 coalesce((SELECT sum(a.amount_paise) FROM atlas_school.concessions a WHERE a.organization_id=c.organization_id AND a.charge_id=c.id AND a.status='approved'),0)::bigint AS concession_paise,
 coalesce((SELECT sum(a.amount_paise) FROM atlas_school.allocations a WHERE a.organization_id=c.organization_id AND a.charge_id=c.id),0)::bigint -
 coalesce((SELECT sum(a.amount_paise) FROM atlas_school.refund_allocations a JOIN atlas_school.refunds r ON r.organization_id=a.organization_id AND r.id=a.refund_id
   WHERE a.organization_id=c.organization_id AND a.charge_id=c.id AND r.status='approved'),0)::bigint AS paid_paise
FROM atlas_school.charges c;
REVOKE ALL ON atlas_school.charge_balances FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION atlas_school.apply(p_org uuid,p_action text,p_data jsonb,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  who uuid := auth.uid(); access_role text := atlas_school.actor_role(p_org);
  result jsonb; old jsonb; item jsonb; entry jsonb; found_request atlas_school.operations;
  target uuid; student uuid; enrolment uuid; class_id uuid; year_id uuid; receipt uuid;
  amount bigint; available bigint; remaining bigint; portion bigint; refundable bigint;
  row_revision integer; expected_revision integer; fee atlas_school.charge_balances;
  old_admission atlas_school.admissions; old_receipt atlas_school.receipts; school atlas_school.settings;
  refund atlas_school.refunds; concession atlas_school.concessions; schedule atlas_school.fee_schedules;
  local_today date := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF who IS NULL OR access_role IS NULL OR public.can_write_organization_operations(p_org) IS NOT TRUE THEN
    RAISE EXCEPTION 'School writes require an authorized member and an active workspace' USING ERRCODE='42501';
  END IF;
  IF p_request IS NULL OR p_action IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>500000 THEN
    RAISE EXCEPTION 'Invalid school operation request' USING ERRCODE='22023';
  END IF;
  -- Serialize financial allocations, numbering, admission conversion and revisions.
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-school:'||p_org::text,0));
  IF p_action='role' AND access_role<>'owner' THEN
    RAISE EXCEPTION 'Only the workspace owner can assign school permissions' USING ERRCODE='42501';
  ELSIF p_action IN ('settings','year','term','class','calendar') AND access_role NOT IN ('owner','principal','school_admin') THEN
    RAISE EXCEPTION 'School administration permission required' USING ERRCODE='42501';
  ELSIF p_action IN ('student','student_update','students_import','enrol','admission','admission_stage','admit') AND access_role NOT IN ('owner','principal','school_admin','admissions') THEN
    RAISE EXCEPTION 'Admissions permission required' USING ERRCODE='42501';
  ELSIF p_action IN ('fee_category','fee_schedule','issue_fees','payment','concession_request','refund_request') AND access_role NOT IN ('owner','principal','school_admin','accountant') THEN
    RAISE EXCEPTION 'School accounts permission required' USING ERRCODE='42501';
  ELSIF p_action IN ('concession_review','refund_review') AND access_role NOT IN ('owner','principal') THEN
    RAISE EXCEPTION 'Principal approval required' USING ERRCODE='42501';
  ELSIF p_action='attendance' AND access_role NOT IN ('owner','principal','school_admin','teacher') THEN
    RAISE EXCEPTION 'Student attendance permission required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO found_request FROM atlas_school.operations WHERE organization_id=p_org AND request_id=p_request;
  IF FOUND THEN
    IF found_request.actor<>who OR found_request.action<>p_action OR found_request.payload<>p_data THEN
      RAISE EXCEPTION 'Request key was already used for different school data' USING ERRCODE='23505';
    END IF;
    RETURN found_request.result;
  END IF;
  CASE p_action
  WHEN 'settings' THEN
    SELECT to_jsonb(s) INTO old FROM atlas_school.settings s WHERE organization_id=p_org;
    INSERT INTO atlas_school.settings(organization_id,name,address,phone,email,logo_url,board,grading_notes,receipt_prefix)
      VALUES(p_org,btrim(p_data->>'name'),coalesce(p_data->>'address',''),coalesce(p_data->>'phone',''),coalesce(p_data->>'email',''),
        coalesce(p_data->>'logo_url',''),coalesce(p_data->>'board',''),coalesce(p_data->>'grading_notes',''),upper(coalesce(nullif(btrim(p_data->>'receipt_prefix'),''),'SCH')))
    ON CONFLICT(organization_id) DO UPDATE SET name=excluded.name,address=excluded.address,phone=excluded.phone,email=excluded.email,
      logo_url=excluded.logo_url,board=excluded.board,grading_notes=excluded.grading_notes,receipt_prefix=excluded.receipt_prefix
    RETURNING to_jsonb(settings.*)-'next_receipt' INTO result;
  WHEN 'role' THEN
    target := (p_data->>'user_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.organization_id=p_org AND m.user_id=target AND m.is_active) THEN
      RAISE EXCEPTION 'Choose an active member of this workspace' USING ERRCODE='22023';
    END IF;
    SELECT to_jsonb(r) INTO old FROM atlas_school.roles r WHERE organization_id=p_org AND user_id=target;
    IF p_data->>'role'='remove' THEN
      DELETE FROM atlas_school.teacher_classes WHERE organization_id=p_org AND user_id=target;
      DELETE FROM atlas_school.roles WHERE organization_id=p_org AND user_id=target;
    ELSE
      INSERT INTO atlas_school.roles(organization_id,user_id,role) VALUES(p_org,target,p_data->>'role')
      ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role;
      DELETE FROM atlas_school.teacher_classes WHERE organization_id=p_org AND user_id=target;
      IF p_data->>'role'='teacher' THEN
        IF jsonb_typeof(p_data->'class_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Choose teacher classes' USING ERRCODE='22023'; END IF;
        INSERT INTO atlas_school.teacher_classes(organization_id,user_id,class_id)
          SELECT p_org,target,value::uuid FROM jsonb_array_elements_text(p_data->'class_ids');
      END IF;
    END IF;
    result:=p_data;
  WHEN 'year' THEN
    INSERT INTO atlas_school.years(organization_id,name,starts_on,ends_on)
      VALUES(p_org,btrim(p_data->>'name'),(p_data->>'starts_on')::date,(p_data->>'ends_on')::date) RETURNING to_jsonb(years.*) INTO result;
  WHEN 'term' THEN
    year_id:=(p_data->>'year_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM atlas_school.years y WHERE y.organization_id=p_org AND y.id=year_id
      AND (p_data->>'starts_on')::date>=y.starts_on AND (p_data->>'ends_on')::date<=y.ends_on) THEN
      RAISE EXCEPTION 'Term dates must be inside the academic year' USING ERRCODE='22023';
    END IF;
    INSERT INTO atlas_school.terms(organization_id,year_id,name,starts_on,ends_on)
      VALUES(p_org,year_id,btrim(p_data->>'name'),(p_data->>'starts_on')::date,(p_data->>'ends_on')::date) RETURNING to_jsonb(terms.*) INTO result;
  WHEN 'class' THEN
    INSERT INTO atlas_school.classes(organization_id,year_id,name,section)
      VALUES(p_org,(p_data->>'year_id')::uuid,btrim(p_data->>'name'),btrim(p_data->>'section')) RETURNING to_jsonb(classes.*) INTO result;
  WHEN 'calendar' THEN
    IF NOT EXISTS(SELECT 1 FROM atlas_school.years y WHERE y.organization_id=p_org AND y.id=(p_data->>'year_id')::uuid
      AND (p_data->>'day')::date BETWEEN y.starts_on AND y.ends_on) THEN
      RAISE EXCEPTION 'Calendar date must be inside the academic year' USING ERRCODE='22023';
    END IF;
    INSERT INTO atlas_school.calendar(organization_id,year_id,day,label,kind)
      VALUES(p_org,(p_data->>'year_id')::uuid,(p_data->>'day')::date,btrim(p_data->>'label'),p_data->>'kind') RETURNING to_jsonb(calendar.*) INTO result;
  WHEN 'student','students_import' THEN
    IF p_action='student' THEN item:=jsonb_build_array(p_data); ELSE item:=p_data->'rows'; END IF;
    IF jsonb_typeof(item) IS DISTINCT FROM 'array' OR jsonb_array_length(item) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Import between 1 and 200 validated student rows' USING ERRCODE='22023';
    END IF;
    result:='[]'::jsonb;
    FOR entry IN SELECT value FROM jsonb_array_elements(item) LOOP
      class_id:=(entry->>'class_id')::uuid;
      SELECT c.year_id INTO year_id FROM atlas_school.classes c WHERE c.organization_id=p_org AND c.id=class_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Choose a class in this school' USING ERRCODE='22023'; END IF;
      IF nullif(entry->>'dob','') IS NOT NULL AND ((entry->>'dob')::date>local_today OR (entry->>'dob')::date>(entry->>'joining_on')::date) THEN
        RAISE EXCEPTION 'Check the birth and joining dates' USING ERRCODE='22023';
      END IF;
      INSERT INTO atlas_school.students(organization_id,admission_no,name,dob,guardian_name,guardian_phone,guardian_email,address,previous_school,joining_on)
      VALUES(p_org,upper(btrim(entry->>'admission_no')),btrim(entry->>'name'),nullif(entry->>'dob','')::date,btrim(entry->>'guardian_name'),
        btrim(entry->>'guardian_phone'),coalesce(entry->>'guardian_email',''),coalesce(entry->>'address',''),coalesce(entry->>'previous_school',''),(entry->>'joining_on')::date)
      RETURNING id INTO student;
      INSERT INTO atlas_school.enrolments(organization_id,student_id,year_id,class_id) VALUES(p_org,student,year_id,class_id) RETURNING id INTO enrolment;
      result:=result||jsonb_build_array(jsonb_build_object('student_id',student,'enrolment_id',enrolment));
    END LOOP;
  WHEN 'student_update' THEN
    target:=(p_data->>'id')::uuid;
    SELECT to_jsonb(s) INTO old FROM atlas_school.students s WHERE organization_id=p_org AND id=target FOR UPDATE;
    IF old IS NULL OR (old->>'revision')::integer IS DISTINCT FROM (p_data->>'revision')::integer THEN
      RAISE EXCEPTION 'Student profile changed. Reload before saving' USING ERRCODE='40001';
    END IF;
    IF char_length(btrim(coalesce(p_data->>'reason','')))<3 THEN RAISE EXCEPTION 'Give a reason for changing this profile' USING ERRCODE='22023'; END IF;
    UPDATE atlas_school.students SET name=btrim(p_data->>'name'),guardian_name=btrim(p_data->>'guardian_name'),guardian_phone=btrim(p_data->>'guardian_phone'),
      guardian_email=coalesce(p_data->>'guardian_email',''),address=coalesce(p_data->>'address',''),previous_school=coalesce(p_data->>'previous_school',''),revision=revision+1
      WHERE id=target RETURNING to_jsonb(students.*) INTO result;
  WHEN 'enrol' THEN
    student:=(p_data->>'student_id')::uuid; class_id:=(p_data->>'class_id')::uuid;
    SELECT c.year_id INTO year_id FROM atlas_school.classes c WHERE c.organization_id=p_org AND c.id=class_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose a class in this school' USING ERRCODE='22023'; END IF;
    INSERT INTO atlas_school.enrolments(organization_id,student_id,year_id,class_id) VALUES(p_org,student,year_id,class_id)
      RETURNING to_jsonb(enrolments.*) INTO result;
  WHEN 'admission' THEN
    INSERT INTO atlas_school.admissions(organization_id,applicant,guardian_name,phone,desired_class,note)
      VALUES(p_org,btrim(p_data->>'applicant'),btrim(p_data->>'guardian_name'),btrim(p_data->>'phone'),coalesce(p_data->>'desired_class',''),coalesce(p_data->>'note',''))
      RETURNING to_jsonb(admissions.*) INTO result;
  WHEN 'admission_stage','admit' THEN
    target:=(p_data->>'id')::uuid;
    SELECT * INTO old_admission FROM atlas_school.admissions WHERE organization_id=p_org AND id=target FOR UPDATE;
    IF NOT FOUND OR old_admission.revision IS DISTINCT FROM (p_data->>'revision')::integer THEN
      RAISE EXCEPTION 'Admission changed. Reload before saving' USING ERRCODE='40001';
    END IF;
    old:=to_jsonb(old_admission);
    IF p_action='admission_stage' THEN
      IF NOT ((old_admission.status='enquiry' AND p_data->>'status' IN ('application','rejected')) OR
        (old_admission.status='application' AND p_data->>'status' IN ('review','rejected')) OR
        (old_admission.status='review' AND p_data->>'status' IN ('approved','rejected'))) THEN
        RAISE EXCEPTION 'Follow enquiry, application, review and approval before admission' USING ERRCODE='22023';
      END IF;
      UPDATE atlas_school.admissions SET status=p_data->>'status',revision=revision+1 WHERE id=target RETURNING to_jsonb(admissions.*) INTO result;
    ELSE
      IF old_admission.status<>'approved' THEN RAISE EXCEPTION 'Approve this application before admission' USING ERRCODE='22023'; END IF;
      class_id:=(p_data->>'class_id')::uuid;
      SELECT c.year_id INTO year_id FROM atlas_school.classes c WHERE c.organization_id=p_org AND c.id=class_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Choose a class in this school' USING ERRCODE='22023'; END IF;
      INSERT INTO atlas_school.students(organization_id,admission_no,name,dob,guardian_name,guardian_phone,guardian_email,address,previous_school,joining_on)
      VALUES(p_org,upper(btrim(p_data->>'admission_no')),old_admission.applicant,nullif(p_data->>'dob','')::date,old_admission.guardian_name,
        old_admission.phone,coalesce(p_data->>'guardian_email',''),coalesce(p_data->>'address',''),coalesce(p_data->>'previous_school',''),(p_data->>'joining_on')::date)
        RETURNING id INTO student;
      IF nullif(p_data->>'dob','') IS NOT NULL AND ((p_data->>'dob')::date>local_today OR (p_data->>'dob')::date>(p_data->>'joining_on')::date) THEN
        RAISE EXCEPTION 'Check birth and joining dates' USING ERRCODE='22023';
      END IF;
      INSERT INTO atlas_school.enrolments(organization_id,student_id,year_id,class_id) VALUES(p_org,student,year_id,class_id) RETURNING id INTO enrolment;
      UPDATE atlas_school.admissions SET status='admitted',student_id=student,revision=revision+1 WHERE id=target;
      result:=jsonb_build_object('student_id',student,'enrolment_id',enrolment);
    END IF;
  WHEN 'attendance' THEN
    class_id:=(p_data->>'class_id')::uuid;
    IF atlas_school.class_allowed(p_org,class_id,access_role) IS NOT TRUE THEN RAISE EXCEPTION 'This class is not assigned to you' USING ERRCODE='42501'; END IF;
    IF (p_data->>'day')::date>local_today OR NOT EXISTS(SELECT 1 FROM atlas_school.classes c JOIN atlas_school.years y ON y.id=c.year_id
      WHERE c.organization_id=p_org AND c.id=class_id AND (p_data->>'day')::date BETWEEN y.starts_on AND y.ends_on) THEN
      RAISE EXCEPTION 'Choose a non-future date inside the academic year' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(p_data->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'rows') NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'Choose between 1 and 500 attendance records' USING ERRCODE='22023';
    END IF;
    IF (SELECT count(DISTINCT value->>'enrolment_id') FROM jsonb_array_elements(p_data->'rows'))<>jsonb_array_length(p_data->'rows') THEN
      RAISE EXCEPTION 'An attendance batch contains duplicate students' USING ERRCODE='22023';
    END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(p_data->'rows') LOOP
      enrolment:=(entry->>'enrolment_id')::uuid;
      IF NOT EXISTS(SELECT 1 FROM atlas_school.enrolments e JOIN atlas_school.students s ON s.id=e.student_id
        WHERE e.organization_id=p_org AND e.id=enrolment AND e.class_id=(p_data->>'class_id')::uuid AND e.status='active'
          AND s.joining_on<=(p_data->>'day')::date) THEN RAISE EXCEPTION 'Student is not enrolled for this class and date' USING ERRCODE='22023'; END IF;
      SELECT coalesce(max(a.revision),0) INTO row_revision FROM atlas_school.attendance a
        WHERE a.organization_id=p_org AND a.enrolment_id=enrolment AND a.day=(p_data->>'day')::date;
      expected_revision:=(entry->>'revision')::integer;
      IF expected_revision IS NULL OR expected_revision<>row_revision THEN RAISE EXCEPTION 'Attendance changed. Reload this class' USING ERRCODE='40001'; END IF;
      IF row_revision>0 AND char_length(btrim(coalesce(entry->>'reason','')))<3 THEN RAISE EXCEPTION 'Give a reason for this attendance correction' USING ERRCODE='22023'; END IF;
      INSERT INTO atlas_school.attendance(organization_id,enrolment_id,class_id,day,revision,status,reason,recorded_by)
        VALUES(p_org,enrolment,class_id,(p_data->>'day')::date,row_revision+1,entry->>'status',coalesce(entry->>'reason',''),who);
    END LOOP;
    result:=jsonb_build_object('saved',jsonb_array_length(p_data->'rows'));
  WHEN 'fee_category' THEN
    INSERT INTO atlas_school.fee_categories(organization_id,name) VALUES(p_org,btrim(p_data->>'name')) RETURNING to_jsonb(fee_categories.*) INTO result;
  WHEN 'fee_schedule' THEN
    class_id:=(p_data->>'class_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM atlas_school.classes c JOIN atlas_school.years y ON y.id=c.year_id WHERE c.organization_id=p_org AND c.id=class_id
      AND (p_data->>'due_on')::date BETWEEN y.starts_on AND y.ends_on) THEN RAISE EXCEPTION 'Fee due date must be inside the class academic year' USING ERRCODE='22023'; END IF;
    INSERT INTO atlas_school.fee_schedules(organization_id,class_id,category_id,label,due_on,amount_paise,tax_basis_points,tax_note)
      VALUES(p_org,class_id,(p_data->>'category_id')::uuid,btrim(p_data->>'label'),(p_data->>'due_on')::date,(p_data->>'amount_paise')::bigint,
        (p_data->>'tax_basis_points')::integer,btrim(p_data->>'tax_note')) RETURNING to_jsonb(fee_schedules.*) INTO result;
  WHEN 'issue_fees' THEN
    SELECT * INTO schedule FROM atlas_school.fee_schedules WHERE organization_id=p_org AND id=(p_data->>'schedule_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fee schedule not found' USING ERRCODE='22023'; END IF;
    INSERT INTO atlas_school.charges(organization_id,enrolment_id,schedule_id,label,due_on,base_paise,tax_paise,tax_basis_points,tax_note)
      SELECT p_org,e.id,schedule.id,schedule.label,schedule.due_on,schedule.amount_paise,
        floor((schedule.amount_paise::numeric*schedule.tax_basis_points+5000)/10000)::bigint,schedule.tax_basis_points,schedule.tax_note
      FROM atlas_school.enrolments e WHERE e.organization_id=p_org AND e.class_id=schedule.class_id AND e.status='active'
      ON CONFLICT(organization_id,enrolment_id,schedule_id) DO NOTHING;
    GET DIAGNOSTICS row_revision=ROW_COUNT;
    result:=jsonb_build_object('issued',row_revision);
  WHEN 'payment' THEN
    enrolment:=(p_data->>'enrolment_id')::uuid; amount:=(p_data->>'amount_paise')::bigint;
    IF amount IS NULL OR amount NOT BETWEEN 1 AND 99999999999 OR (p_data->>'paid_on')::date>local_today THEN RAISE EXCEPTION 'Check payment amount and date' USING ERRCODE='22023'; END IF;
    SELECT coalesce(sum(b.total_paise-b.concession_paise-b.paid_paise),0) INTO available FROM atlas_school.charge_balances b WHERE b.organization_id=p_org AND b.enrolment_id=enrolment;
    IF amount>available THEN RAISE EXCEPTION 'Payment exceeds the outstanding school fees' USING ERRCODE='23514'; END IF;
    IF p_data->>'method'<>'cash' AND char_length(btrim(coalesce(p_data->>'reference','')))<3 THEN RAISE EXCEPTION 'Enter the bank, UPI or cheque reference' USING ERRCODE='22023'; END IF;
    SELECT * INTO school FROM atlas_school.settings WHERE organization_id=p_org FOR UPDATE;
    SELECT jsonb_build_object('name',s.name,'admission_no',s.admission_no,'guardian_name',s.guardian_name,'class',c.name,'section',c.section,'year',y.name)
      INTO item FROM atlas_school.enrolments e JOIN atlas_school.students s ON s.id=e.student_id
      JOIN atlas_school.classes c ON c.id=e.class_id JOIN atlas_school.years y ON y.id=e.year_id WHERE e.organization_id=p_org AND e.id=enrolment;
    IF item IS NULL THEN RAISE EXCEPTION 'Student enrolment not found' USING ERRCODE='22023'; END IF;
    INSERT INTO atlas_school.receipts(organization_id,enrolment_id,receipt_no,paid_on,method,reference,amount_paise,recorded_by,school_snapshot,student_snapshot)
      VALUES(p_org,enrolment,school.receipt_prefix||'-'||lpad(school.next_receipt::text,greatest(7,length(school.next_receipt::text)),'0'),(p_data->>'paid_on')::date,p_data->>'method',coalesce(p_data->>'reference',''),amount,who,
      to_jsonb(school)-'next_receipt',item) RETURNING id INTO receipt;
    UPDATE atlas_school.settings SET next_receipt=next_receipt+1 WHERE organization_id=p_org;
    remaining:=amount;
    FOR fee IN SELECT * FROM atlas_school.charge_balances b WHERE b.organization_id=p_org AND b.enrolment_id=enrolment ORDER BY b.due_on,b.id LOOP
      portion:=least(remaining,fee.total_paise-fee.concession_paise-fee.paid_paise);
      IF portion>0 THEN INSERT INTO atlas_school.allocations VALUES(p_org,receipt,fee.id,portion); remaining:=remaining-portion; END IF;
      EXIT WHEN remaining=0;
    END LOOP;
    IF remaining<>0 THEN RAISE EXCEPTION 'Fee allocation did not reconcile' USING ERRCODE='23514'; END IF;
    result:=jsonb_build_object('receipt_id',receipt);
  WHEN 'concession_request' THEN
    target:=(p_data->>'charge_id')::uuid; amount:=(p_data->>'amount_paise')::bigint;
    SELECT * INTO fee FROM atlas_school.charge_balances WHERE organization_id=p_org AND id=target;
    IF NOT FOUND OR amount IS NULL OR amount<=0 OR amount>fee.total_paise-fee.concession_paise-fee.paid_paise THEN RAISE EXCEPTION 'Concession exceeds unpaid fees' USING ERRCODE='23514'; END IF;
    INSERT INTO atlas_school.concessions(organization_id,charge_id,amount_paise,reason,requested_by)
      VALUES(p_org,target,amount,btrim(p_data->>'reason'),who) RETURNING to_jsonb(concessions.*) INTO result;
  WHEN 'concession_review' THEN
    target:=(p_data->>'id')::uuid;
    SELECT * INTO concession FROM atlas_school.concessions WHERE organization_id=p_org AND id=target FOR UPDATE;
    IF NOT FOUND OR concession.status<>'pending' THEN RAISE EXCEPTION 'Concession is no longer pending' USING ERRCODE='40001'; END IF;
    IF p_data->>'decision' NOT IN ('approved','rejected') OR p_data->>'decision' IS NULL THEN RAISE EXCEPTION 'Choose approve or reject' USING ERRCODE='22023'; END IF;
    SELECT * INTO fee FROM atlas_school.charge_balances WHERE organization_id=p_org AND id=concession.charge_id;
    IF p_data->>'decision'='approved' AND concession.amount_paise>fee.total_paise-fee.concession_paise-fee.paid_paise THEN RAISE EXCEPTION 'Refresh fees: concession exceeds the current unpaid balance' USING ERRCODE='23514'; END IF;
    old:=to_jsonb(concession);
    UPDATE atlas_school.concessions SET status=p_data->>'decision',reviewed_by=who,reviewed_at=now() WHERE id=target RETURNING to_jsonb(concessions.*) INTO result;
  WHEN 'refund_request' THEN
    receipt:=(p_data->>'receipt_id')::uuid; amount:=(p_data->>'amount_paise')::bigint;
    SELECT * INTO old_receipt FROM atlas_school.receipts WHERE organization_id=p_org AND id=receipt;
    SELECT old_receipt.amount_paise-coalesce(sum(r.amount_paise),0) INTO refundable FROM atlas_school.refunds r WHERE r.organization_id=p_org AND r.receipt_id=receipt AND r.status='approved';
    IF old_receipt.id IS NULL OR amount IS NULL OR amount<=0 OR amount>refundable OR (p_data->>'refunded_on')::date>local_today OR (p_data->>'refunded_on')::date<old_receipt.paid_on THEN RAISE EXCEPTION 'Check refundable amount and date' USING ERRCODE='23514'; END IF;
    IF p_data->>'kind'='reversal' AND amount<>refundable THEN RAISE EXCEPTION 'A reversal must undo the remaining receipt amount' USING ERRCODE='22023'; END IF;
    IF p_data->>'method'<>'cash' AND char_length(btrim(coalesce(p_data->>'reference','')))<3 THEN RAISE EXCEPTION 'Enter a refund reference' USING ERRCODE='22023'; END IF;
    INSERT INTO atlas_school.refunds(organization_id,receipt_id,amount_paise,kind,reason,method,reference,refunded_on,requested_by)
      VALUES(p_org,receipt,amount,p_data->>'kind',btrim(p_data->>'reason'),p_data->>'method',coalesce(p_data->>'reference',''),(p_data->>'refunded_on')::date,who) RETURNING to_jsonb(refunds.*) INTO result;
  WHEN 'refund_review' THEN
    target:=(p_data->>'id')::uuid;
    SELECT * INTO refund FROM atlas_school.refunds WHERE organization_id=p_org AND id=target FOR UPDATE;
    IF NOT FOUND OR refund.status<>'pending' THEN RAISE EXCEPTION 'Refund is no longer pending' USING ERRCODE='40001'; END IF;
    IF p_data->>'decision' NOT IN ('approved','rejected') OR p_data->>'decision' IS NULL THEN RAISE EXCEPTION 'Choose approve or reject' USING ERRCODE='22023'; END IF;
    old:=to_jsonb(refund);
    IF p_data->>'decision'='approved' THEN
      SELECT r.amount_paise-coalesce((SELECT sum(f.amount_paise) FROM atlas_school.refunds f WHERE f.organization_id=p_org AND f.receipt_id=r.id AND f.status='approved'),0)
        INTO refundable FROM atlas_school.receipts r WHERE r.organization_id=p_org AND r.id=refund.receipt_id;
      IF refund.amount_paise>refundable OR (refund.kind='reversal' AND refund.amount_paise<>refundable) THEN RAISE EXCEPTION 'Refundable balance changed; request a new adjustment' USING ERRCODE='23514'; END IF;
      remaining:=refund.amount_paise;
      FOR entry IN SELECT to_jsonb(a)||jsonb_build_object('available',a.amount_paise-coalesce((SELECT sum(ra.amount_paise) FROM atlas_school.refund_allocations ra
        JOIN atlas_school.refunds rf ON rf.organization_id=ra.organization_id AND rf.id=ra.refund_id
        WHERE ra.organization_id=p_org AND ra.receipt_id=a.receipt_id AND ra.charge_id=a.charge_id AND rf.status='approved'),0))
        FROM atlas_school.allocations a WHERE a.organization_id=p_org AND a.receipt_id=refund.receipt_id ORDER BY a.charge_id LOOP
        portion:=least(remaining,(entry->>'available')::bigint);
        IF portion>0 THEN INSERT INTO atlas_school.refund_allocations VALUES(p_org,target,refund.receipt_id,(entry->>'charge_id')::uuid,portion); remaining:=remaining-portion; END IF;
        EXIT WHEN remaining=0;
      END LOOP;
      IF remaining<>0 THEN RAISE EXCEPTION 'Refund allocation did not reconcile' USING ERRCODE='23514'; END IF;
    END IF;
    UPDATE atlas_school.refunds SET status=p_data->>'decision',reviewed_by=who,reviewed_at=now() WHERE id=target RETURNING to_jsonb(refunds.*) INTO result;
  ELSE RAISE EXCEPTION 'Unknown school operation' USING ERRCODE='22023';
  END CASE;
  INSERT INTO atlas_school.operations VALUES(p_org,p_request,who,p_action,p_data,result,now());
  INSERT INTO atlas_school.audit(organization_id,actor,action,subject,before_data,after_data) VALUES(p_org,who,p_action,target,old,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION atlas_school.apply(uuid,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_school.apply(uuid,text,jsonb,uuid) TO authenticated;
CREATE FUNCTION public.school_command(p_org_id uuid,p_action text,p_data jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_school.apply(p_org_id,p_action,p_data,p_request_id); $$;
REVOKE ALL ON FUNCTION public.school_command(uuid,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.school_command(uuid,text,jsonb,uuid) TO authenticated;

CREATE FUNCTION atlas_school.read(p_org uuid,p_area text,p_filter jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  access_role text:=atlas_school.actor_role(p_org); rows jsonb; total bigint; response jsonb;
  page_offset integer:=greatest(0,least(coalesce((p_filter->>'offset')::integer,0),1000000));
  page_limit integer:=greatest(1,least(coalesce((p_filter->>'limit')::integer,25),100));
  selected_year uuid:=nullif(p_filter->>'year_id','')::uuid;
  selected_class uuid:=nullif(p_filter->>'class_id','')::uuid;
  selected_student uuid:=nullif(p_filter->>'enrolment_id','')::uuid;
  from_day date:=coalesce(nullif(p_filter->>'from','')::date,(now() AT TIME ZONE 'Asia/Kolkata')::date);
  to_day date:=coalesce(nullif(p_filter->>'to','')::date,from_day);
  search_text text:='%'||left(coalesce(p_filter->>'search',''),100)||'%';
BEGIN
  IF auth.uid() IS NULL OR access_role IS NULL THEN RAISE EXCEPTION 'School access has not been granted for this account' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_filter) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid school filter' USING ERRCODE='22023'; END IF;
  IF p_filter->>'export'='true' THEN page_limit:=5000; page_offset:=0; END IF;
  IF to_day<from_day OR to_day-from_day>370 THEN RAISE EXCEPTION 'Choose a report period of at most 371 days' USING ERRCODE='22023'; END IF;
  IF p_area='bootstrap' THEN
    SELECT jsonb_build_object('role',access_role,'settings',(SELECT to_jsonb(s)-'next_receipt' FROM atlas_school.settings s WHERE s.organization_id=p_org),
      'years',coalesce((SELECT jsonb_agg(y ORDER BY y.starts_on DESC) FROM atlas_school.years y WHERE y.organization_id=p_org),'[]'),
      'classes',coalesce((SELECT jsonb_agg(c ORDER BY c.name,c.section) FROM atlas_school.classes c WHERE c.organization_id=p_org AND atlas_school.class_allowed(p_org,c.id,access_role)),'[]'),
      'terms',coalesce((SELECT jsonb_agg(t ORDER BY t.starts_on) FROM atlas_school.terms t WHERE t.organization_id=p_org),'[]'),
      'calendar',coalesce((SELECT jsonb_agg(c ORDER BY c.day) FROM atlas_school.calendar c WHERE c.organization_id=p_org),'[]'),
      'fee_categories',CASE WHEN access_role IN ('owner','principal','school_admin','accountant') THEN
        coalesce((SELECT jsonb_agg(c ORDER BY c.name) FROM atlas_school.fee_categories c WHERE c.organization_id=p_org),'[]') ELSE '[]'::jsonb END,
      'roles',CASE WHEN access_role='owner' THEN coalesce((SELECT jsonb_agg(r) FROM atlas_school.roles r WHERE r.organization_id=p_org),'[]') ELSE '[]'::jsonb END,
      'teacher_classes',CASE WHEN access_role='owner' THEN coalesce((SELECT jsonb_agg(t) FROM atlas_school.teacher_classes t WHERE t.organization_id=p_org),'[]') ELSE '[]'::jsonb END,
      'members',CASE WHEN access_role='owner' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email))
        FROM public.memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.organization_id=p_org AND m.is_active),'[]') ELSE '[]'::jsonb END)
      INTO response;
    IF p_filter->>'export'='true' AND coalesce((response->>'count')::bigint,0)>5000 THEN RAISE EXCEPTION 'Narrow this export to at most 5000 records' USING ERRCODE='22023'; END IF; RETURN response;
  ELSIF p_area='import_duplicates' THEN
    IF access_role NOT IN ('owner','principal','school_admin','admissions') THEN RAISE EXCEPTION 'Admissions access required' USING ERRCODE='42501'; END IF;
    IF jsonb_typeof(p_filter->'admission_nos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_filter->'admission_nos')>200 THEN
      RAISE EXCEPTION 'Check at most 200 admission identifiers' USING ERRCODE='22023';
    END IF;
    SELECT coalesce(jsonb_agg(s.admission_no),'[]') INTO rows FROM atlas_school.students s WHERE s.organization_id=p_org
      AND s.admission_no IN (SELECT upper(btrim(value)) FROM jsonb_array_elements_text(p_filter->'admission_nos'));
    RETURN rows;
  ELSIF p_area='students' THEN
    WITH filtered AS (
      SELECT (CASE WHEN access_role='accountant' THEN to_jsonb(s)-'dob'-'address'-'previous_school' ELSE to_jsonb(s) END)
        ||jsonb_build_object('enrolment_id',e.id,'year_id',e.year_id,'class_id',e.class_id,'enrolment_status',e.status,'class_name',c.name,'section',c.section,'year_name',y.name) AS data,
        s.name,s.admission_no,e.id
      FROM atlas_school.enrolments e JOIN atlas_school.students s ON s.id=e.student_id JOIN atlas_school.classes c ON c.id=e.class_id JOIN atlas_school.years y ON y.id=e.year_id
      WHERE e.organization_id=p_org AND (selected_year IS NULL OR e.year_id=selected_year) AND (selected_class IS NULL OR e.class_id=selected_class)
        AND atlas_school.class_allowed(p_org,e.class_id,access_role) AND (s.name ILIKE search_text OR s.admission_no ILIKE search_text OR s.guardian_phone ILIKE search_text)
    ) SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(q.data) FROM
      (SELECT * FROM filtered ORDER BY name,admission_no,id LIMIT page_limit OFFSET page_offset) q),'[]')) INTO response;
    IF p_filter->>'export'='true' AND coalesce((response->>'count')::bigint,0)>5000 THEN RAISE EXCEPTION 'Narrow this export to at most 5000 records' USING ERRCODE='22023'; END IF; RETURN response;
  ELSIF p_area='admissions' THEN
    IF access_role NOT IN ('owner','principal','school_admin','admissions') THEN RAISE EXCEPTION 'Admissions access required' USING ERRCODE='42501'; END IF;
    SELECT jsonb_build_object('count',(SELECT count(*) FROM atlas_school.admissions a WHERE a.organization_id=p_org AND (a.applicant ILIKE search_text OR a.phone ILIKE search_text)),
      'rows',coalesce((SELECT jsonb_agg(a) FROM (SELECT * FROM atlas_school.admissions a WHERE a.organization_id=p_org AND (a.applicant ILIKE search_text OR a.phone ILIKE search_text)
        ORDER BY a.created_at DESC,a.id LIMIT page_limit OFFSET page_offset) a),'[]')) INTO response;
    IF p_filter->>'export'='true' AND coalesce((response->>'count')::bigint,0)>5000 THEN RAISE EXCEPTION 'Narrow this export to at most 5000 records' USING ERRCODE='22023'; END IF; RETURN response;
  ELSIF p_area IN ('attendance','attendance_history','attendance_report') THEN
    IF access_role NOT IN ('owner','principal','school_admin','teacher') OR atlas_school.class_allowed(p_org,selected_class,access_role) IS NOT TRUE THEN
      RAISE EXCEPTION 'Attendance access is limited to assigned classes' USING ERRCODE='42501';
    END IF;
    IF p_area='attendance' THEN
      WITH roster AS (
        SELECT e.id AS enrolment_id,s.name,s.admission_no,a.status,a.revision,a.reason,a.recorded_at
        FROM atlas_school.enrolments e JOIN atlas_school.students s ON s.id=e.student_id
        LEFT JOIN LATERAL(SELECT * FROM atlas_school.attendance a WHERE a.organization_id=p_org AND a.enrolment_id=e.id AND a.day=from_day ORDER BY a.revision DESC LIMIT 1) a ON true
        WHERE e.organization_id=p_org AND e.class_id=selected_class AND e.status='active' AND s.joining_on<=from_day
      ) SELECT jsonb_build_object('count',(SELECT count(*) FROM roster),'rows',coalesce((SELECT jsonb_agg(r) FROM
        (SELECT * FROM roster ORDER BY name,enrolment_id LIMIT page_limit OFFSET page_offset) r),'[]')) INTO response;
    ELSIF p_area='attendance_history' THEN
      SELECT jsonb_build_object('count',(SELECT count(*) FROM atlas_school.attendance a WHERE a.organization_id=p_org AND a.class_id=selected_class AND a.enrolment_id=selected_student AND a.day=from_day),
        'rows',coalesce((SELECT jsonb_agg(a) FROM (SELECT * FROM atlas_school.attendance a WHERE a.organization_id=p_org AND a.class_id=selected_class AND a.enrolment_id=selected_student AND a.day=from_day
          ORDER BY a.revision DESC LIMIT page_limit OFFSET page_offset) a),'[]')) INTO response;
    ELSE
      WITH latest AS (SELECT DISTINCT ON(a.enrolment_id,a.day) a.* FROM atlas_school.attendance a WHERE a.organization_id=p_org AND a.class_id=selected_class AND a.day BETWEEN from_day AND to_day
        ORDER BY a.enrolment_id,a.day,a.revision DESC), counts AS (
        SELECT e.id AS enrolment_id,s.name,s.admission_no,count(a.day) AS recorded_days,
          count(*) FILTER(WHERE a.status='present') AS present,count(*) FILTER(WHERE a.status='absent') AS absent,
          count(*) FILTER(WHERE a.status='late') AS late,count(*) FILTER(WHERE a.status='half_day') AS half_day,count(*) FILTER(WHERE a.status='leave') AS leave
        FROM atlas_school.enrolments e JOIN atlas_school.students s ON s.id=e.student_id LEFT JOIN latest a ON a.enrolment_id=e.id
        WHERE e.organization_id=p_org AND e.class_id=selected_class GROUP BY e.id,s.name,s.admission_no
      ) SELECT jsonb_build_object('count',(SELECT count(*) FROM counts),'rows',coalesce((SELECT jsonb_agg(c) FROM
        (SELECT * FROM counts ORDER BY name,enrolment_id LIMIT page_limit OFFSET page_offset) c),'[]')) INTO response;
    END IF;
    IF p_filter->>'export'='true' AND coalesce((response->>'count')::bigint,0)>5000 THEN RAISE EXCEPTION 'Narrow this export to at most 5000 records' USING ERRCODE='22023'; END IF; RETURN response;
  ELSIF p_area IN ('schedules','charges','receipts','concessions','refunds','collections','receipt','fee_summary') THEN
    IF access_role NOT IN ('owner','principal','school_admin','accountant') THEN RAISE EXCEPTION 'School finance access required' USING ERRCODE='42501'; END IF;
    IF p_area='schedules' THEN
      SELECT coalesce(jsonb_agg(s ORDER BY s.due_on,s.label),'[]') INTO rows FROM atlas_school.fee_schedules s WHERE s.organization_id=p_org AND s.class_id=selected_class;
      RETURN jsonb_build_object('rows',rows,'count',jsonb_array_length(rows));
    ELSIF p_area='charges' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('balance_paise',b.total_paise-b.concession_paise-b.paid_paise) ORDER BY b.due_on,b.id),'[]') INTO rows
        FROM atlas_school.charge_balances b WHERE b.organization_id=p_org AND b.enrolment_id=selected_student;
      RETURN jsonb_build_object('rows',rows,'count',jsonb_array_length(rows));
    ELSIF p_area='receipts' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('refunded_paise',coalesce((SELECT sum(f.amount_paise) FROM atlas_school.refunds f WHERE f.organization_id=p_org AND f.receipt_id=r.id AND f.status='approved'),0)) ORDER BY r.recorded_at DESC),'[]')
        INTO rows FROM atlas_school.receipts r WHERE r.organization_id=p_org AND r.enrolment_id=selected_student;
      RETURN jsonb_build_object('rows',rows,'count',jsonb_array_length(rows));
    ELSIF p_area='concessions' THEN
      SELECT coalesce(jsonb_agg(c ORDER BY c.created_at DESC),'[]') INTO rows FROM atlas_school.concessions c JOIN atlas_school.charges ch ON ch.id=c.charge_id
        WHERE c.organization_id=p_org AND ch.enrolment_id=selected_student;
      RETURN jsonb_build_object('rows',rows,'count',jsonb_array_length(rows));
    ELSIF p_area='refunds' THEN
      SELECT coalesce(jsonb_agg(f ORDER BY f.created_at DESC),'[]') INTO rows FROM atlas_school.refunds f JOIN atlas_school.receipts r ON r.id=f.receipt_id
        WHERE f.organization_id=p_org AND r.enrolment_id=selected_student;
      RETURN jsonb_build_object('rows',rows,'count',jsonb_array_length(rows));
    ELSIF p_area='receipt' THEN
      SELECT to_jsonb(r)||jsonb_build_object('allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('label',c.label,'due_on',c.due_on,'amount_paise',a.amount_paise))
        FROM atlas_school.allocations a JOIN atlas_school.charges c ON c.id=a.charge_id WHERE a.organization_id=p_org AND a.receipt_id=r.id),'[]'),
        'adjustments',coalesce((SELECT jsonb_agg(f ORDER BY f.reviewed_at) FROM atlas_school.refunds f WHERE f.organization_id=p_org AND f.receipt_id=r.id AND f.status='approved'),'[]'))
        INTO response FROM atlas_school.receipts r WHERE r.organization_id=p_org AND r.id=(p_filter->>'receipt_id')::uuid;
      IF response IS NULL THEN RAISE EXCEPTION 'Receipt not found in this school' USING ERRCODE='42501'; END IF;
      IF p_filter->>'export'='true' AND coalesce((response->>'count')::bigint,0)>5000 THEN RAISE EXCEPTION 'Narrow this export to at most 5000 records' USING ERRCODE='22023'; END IF; RETURN response;
    ELSIF p_area='fee_summary' THEN
      WITH balances AS (SELECT b.*,e.student_id,s.name,s.admission_no,e.class_id FROM atlas_school.charge_balances b JOIN atlas_school.enrolments e ON e.id=b.enrolment_id
        JOIN atlas_school.students s ON s.id=e.student_id WHERE b.organization_id=p_org AND (selected_class IS NULL OR e.class_id=selected_class) AND (selected_year IS NULL OR e.year_id=selected_year)),
      totals AS (SELECT enrolment_id,name,admission_no,sum(total_paise)::bigint AS charged_paise,sum(concession_paise)::bigint AS concession_paise,
        sum(paid_paise)::bigint AS paid_paise,sum(total_paise-concession_paise-paid_paise)::bigint AS balance_paise FROM balances GROUP BY enrolment_id,name,admission_no)
      SELECT jsonb_build_object('count',(SELECT count(*) FROM totals),'rows',coalesce((SELECT jsonb_agg(t) FROM (SELECT * FROM totals ORDER BY name,enrolment_id LIMIT page_limit OFFSET page_offset) t),'[]'),
        'totals',(SELECT jsonb_build_object('charged_paise',coalesce(sum(total_paise),0),'concession_paise',coalesce(sum(concession_paise),0),'paid_paise',coalesce(sum(paid_paise),0),
          'balance_paise',coalesce(sum(total_paise-concession_paise-paid_paise),0)) FROM balances)) INTO response;
      IF p_filter->>'export'='true' AND coalesce((response->>'count')::bigint,0)>5000 THEN RAISE EXCEPTION 'Narrow this export to at most 5000 records' USING ERRCODE='22023'; END IF; RETURN response;
    ELSE
      WITH entries AS (
        SELECT 'collection' AS kind,r.id,r.receipt_no,r.paid_on AS day,r.method,r.reference,r.amount_paise,r.student_snapshot FROM atlas_school.receipts r WHERE r.organization_id=p_org AND r.paid_on BETWEEN from_day AND to_day
        UNION ALL SELECT f.kind,f.id,r.receipt_no,f.refunded_on,f.method,f.reference,-f.amount_paise,r.student_snapshot FROM atlas_school.refunds f JOIN atlas_school.receipts r ON r.id=f.receipt_id
          WHERE f.organization_id=p_org AND f.status='approved' AND f.refunded_on BETWEEN from_day AND to_day
      ) SELECT jsonb_build_object('count',(SELECT count(*) FROM entries),'rows',coalesce((SELECT jsonb_agg(e) FROM (SELECT * FROM entries ORDER BY day DESC,id LIMIT page_limit OFFSET page_offset) e),'[]'),
        'totals',(SELECT jsonb_build_object('collected_paise',coalesce(sum(amount_paise) FILTER(WHERE kind='collection'),0),'returned_paise',-coalesce(sum(amount_paise) FILTER(WHERE kind<>'collection'),0),'net_paise',coalesce(sum(amount_paise),0)) FROM entries)) INTO response;
      IF p_filter->>'export'='true' AND coalesce((response->>'count')::bigint,0)>5000 THEN RAISE EXCEPTION 'Narrow this export to at most 5000 records' USING ERRCODE='22023'; END IF; RETURN response;
    END IF;
  ELSIF p_area='dashboard' THEN
    SELECT jsonb_build_object('students',(SELECT count(*) FROM atlas_school.enrolments e WHERE e.organization_id=p_org AND (selected_year IS NULL OR e.year_id=selected_year) AND e.status='active' AND atlas_school.class_allowed(p_org,e.class_id,access_role)),
      'classes',(SELECT count(*) FROM atlas_school.classes c WHERE c.organization_id=p_org AND (selected_year IS NULL OR c.year_id=selected_year) AND atlas_school.class_allowed(p_org,c.id,access_role)),
      'pending_admissions',CASE WHEN access_role IN ('owner','principal','school_admin','admissions') THEN (SELECT count(*) FROM atlas_school.admissions a WHERE a.organization_id=p_org AND a.status IN ('enquiry','application','review','approved')) ELSE NULL END,
      'today_recorded',(SELECT count(*) FROM (SELECT DISTINCT a.enrolment_id FROM atlas_school.attendance a JOIN atlas_school.enrolments e ON e.id=a.enrolment_id
        WHERE a.organization_id=p_org AND a.day=(now() AT TIME ZONE 'Asia/Kolkata')::date AND (selected_year IS NULL OR e.year_id=selected_year) AND atlas_school.class_allowed(p_org,a.class_id,access_role)) q)) INTO response;
    IF p_filter->>'export'='true' AND coalesce((response->>'count')::bigint,0)>5000 THEN RAISE EXCEPTION 'Narrow this export to at most 5000 records' USING ERRCODE='22023'; END IF; RETURN response;
  ELSIF p_area='audit' THEN
    IF access_role NOT IN ('owner','principal','school_admin') THEN RAISE EXCEPTION 'School administration access required' USING ERRCODE='42501'; END IF;
    SELECT jsonb_build_object('count',(SELECT count(*) FROM atlas_school.audit a WHERE a.organization_id=p_org),
      'rows',coalesce((SELECT jsonb_agg(a) FROM (SELECT id,actor,action,subject,recorded_at FROM atlas_school.audit a WHERE a.organization_id=p_org ORDER BY id DESC LIMIT page_limit OFFSET page_offset) a),'[]')) INTO response;
    IF p_filter->>'export'='true' AND coalesce((response->>'count')::bigint,0)>5000 THEN RAISE EXCEPTION 'Narrow this export to at most 5000 records' USING ERRCODE='22023'; END IF; RETURN response;
  END IF;
  RAISE EXCEPTION 'Unknown school report' USING ERRCODE='22023';
END;
$$;
REVOKE ALL ON FUNCTION atlas_school.read(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION atlas_school.read(uuid,text,jsonb) TO authenticated;
CREATE FUNCTION public.school_read(p_org_id uuid,p_area text,p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT atlas_school.read(p_org_id,p_area,p_filter); $$;
REVOKE ALL ON FUNCTION public.school_read(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.school_read(uuid,text,jsonb) TO authenticated;
COMMIT;
