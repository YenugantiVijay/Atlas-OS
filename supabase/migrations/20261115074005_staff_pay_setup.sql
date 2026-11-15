BEGIN;

CREATE TABLE public.staff_locations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX staff_locations_org_name ON public.staff_locations (organization_id, lower(name));

CREATE TABLE public.staff_profiles (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 100),
  joining_on date NOT NULL CHECK (isfinite(joining_on)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, joining_on)
);
CREATE INDEX staff_profiles_directory ON public.staff_profiles (organization_id, display_name, id);

CREATE TABLE public.staff_location_assignments (
  organization_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  location_id uuid NOT NULL,
  PRIMARY KEY (organization_id, staff_id, location_id),
  FOREIGN KEY (organization_id, staff_id) REFERENCES public.staff_profiles(organization_id, id),
  FOREIGN KEY (organization_id, location_id) REFERENCES public.staff_locations(organization_id, id)
);
CREATE INDEX staff_assignments_location ON public.staff_location_assignments (organization_id, location_id);

CREATE TABLE public.staff_pay_rates (
  organization_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  joining_on date NOT NULL,
  effective_on date NOT NULL CHECK (isfinite(effective_on) AND effective_on >= joining_on),
  basis text NOT NULL CHECK (basis IN ('monthly', 'daily', 'hourly')),
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 99999999999),
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, staff_id, effective_on),
  FOREIGN KEY (organization_id, staff_id, joining_on)
    REFERENCES public.staff_profiles(organization_id, id, joining_on)
);

-- Every operation also runs under the caller's RLS. No ledger write authority is granted.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['staff_locations', 'staff_profiles', 'staff_location_assignments', 'staff_pay_rates']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', table_name);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', table_name);
    EXECUTE format('CREATE POLICY staff_setup_read ON public.%I FOR SELECT TO authenticated USING
      (public.can_read_organization_data(organization_id)
       AND public.user_has_org_role(organization_id, ''owner'', ''admin''))', table_name);
    EXECUTE format('CREATE POLICY staff_setup_insert ON public.%I FOR INSERT TO authenticated WITH CHECK
      (public.can_write_organization_operations(organization_id)
       AND public.user_has_org_role(organization_id, ''owner'', ''admin''))', table_name);
  END LOOP;
END;
$$;

GRANT INSERT (id, organization_id, name) ON public.staff_locations TO authenticated;
GRANT INSERT (id, organization_id, display_name, joining_on) ON public.staff_profiles TO authenticated;
GRANT INSERT (organization_id, staff_id, location_id) ON public.staff_location_assignments TO authenticated;
GRANT INSERT (organization_id, staff_id, joining_on, effective_on, basis, amount_paise) ON public.staff_pay_rates TO authenticated;

CREATE FUNCTION public.add_staff_profile(
  p_org_id uuid, p_staff_id uuid, p_name text, p_joining_on date, p_location_ids uuid[]
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF public.can_write_organization_operations(p_org_id) IS NOT TRUE
     OR public.user_has_org_role(p_org_id, 'owner', 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Staff setup requires an active owner or administrator' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_location_ids), 0) = 0 OR array_position(p_location_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'Choose at least one work location' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_location_ids) AS requested(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_locations l WHERE l.organization_id = p_org_id AND l.id = requested.id
    )
  ) THEN
    RAISE EXCEPTION 'A selected location is unavailable in this workspace' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.staff_profiles (id, organization_id, display_name, joining_on)
  VALUES (p_staff_id, p_org_id, btrim(p_name), p_joining_on)
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s WHERE s.organization_id = p_org_id AND s.id = p_staff_id
      AND s.display_name = btrim(p_name) AND s.joining_on = p_joining_on
  ) THEN
    RAISE EXCEPTION 'The staff profile could not be saved under this request' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.staff_location_assignments (organization_id, staff_id, location_id)
  SELECT p_org_id, p_staff_id, location_id FROM unnest(p_location_ids) AS requested(location_id)
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.add_staff_profile(uuid,uuid,text,date,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_staff_profile(uuid,uuid,text,date,uuid[]) TO authenticated;

COMMIT;
