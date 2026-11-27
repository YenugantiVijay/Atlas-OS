BEGIN;

CREATE TABLE public.staff_employee_accounts (
  organization_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, staff_id),
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id, staff_id) REFERENCES public.staff_profiles(organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES public.memberships(organization_id, user_id)
);
ALTER TABLE public.staff_employee_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_employee_accounts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.staff_employee_accounts TO authenticated;
CREATE POLICY employee_account_read ON public.staff_employee_accounts FOR SELECT TO authenticated
USING (public.can_read_organization_data(organization_id) AND
  (user_id = (SELECT auth.uid()) OR public.can_manage_staff_attendance(organization_id)));

CREATE POLICY employee_profile_read ON public.staff_profiles FOR SELECT TO authenticated
USING (public.can_read_organization_data(organization_id) AND EXISTS (
  SELECT 1 FROM public.staff_employee_accounts a WHERE a.organization_id = staff_profiles.organization_id
  AND a.staff_id = staff_profiles.id AND a.user_id = (SELECT auth.uid()) AND a.is_active
));
CREATE POLICY employee_assignment_read ON public.staff_location_assignments FOR SELECT TO authenticated
USING (public.can_read_organization_data(organization_id) AND EXISTS (
  SELECT 1 FROM public.staff_employee_accounts a WHERE a.organization_id = staff_location_assignments.organization_id
  AND a.staff_id = staff_location_assignments.staff_id AND a.user_id = (SELECT auth.uid()) AND a.is_active
));
CREATE POLICY employee_location_read ON public.staff_locations FOR SELECT TO authenticated
USING (public.can_read_organization_data(organization_id) AND EXISTS (
  SELECT 1 FROM public.staff_location_assignments s WHERE s.organization_id = staff_locations.organization_id
  AND s.location_id = staff_locations.id
));

CREATE TABLE public.staff_clock_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  user_id uuid NOT NULL,
  work_date date NOT NULL,
  location_id uuid NOT NULL,
  checked_in_at timestamptz NOT NULL,
  checked_out_at timestamptz,
  break_started_at timestamptz,
  break_seconds bigint NOT NULL DEFAULT 0 CHECK (break_seconds >= 0),
  work_summary text CHECK (work_summary IS NULL OR char_length(work_summary) BETWEEN 20 AND 2000),
  UNIQUE (organization_id, staff_id, work_date),
  FOREIGN KEY (organization_id, staff_id) REFERENCES public.staff_profiles(organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES public.memberships(organization_id, user_id),
  FOREIGN KEY (organization_id, location_id) REFERENCES public.staff_locations(organization_id, id),
  CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at),
  CHECK (break_started_at IS NULL OR (checked_out_at IS NULL AND break_started_at >= checked_in_at)),
  CHECK (checked_out_at IS NULL OR work_summary IS NOT NULL)
);
CREATE UNIQUE INDEX staff_clock_one_open ON public.staff_clock_sessions(organization_id, user_id)
  WHERE checked_out_at IS NULL;
CREATE INDEX staff_clock_month ON public.staff_clock_sessions(organization_id, work_date, staff_id);
ALTER TABLE public.staff_clock_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_clock_sessions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.staff_clock_sessions TO authenticated;
CREATE POLICY clock_read ON public.staff_clock_sessions FOR SELECT TO authenticated
USING (public.can_read_organization_data(organization_id) AND
  (user_id = (SELECT auth.uid()) OR public.can_manage_staff_attendance(organization_id)));

-- Only these guarded server operations can write. Browser clocks and direct DML
-- cannot choose timestamps, durations, another employee, or historical records.
CREATE FUNCTION staff_attendance_private.link_employee(
  p_org_id uuid, p_staff_id uuid, p_user_id uuid, p_active boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.can_write_organization_operations(p_org_id) IS NOT TRUE
    OR public.user_has_org_role(p_org_id, 'owner') IS NOT TRUE THEN
    RAISE EXCEPTION 'Only the workspace owner can link employee accounts' USING ERRCODE = '42501';
  END IF;
  IF p_active IS NULL OR NOT EXISTS (SELECT 1 FROM public.memberships m
    WHERE m.organization_id = p_org_id AND m.user_id = p_user_id AND m.is_active)
    OR NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.organization_id = p_org_id AND s.id = p_staff_id) THEN
    RAISE EXCEPTION 'Choose an active team member and staff profile in this workspace' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.staff_employee_accounts a WHERE a.organization_id = p_org_id
    AND a.staff_id = p_staff_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.staff_clock_sessions c WHERE c.organization_id = p_org_id
    AND c.staff_id = p_staff_id AND c.checked_out_at IS NULL) THEN
    RAISE EXCEPTION 'Finish the open shift before changing this account link' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.staff_employee_accounts(organization_id, staff_id, user_id, is_active, linked_by)
  VALUES (p_org_id, p_staff_id, p_user_id, p_active, auth.uid())
  ON CONFLICT (organization_id, staff_id) DO UPDATE SET user_id = excluded.user_id,
    is_active = excluded.is_active, linked_by = auth.uid(), linked_at = now();
