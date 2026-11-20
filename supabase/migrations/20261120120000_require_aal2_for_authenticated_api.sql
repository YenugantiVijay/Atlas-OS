CREATE OR REPLACE FUNCTION public.require_workspace_aal2()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'authenticated'
     AND COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'Authenticator verification required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_workspace_aal2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_workspace_aal2()
  TO authenticator, anon, authenticated, service_role;

DO $$
DECLARE
  v_existing_hook text;
BEGIN
  SELECT split_part(cfg.setting, '=', 2)
    INTO v_existing_hook
  FROM pg_db_role_setting AS setting
  CROSS JOIN LATERAL unnest(setting.setconfig) AS cfg(setting)
  WHERE setting.setrole = 'authenticator'::regrole
    AND setting.setdatabase IN (
      0,
      (SELECT oid FROM pg_database WHERE datname = current_database())
    )
    AND cfg.setting LIKE 'pgrst.db_pre_request=%'
  ORDER BY setting.setdatabase DESC
  LIMIT 1;

  IF v_existing_hook IS NOT NULL
     AND v_existing_hook <> 'public.require_workspace_aal2' THEN
    RAISE EXCEPTION
      'Existing pgrst.db_pre_request hook (%) must be composed with public.require_workspace_aal2 before applying this migration',
      v_existing_hook;
  END IF;
END;
$$;

DO $$
BEGIN
  EXECUTE format(
    'ALTER ROLE authenticator IN DATABASE %I SET pgrst.db_pre_request = %L',
    current_database(),
    'public.require_workspace_aal2'
  );
END;
$$;
NOTIFY pgrst, 'reload config';

DO $$
DECLARE
  v_table record;
  v_storage_objects regclass := to_regclass('storage.objects');
BEGIN
  FOR v_table IN
    SELECT c.oid, n.nspname, c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'atlas_private')
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy AS p
      WHERE p.polrelid = v_table.oid
        AND p.polname = 'atlas_require_aal2'
    ) THEN
      EXECUTE format(
        'CREATE POLICY atlas_require_aal2 ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT auth.jwt() ->> ''aal'') = ''aal2'') WITH CHECK ((SELECT auth.jwt() ->> ''aal'') = ''aal2'')',
        v_table.nspname,
        v_table.relname
      );
    END IF;
  END LOOP;

  IF v_storage_objects IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_policy AS p
       WHERE p.polrelid = v_storage_objects
         AND p.polname = 'atlas_require_aal2'
     ) THEN
    EXECUTE
      'CREATE POLICY atlas_require_aal2 ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT auth.jwt() ->> ''aal'') = ''aal2'') WITH CHECK ((SELECT auth.jwt() ->> ''aal'') = ''aal2'')';
  END IF;
END;
$$;
