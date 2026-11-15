BEGIN;

CREATE TABLE public.staff_attendance_managers (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL DEFAULT auth.uid(),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES public.memberships(organization_id, user_id) ON DELETE CASCADE
);
ALTER TABLE public.staff_attendance_managers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_attendance_managers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON public.staff_attendance_managers TO authenticated;
GRANT INSERT (organization_id, user_id) ON public.staff_attendance_managers TO authenticated;

CREATE POLICY attendance_manager_read ON public.staff_attendance_managers
  FOR SELECT TO authenticated USING (
    public.can_read_organization_data(organization_id)
    AND (user_id = (SELECT auth.uid()) OR public.user_has_org_role(organization_id, 'owner'))
  );
CREATE POLICY attendance_manager_grant ON public.staff_attendance_managers
  FOR INSERT TO authenticated WITH CHECK (
    public.user_has_org_role(organization_id, 'owner')
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.organization_id = staff_attendance_managers.organization_id
        AND m.user_id = staff_attendance_managers.user_id AND m.is_active AND m.role <> 'owner'
    )
  );
CREATE POLICY attendance_manager_revoke ON public.staff_attendance_managers
  FOR DELETE TO authenticated USING (public.user_has_org_role(organization_id, 'owner'));

CREATE FUNCTION public.can_manage_staff_attendance(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.can_read_organization_data(p_org_id) AND (
    public.user_has_org_role(p_org_id, 'owner') OR EXISTS (
      SELECT 1 FROM public.staff_attendance_managers m
      WHERE m.organization_id = p_org_id AND m.user_id = (SELECT auth.uid())
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_manage_staff_attendance(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_staff_attendance(uuid) TO authenticated;

CREATE POLICY attendance_profile_read ON public.staff_profiles FOR SELECT TO authenticated
  USING (public.can_manage_staff_attendance(organization_id));
CREATE POLICY attendance_location_read ON public.staff_locations FOR SELECT TO authenticated
  USING (public.can_manage_staff_attendance(organization_id));

-- Look up sign-in addresses only for an authenticated owner of the target workspace.
-- The function that reads auth.users lives outside the exposed API schema.
CREATE SCHEMA staff_attendance_private;
REVOKE ALL ON SCHEMA staff_attendance_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA staff_attendance_private TO authenticated;
CREATE FUNCTION staff_attendance_private.manager_candidates(p_org_id uuid)
RETURNS TABLE(user_id uuid, email text, is_active boolean, is_granted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.user_id, u.email::text, m.is_active, g.user_id IS NOT NULL
  FROM public.memberships m
  JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN public.staff_attendance_managers g ON g.organization_id = m.organization_id AND g.user_id = m.user_id
  WHERE (SELECT auth.uid()) IS NOT NULL AND public.user_has_org_role(p_org_id, 'owner')
    AND m.organization_id = p_org_id AND m.role <> 'owner'
    AND (m.is_active OR g.user_id IS NOT NULL)
  ORDER BY lower(u.email), m.user_id;
$$;
REVOKE ALL ON FUNCTION staff_attendance_private.manager_candidates(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION staff_attendance_private.manager_candidates(uuid) TO authenticated;
CREATE FUNCTION public.staff_attendance_manager_candidates(p_org_id uuid)
RETURNS TABLE(user_id uuid, email text, is_active boolean, is_granted boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM staff_attendance_private.manager_candidates(p_org_id);
$$;
REVOKE ALL ON FUNCTION public.staff_attendance_manager_candidates(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_attendance_manager_candidates(uuid) TO authenticated;

CREATE TABLE public.staff_attendance (
  organization_id uuid NOT NULL,
  work_date date NOT NULL CHECK (isfinite(work_date) AND work_date >= joining_on),
  staff_id uuid NOT NULL,
  joining_on date NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  location_id uuid,
  status text NOT NULL CHECK (status IN ('scheduled', 'present', 'half_day', 'absent', 'leave')),
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, work_date, staff_id, revision),
  FOREIGN KEY (organization_id, staff_id, joining_on)
    REFERENCES public.staff_profiles(organization_id, id, joining_on),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES public.staff_locations(organization_id, id),
  CHECK (location_id IS NOT NULL OR status IN ('absent', 'leave'))
);
CREATE INDEX staff_attendance_employee_history ON public.staff_attendance (organization_id, staff_id, joining_on);
CREATE INDEX staff_attendance_location_history ON public.staff_attendance (organization_id, location_id);

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_attendance FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.staff_attendance TO authenticated;
GRANT INSERT (organization_id, work_date, staff_id, joining_on, revision, location_id, status)
  ON public.staff_attendance TO authenticated;
CREATE POLICY attendance_read ON public.staff_attendance
  FOR SELECT TO authenticated USING (public.can_manage_staff_attendance(organization_id));
CREATE POLICY attendance_record ON public.staff_attendance
  FOR INSERT TO authenticated WITH CHECK (
    public.can_manage_staff_attendance(organization_id)
    AND public.can_write_organization_operations(organization_id)
  );

CREATE FUNCTION staff_attendance_private.validate_attendance_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  previous_revision integer;
BEGIN
  IF NEW.status <> 'scheduled' AND NEW.work_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Future attendance can only be scheduled' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(max(a.revision), 0) INTO previous_revision
  FROM public.staff_attendance a
  WHERE a.organization_id = NEW.organization_id AND a.work_date = NEW.work_date AND a.staff_id = NEW.staff_id;
  IF NEW.revision <> previous_revision + 1 THEN
    RAISE EXCEPTION 'Attendance changed. Reload the day and try again.' USING ERRCODE = '40001';
  END IF;
  -- The primary key rejects two concurrent inserts that picked the same next revision.
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION staff_attendance_private.validate_attendance_revision() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER validate_attendance_revision BEFORE INSERT ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION staff_attendance_private.validate_attendance_revision();

CREATE FUNCTION public.staff_attendance_day(p_org_id uuid, p_work_date date, p_staff_ids uuid[])
RETURNS SETOF public.staff_attendance LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT DISTINCT ON (a.staff_id) a.*
  FROM public.staff_attendance a
  WHERE a.organization_id = p_org_id AND a.work_date = p_work_date AND a.staff_id = ANY(p_staff_ids)
    AND cardinality(p_staff_ids) <= 25
  ORDER BY a.staff_id, a.revision DESC;
$$;
REVOKE ALL ON FUNCTION public.staff_attendance_day(uuid,date,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_attendance_day(uuid,date,uuid[]) TO authenticated;

COMMIT;