END;
$$;
REVOKE ALL ON FUNCTION staff_attendance_private.link_employee(uuid,uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION staff_attendance_private.link_employee(uuid,uuid,uuid,boolean) TO authenticated;
CREATE FUNCTION public.link_staff_employee(p_org_id uuid, p_staff_id uuid, p_user_id uuid, p_active boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT staff_attendance_private.link_employee(p_org_id,p_staff_id,p_user_id,p_active);
$$;
REVOKE ALL ON FUNCTION public.link_staff_employee(uuid,uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_staff_employee(uuid,uuid,uuid,boolean) TO authenticated;

CREATE FUNCTION staff_attendance_private.clock_action(
  p_org_id uuid, p_action text, p_session_id uuid, p_location_id uuid, p_summary text
) RETURNS public.staff_clock_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  account public.staff_employee_accounts;
  shift public.staff_clock_sessions;
  stamp timestamptz;
  today date;
BEGIN
  IF auth.uid() IS NULL OR public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Attendance writes are unavailable for this account or workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO account FROM public.staff_employee_accounts a
    WHERE a.organization_id = p_org_id AND a.user_id = auth.uid() AND a.is_active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ask the owner to link your employee profile' USING ERRCODE = '42501';
  END IF;
  stamp := clock_timestamp();
  today := (stamp AT TIME ZONE 'Asia/Kolkata')::date;
  IF p_action = 'check_in' THEN
    SELECT * INTO shift FROM public.staff_clock_sessions c
      WHERE c.organization_id = p_org_id AND c.user_id = auth.uid() AND c.checked_out_at IS NULL FOR UPDATE;
    IF FOUND THEN RETURN shift; END IF;
    SELECT * INTO shift FROM public.staff_clock_sessions c WHERE c.organization_id = p_org_id
      AND c.staff_id = account.staff_id AND c.work_date = today;
    IF FOUND THEN RETURN shift; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.organization_id = p_org_id
      AND s.id = account.staff_id AND s.joining_on <= today)
      OR NOT EXISTS (SELECT 1 FROM public.staff_location_assignments s WHERE s.organization_id = p_org_id
      AND s.staff_id = account.staff_id AND s.location_id = p_location_id) THEN
      RAISE EXCEPTION 'Choose an assigned work location and check the joining date' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.staff_clock_sessions(organization_id,staff_id,user_id,work_date,location_id,checked_in_at)
      VALUES(p_org_id,account.staff_id,auth.uid(),today,p_location_id,stamp) RETURNING * INTO shift;
    RETURN shift;
  END IF;
  SELECT * INTO shift FROM public.staff_clock_sessions c WHERE c.organization_id = p_org_id
    AND c.user_id = auth.uid() AND c.id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found' USING ERRCODE = '42501'; END IF;
  IF shift.checked_out_at IS NOT NULL THEN
    IF p_action = 'check_out' AND shift.work_summary = btrim(p_summary) THEN RETURN shift; END IF;
    RAISE EXCEPTION 'This shift is already closed' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'start_break' THEN
    IF shift.break_started_at IS NULL THEN
      UPDATE public.staff_clock_sessions SET break_started_at = stamp WHERE id = shift.id RETURNING * INTO shift;
    END IF;
  ELSIF p_action IN ('end_break','check_out') THEN
    IF p_action = 'check_out' AND (p_summary IS NULL OR char_length(btrim(p_summary)) NOT BETWEEN 20 AND 2000) THEN
      RAISE EXCEPTION 'Enter a work summary of 20 to 2000 characters' USING ERRCODE = '22023';
    END IF;
    UPDATE public.staff_clock_sessions SET
      break_seconds = break_seconds + CASE WHEN break_started_at IS NULL THEN 0
        ELSE greatest(0,floor(extract(epoch FROM stamp-break_started_at)))::bigint END,
      break_started_at = NULL,
      checked_out_at = CASE WHEN p_action = 'check_out' THEN stamp ELSE NULL END,
      work_summary = CASE WHEN p_action = 'check_out' THEN btrim(p_summary) ELSE NULL END
      WHERE id = shift.id RETURNING * INTO shift;
  ELSE RAISE EXCEPTION 'Unknown attendance action' USING ERRCODE = '22023';
  END IF;
  RETURN shift;
END;
$$;
REVOKE ALL ON FUNCTION staff_attendance_private.clock_action(uuid,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION staff_attendance_private.clock_action(uuid,text,uuid,uuid,text) TO authenticated;
CREATE FUNCTION public.staff_clock_action(p_org_id uuid, p_action text, p_session_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL, p_summary text DEFAULT NULL)
RETURNS public.staff_clock_sessions LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT staff_attendance_private.clock_action(p_org_id,p_action,p_session_id,p_location_id,p_summary);
$$;
REVOKE ALL ON FUNCTION public.staff_clock_action(uuid,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_clock_action(uuid,text,uuid,uuid,text) TO authenticated;

CREATE VIEW public.staff_clock_log WITH (security_invoker = true) AS
SELECT c.*, CASE WHEN checked_out_at IS NULL THEN NULL ELSE
  greatest(0,floor((extract(epoch FROM checked_out_at-checked_in_at)-break_seconds)/60))::integer
END AS worked_minutes FROM public.staff_clock_sessions c;
REVOKE ALL ON public.staff_clock_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.staff_clock_log TO authenticated;
CREATE FUNCTION public.staff_clock_month_summary(p_org_id uuid, p_month date, p_user_id uuid DEFAULT NULL)
RETURNS TABLE(recorded_shifts bigint, completed_shifts bigint, worked_minutes bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT count(*), count(c.checked_out_at), coalesce(sum(c.worked_minutes),0)::bigint
  FROM public.staff_clock_log c WHERE c.organization_id = p_org_id
    AND c.work_date >= date_trunc('month',p_month)::date
    AND c.work_date < (date_trunc('month',p_month) + interval '1 month')::date
    AND (p_user_id IS NULL OR c.user_id = p_user_id);
$$;
REVOKE ALL ON FUNCTION public.staff_clock_month_summary(uuid,date,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_clock_month_summary(uuid,date,uuid) TO authenticated;
COMMIT;
