-- ============================================================================
-- Migration 012: Atomic Organization Creation RPC with User-Scoped Idempotency
-- ============================================================================
-- Purpose:
--   Enables atomic, authenticated organization and initial owner membership
--   creation. Replaces vulnerable client-side direct inserts with a server-side
--   SECURITY DEFINER RPC.
--
-- Security Hardening (Phase 1.2):
--   1. Direct authenticated INSERT on organization_creation_idempotency is REMOVED.
--      Only this trusted SECURITY DEFINER RPC may record idempotency mappings.
--   2. Strict schema alignment against migration 001:
--      - organizations: uses (id, name, legal_name, gstin, pan, currency, created_at, updated_at).
--        No non-existent 'created_by' column is referenced.
--      - memberships: uses (organization_id, user_id, role, is_active, created_at, updated_at).
--      - audit_events: uses exact schema (organization_id, actor_id, action, entity_type, entity_id, details).
--   3. Transaction-level pg_advisory_xact_lock prevents race conditions on
--      duplicate concurrent submissions by the same user.
--   4. User-scoped idempotency table tracks request payload fingerprint (MD5);
--      detects identical re-submission (idempotent replay) vs altered payload (conflict).
--   5. Strictly bounds organization name, currency (INR), GSTIN, and PAN formats.
--   6. Grants minimal execute privilege to authenticated role only.
-- ============================================================================

-- 1. Idempotency tracking table (scoped to authenticated user)
CREATE TABLE IF NOT EXISTS public.organization_creation_idempotency (
    idempotency_key UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, idempotency_key)
);

-- Enable RLS on idempotency tracking table
ALTER TABLE public.organization_creation_idempotency ENABLE ROW LEVEL SECURITY;

-- Read policy: Users may only inspect their own idempotency mappings
DROP POLICY IF EXISTS idempotency_user_select ON public.organization_creation_idempotency;
CREATE POLICY idempotency_user_select ON public.organization_creation_idempotency
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- SECURITY CRITICAL: Drop any direct insert/update/delete policies for authenticated users.
-- Only the trusted SECURITY DEFINER create_organization RPC or service_role may insert mappings.
DROP POLICY IF EXISTS idempotency_user_insert ON public.organization_creation_idempotency;

-- Minimal grants: Revoke direct writes from PUBLIC and authenticated
REVOKE ALL ON TABLE public.organization_creation_idempotency FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_creation_idempotency FROM authenticated;
GRANT SELECT ON TABLE public.organization_creation_idempotency TO authenticated;
GRANT ALL ON TABLE public.organization_creation_idempotency TO service_role;

