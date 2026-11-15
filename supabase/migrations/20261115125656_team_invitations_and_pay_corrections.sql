BEGIN;

CREATE TABLE atlas_private.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  role text NOT NULL CHECK (role IN ('admin','sales','inventory','accounts','viewer')),
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  last_delivery_at timestamptz,
  delivery_count integer NOT NULL DEFAULT 0 CHECK (delivery_count BETWEEN 0 AND 5),
  CHECK ((accepted_by IS NULL) = (accepted_at IS NULL)),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
ALTER TABLE atlas_private.team_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_private.team_invitations FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX team_invites_by_workspace_date ON atlas_private.team_invitations (organization_id, created_at DESC);
CREATE UNIQUE INDEX team_pending_invitation_email ON atlas_private.team_invitations (organization_id,email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE FUNCTION atlas_private.create_team_invitation(p_org_id uuid,p_email text,p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  email_key text := lower(btrim(p_email));
  invitation atlas_private.team_invitations%ROWTYPE;
BEGIN
  IF actor IS NULL OR public.user_has_org_role(p_org_id,'owner') IS NOT TRUE THEN
    RAISE EXCEPTION 'Only an active workspace owner can invite members' USING ERRCODE = '42501';
  END IF;
  IF email_key IS NULL OR char_length(email_key) > 254 OR email_key !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    OR p_role IS NULL OR p_role NOT IN ('admin','sales','inventory','accounts','viewer') THEN
    RAISE EXCEPTION 'Enter a valid email address and team role' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('team_invitation:' || p_org_id::text,0));
  IF EXISTS (SELECT 1 FROM public.memberships m JOIN auth.users u ON u.id=m.user_id
      WHERE m.organization_id=p_org_id AND lower(u.email)=email_key) THEN
    RAISE EXCEPTION 'This account already has a membership record in this workspace' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO invitation FROM atlas_private.team_invitations i
    WHERE i.organization_id=p_org_id AND i.email=email_key AND i.accepted_at IS NULL AND i.revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF invitation.expires_at > now() AND EXISTS (
      SELECT 1 FROM public.memberships m WHERE m.organization_id=p_org_id AND m.user_id=invitation.invited_by
        AND m.is_active AND m.role='owner'
    ) THEN
      IF invitation.role <> p_role THEN
        RAISE EXCEPTION 'Revoke the pending invitation before changing its role' USING ERRCODE = '23505';
      END IF;
      RETURN jsonb_build_object('id',invitation.id,'expires_at',invitation.expires_at);
    END IF;
    UPDATE atlas_private.team_invitations SET revoked_at=now() WHERE id=invitation.id;
  END IF;
  IF (SELECT count(*) FROM atlas_private.team_invitations i
    WHERE i.organization_id=p_org_id AND i.created_at > now()-interval '1 day') >= 40 THEN
    RAISE EXCEPTION 'The workspace invitation limit was reached for today' USING ERRCODE = '23514';
  END IF;
  INSERT INTO atlas_private.team_invitations (organization_id,email,role,invited_by)
    VALUES (p_org_id,email_key,p_role,actor) RETURNING * INTO invitation;
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,details)
    VALUES (p_org_id,actor,'TEAM_INVITATION_CREATED','TEAM_INVITATION',jsonb_build_object('role',p_role));
  RETURN jsonb_build_object('id',invitation.id,'expires_at',invitation.expires_at);
END;
$$;