-- 2. Atomic Organization Creation RPC
CREATE OR REPLACE FUNCTION public.create_organization(
    p_name VARCHAR(255),
    p_legal_name VARCHAR(255) DEFAULT NULL,
    p_gstin VARCHAR(15) DEFAULT NULL,
    p_pan VARCHAR(10) DEFAULT NULL,
    p_currency VARCHAR(3) DEFAULT 'INR',
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_org_id UUID;
    v_trimmed_name VARCHAR(255);
    v_trimmed_legal VARCHAR(255);
    v_gstin VARCHAR(15);
    v_pan VARCHAR(10);
    v_currency VARCHAR(3);
    v_request_hash TEXT;
    v_existing_org_id UUID;
    v_existing_hash TEXT;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_org_json JSONB;
BEGIN
    -- 1. Authenticate caller
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ERR_UNAUTHENTICATED: Caller must be authenticated to create an organization';
    END IF;

    -- 2. Input validation & sanitization
    v_trimmed_name := trim(p_name);
    IF v_trimmed_name IS NULL OR length(v_trimmed_name) < 2 OR length(v_trimmed_name) > 255 THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Organization name must be between 2 and 255 characters';
    END IF;

    IF p_legal_name IS NOT NULL THEN
        v_trimmed_legal := trim(p_legal_name);
        IF length(v_trimmed_legal) > 255 THEN
            RAISE EXCEPTION 'ERR_VALIDATION: Legal name must not exceed 255 characters';
        END IF;
    ELSE
        v_trimmed_legal := NULL;
    END IF;

    -- Currency: Only INR supported for Indian electrical trade
    v_currency := upper(trim(coalesce(p_currency, 'INR')));
    IF v_currency != 'INR' THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Unsupported currency "%". ATLAS OS currently supports INR only', v_currency;
    END IF;

    -- GSTIN validation: Indian standard 15-character alphanumeric format
    IF p_gstin IS NOT NULL AND trim(p_gstin) != '' THEN
        v_gstin := upper(trim(p_gstin));
        IF v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' THEN
            RAISE EXCEPTION 'ERR_VALIDATION: Invalid GSTIN format "%". Expected standard 15-character Indian GSTIN', v_gstin;
        END IF;
    ELSE
        v_gstin := NULL;
    END IF;

    -- PAN validation: Indian standard 10-character format (5 alpha, 4 digit, 1 alpha)
    IF p_pan IS NOT NULL AND trim(p_pan) != '' THEN
        v_pan := upper(trim(p_pan));
        IF v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$' THEN
            RAISE EXCEPTION 'ERR_VALIDATION: Invalid PAN format "%". Expected standard 10-character Indian PAN', v_pan;
        END IF;
    ELSE
        v_pan := NULL;
    END IF;

    -- 3. Idempotency handling with transaction advisory locking
    IF p_idempotency_key IS NOT NULL THEN
        -- Acquire a transaction-level advisory lock hashed to the user and key to serialize concurrent submissions
        PERFORM pg_advisory_xact_lock(hashtext('org_create:' || v_uid::text || ':' || p_idempotency_key::text));

        -- Canonical request fingerprint
        v_request_hash := md5(
            coalesce(v_trimmed_name, '') || '|' ||
            coalesce(v_trimmed_legal, '') || '|' ||
            coalesce(v_gstin, '') || '|' ||
            coalesce(v_pan, '') || '|' ||
            v_currency
        );

        -- Check if key already processed for this user
        SELECT organization_id, request_hash
          INTO v_existing_org_id, v_existing_hash
          FROM public.organization_creation_idempotency
         WHERE user_id = v_uid
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                -- Exact replay: return existing organization details
                SELECT jsonb_build_object(
                    'id', o.id,
                    'name', o.name,
                    'legal_name', o.legal_name,
                    'gstin', o.gstin,
                    'pan', o.pan,
                    'currency', o.currency,
                    'created_at', o.created_at,
                    'updated_at', o.updated_at,
                    'idempotent_replay', true
                ) INTO v_org_json
                FROM public.organizations o
                WHERE o.id = v_existing_org_id;

                RETURN v_org_json;
            ELSE
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Idempotency key "%" reused with different request payload', p_idempotency_key;
            END IF;
        END IF;
    END IF;

    -- 4. Server-side UUID generation ensures client cannot hijack existing IDs
    v_org_id := gen_random_uuid();

    -- 5. Atomically insert organization using exact schema from migration 001
    INSERT INTO public.organizations (
        id,
        name,
        legal_name,
        gstin,
        pan,
        currency,
        created_at,
        updated_at
    ) VALUES (
        v_org_id,
        v_trimmed_name,
        v_trimmed_legal,
        v_gstin,
        v_pan,
        v_currency,
        v_now,
        v_now
    );

    -- 6. Atomically insert initial owner membership using exact schema from migration 001
    INSERT INTO public.memberships (
        organization_id,
        user_id,
        role,
        is_active,
        created_at,
        updated_at
    ) VALUES (
        v_org_id,
        v_uid,
        'owner',
        true,
        v_now,
        v_now
    );

    -- 7. Record idempotency token if provided (executed within SECURITY DEFINER context)
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.organization_creation_idempotency (
            idempotency_key,
            user_id,
            organization_id,
            request_hash,
            created_at
        ) VALUES (
            p_idempotency_key,
            v_uid,
            v_org_id,
            v_request_hash,
            v_now
        );
    END IF;

    -- 8. Record audit event using exact checked-in schema from migration 001
    -- audit_events: (organization_id, actor_id, action, entity_type, entity_id, details)
    INSERT INTO public.audit_events (
        organization_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
    ) VALUES (
        v_org_id,
        v_uid,
        'CREATE_ORGANIZATION',
        'ORGANIZATION',
        v_org_id,
        jsonb_build_object(
            'name', v_trimmed_name,
            'currency', v_currency,
            'idempotency_key', p_idempotency_key
        ),
        v_now
    );

    -- 9. Construct return JSON payload
    SELECT jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'legal_name', o.legal_name,
        'gstin', o.gstin,
        'pan', o.pan,
        'currency', o.currency,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'idempotent_replay', false
    ) INTO v_org_json
    FROM public.organizations o
    WHERE o.id = v_org_id;

    RETURN v_org_json;
END;
$$;

-- 3. Restrict privileges: only authenticated users and service_role can invoke
REVOKE ALL ON FUNCTION public.create_organization(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_organization(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID) TO service_role;