CREATE FUNCTION atlas_private.list_team_invitations(p_org_id uuid)
RETURNS TABLE(id uuid,email text,role text,expires_at timestamptz,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.id,i.email,i.role,i.expires_at,i.created_at
  FROM atlas_private.team_invitations i
  WHERE auth.uid() IS NOT NULL AND public.user_has_org_role(p_org_id,'owner')
    AND i.organization_id=p_org_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
  ORDER BY i.created_at DESC,i.id DESC;
$$;

CREATE FUNCTION atlas_private.revoke_team_invitation(p_org_id uuid,p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.user_has_org_role(p_org_id,'owner') IS NOT TRUE THEN
    RAISE EXCEPTION 'Only an active workspace owner can revoke invitations' USING ERRCODE = '42501';
  END IF;
  UPDATE atlas_private.team_invitations SET revoked_at=now()
    WHERE organization_id=p_org_id AND id=p_invite_id AND accepted_at IS NULL AND revoked_at IS NULL;
  IF FOUND THEN
    INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type)
      VALUES (p_org_id,auth.uid(),'TEAM_INVITATION_REVOKED','TEAM_INVITATION');
  ELSIF EXISTS (SELECT 1 FROM atlas_private.team_invitations i
    WHERE i.organization_id=p_org_id AND i.id=p_invite_id AND i.accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'The invitation was already accepted. Manage that member’s access from Team.' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION atlas_private.accept_team_invitation(p_invite_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  verified_email text;
  workspace_id uuid;
  invitation atlas_private.team_invitations%ROWTYPE;
  member_id uuid;
BEGIN
  SELECT lower(email) INTO verified_email FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL;
  IF verified_email IS NULL THEN
    RAISE EXCEPTION 'Sign in with a verified email to accept an invitation' USING ERRCODE = '42501';
  END IF;
  SELECT i.organization_id INTO workspace_id FROM atlas_private.team_invitations i WHERE i.id=p_invite_id AND i.email=verified_email;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This invitation is unavailable for the signed-in email' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('team_invitation:' || workspace_id::text,0));
  SELECT * INTO invitation FROM atlas_private.team_invitations WHERE id=p_invite_id FOR UPDATE;
  IF NOT FOUND OR invitation.email <> verified_email OR invitation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation is unavailable for the signed-in email' USING ERRCODE = '42501';
  END IF;
  IF invitation.accepted_by=actor AND EXISTS (SELECT 1 FROM public.memberships m
    WHERE m.organization_id=invitation.organization_id AND m.user_id=actor AND m.is_active) THEN
    RETURN invitation.organization_id;
  END IF;
  IF invitation.accepted_at IS NOT NULL OR invitation.expires_at<=now() OR NOT EXISTS (
    SELECT 1 FROM public.memberships m WHERE m.organization_id=invitation.organization_id
      AND m.user_id=invitation.invited_by AND m.is_active AND m.role='owner'
  ) THEN
    RAISE EXCEPTION 'This invitation is no longer available' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.memberships(organization_id,user_id,role)
    VALUES (invitation.organization_id,actor,invitation.role)
    ON CONFLICT (organization_id,user_id) DO NOTHING RETURNING id INTO member_id;
  IF member_id IS NULL THEN
    RAISE EXCEPTION 'An existing workspace membership needs to be managed by an owner' USING ERRCODE = '23505';
  END IF;
  UPDATE atlas_private.team_invitations SET accepted_by=actor,accepted_at=now() WHERE id=p_invite_id;
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,details)
    VALUES (invitation.organization_id,actor,'TEAM_INVITATION_ACCEPTED','MEMBERSHIP',member_id,
      jsonb_build_object('role',invitation.role));
  RETURN invitation.organization_id;
END;
$$;

CREATE FUNCTION atlas_private.claim_team_invite_delivery(p_org_id uuid,p_invite_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  invitation atlas_private.team_invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.user_has_org_role(p_org_id,'owner') IS NOT TRUE THEN
    RAISE EXCEPTION 'Only a workspace owner can send invitation email' USING ERRCODE = '42501';
  END IF;
  UPDATE atlas_private.team_invitations i SET delivery_count=i.delivery_count+1,last_delivery_at=now()
    WHERE i.id=p_invite_id AND i.organization_id=p_org_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      AND i.expires_at>now() AND i.delivery_count<5
      AND (i.last_delivery_at IS NULL OR i.last_delivery_at < now()-interval '60 seconds')
      AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.organization_id=p_org_id
        AND m.user_id=i.invited_by AND m.is_active AND m.role='owner')
    RETURNING * INTO invitation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation is unavailable or the email retry limit was reached' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('email',invitation.email,'workspace',
    (SELECT name FROM public.organizations WHERE id=p_org_id),'role',invitation.role,'attempt',invitation.delivery_count);
END;
$$;

CREATE FUNCTION public.create_team_invitation(p_org_id uuid,p_email text,p_role text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.create_team_invitation(p_org_id,p_email,p_role);
$$;
CREATE FUNCTION public.list_team_invitations(p_org_id uuid)
RETURNS TABLE(id uuid,email text,role text,expires_at timestamptz,created_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM atlas_private.list_team_invitations(p_org_id);
$$;
CREATE FUNCTION public.revoke_team_invitation(p_org_id uuid,p_invite_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.revoke_team_invitation(p_org_id,p_invite_id);
$$;
CREATE FUNCTION public.accept_team_invitation(p_invite_id uuid)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.accept_team_invitation(p_invite_id);
$$;
CREATE FUNCTION public.claim_team_invite_delivery(p_org_id uuid,p_invite_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.claim_team_invite_delivery(p_org_id,p_invite_id);
$$;
REVOKE ALL ON FUNCTION atlas_private.create_team_invitation(uuid,text,text), public.create_team_invitation(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.create_team_invitation(uuid,text,text), public.create_team_invitation(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION atlas_private.list_team_invitations(uuid), public.list_team_invitations(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.list_team_invitations(uuid), public.list_team_invitations(uuid) TO authenticated;
REVOKE ALL ON FUNCTION atlas_private.revoke_team_invitation(uuid,uuid), public.revoke_team_invitation(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.revoke_team_invitation(uuid,uuid), public.revoke_team_invitation(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION atlas_private.accept_team_invitation(uuid), public.accept_team_invitation(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.accept_team_invitation(uuid), public.accept_team_invitation(uuid) TO authenticated;
REVOKE ALL ON FUNCTION atlas_private.claim_team_invite_delivery(uuid,uuid), public.claim_team_invite_delivery(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.claim_team_invite_delivery(uuid,uuid), public.claim_team_invite_delivery(uuid,uuid) TO authenticated;

CREATE FUNCTION atlas_private.team_member_directory(p_org_id uuid)
RETURNS TABLE(id uuid,user_id uuid,role text,is_active boolean,created_at timestamptz,email text,full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id,m.user_id,m.role::text,m.is_active,m.created_at,u.email::text,
         COALESCE(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''))
  FROM public.memberships m LEFT JOIN auth.users u ON u.id=m.user_id
  WHERE m.organization_id=p_org_id AND auth.uid() IS NOT NULL AND public.user_has_org_role(p_org_id,'owner','admin')
  ORDER BY m.created_at,m.id;
$$;
CREATE FUNCTION public.team_member_directory(p_org_id uuid)
RETURNS TABLE(id uuid,user_id uuid,role text,is_active boolean,created_at timestamptz,email text,full_name text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM atlas_private.team_member_directory(p_org_id);
$$;
REVOKE ALL ON FUNCTION atlas_private.team_member_directory(uuid),public.team_member_directory(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.team_member_directory(uuid),public.team_member_directory(uuid) TO authenticated;

CREATE TABLE public.staff_pay_rate_corrections (
  organization_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  effective_on date NOT NULL,
  revision integer NOT NULL CHECK (revision > 1),
  basis text NOT NULL CHECK (basis IN ('monthly','daily','hourly')),
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 99999999999),
  reason text NOT NULL CHECK (reason=btrim(reason) AND char_length(reason) BETWEEN 1 AND 300),
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,staff_id,effective_on,revision),
  FOREIGN KEY (organization_id,staff_id,effective_on)
    REFERENCES public.staff_pay_rates(organization_id,staff_id,effective_on)
);
ALTER TABLE public.staff_pay_rate_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_pay_rate_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.staff_pay_rate_corrections TO authenticated;
GRANT INSERT (organization_id,staff_id,effective_on,revision,basis,amount_paise,reason) ON public.staff_pay_rate_corrections TO authenticated;
CREATE POLICY pay_correction_read ON public.staff_pay_rate_corrections FOR SELECT TO authenticated USING (
  public.can_read_organization_data(organization_id) AND public.user_has_org_role(organization_id,'owner','admin')
);
CREATE POLICY pay_correction_insert ON public.staff_pay_rate_corrections FOR INSERT TO authenticated WITH CHECK (
  public.can_write_organization_operations(organization_id) AND public.user_has_org_role(organization_id,'owner','admin')
);
CREATE FUNCTION atlas_private.validate_pay_rate_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  previous_revision integer;
  previous_amount bigint;
  previous_basis text;
BEGIN
  SELECT c.revision,c.amount_paise,c.basis INTO previous_revision,previous_amount,previous_basis
    FROM public.staff_pay_rate_corrections c
    WHERE c.organization_id=NEW.organization_id AND c.staff_id=NEW.staff_id AND c.effective_on=NEW.effective_on
    ORDER BY c.revision DESC LIMIT 1;
  IF NOT FOUND THEN
    previous_revision:=1;
    SELECT r.amount_paise,r.basis INTO previous_amount,previous_basis FROM public.staff_pay_rates r
      WHERE r.organization_id=NEW.organization_id AND r.staff_id=NEW.staff_id AND r.effective_on=NEW.effective_on;
  END IF;
  IF NEW.revision<>previous_revision+1 THEN
    RAISE EXCEPTION 'The pay rate was updated. Reload its history before correcting it.' USING ERRCODE = '40001';
  END IF;
  IF (NEW.amount_paise,NEW.basis) IS NOT DISTINCT FROM (previous_amount,previous_basis) THEN
    RAISE EXCEPTION 'Enter a changed rate or pay basis' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.validate_pay_rate_revision() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER validate_pay_rate_revision BEFORE INSERT ON public.staff_pay_rate_corrections
  FOR EACH ROW EXECUTE FUNCTION atlas_private.validate_pay_rate_revision();

CREATE VIEW public.staff_pay_rate_history WITH (security_invoker=true) AS
WITH versions AS (
  SELECT organization_id,staff_id,effective_on,basis,amount_paise,1 AS revision,NULL::text AS reason,recorded_by,recorded_at
    FROM public.staff_pay_rates
  UNION ALL
  SELECT organization_id,staff_id,effective_on,basis,amount_paise,revision,reason,recorded_by,recorded_at
    FROM public.staff_pay_rate_corrections
)
SELECT *,revision=max(revision) OVER (PARTITION BY organization_id,staff_id,effective_on) AS is_latest
  FROM versions;
REVOKE ALL ON public.staff_pay_rate_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.staff_pay_rate_history TO authenticated;

COMMIT;
