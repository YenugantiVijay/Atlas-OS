-- ============================================================================
-- Migration 018: Atomic Organization Creation RPC with Complete Entity Attributes
-- ============================================================================
-- Purpose:
--   Resolves two-stage organization creation vulnerability where organization and
--   initial owner membership were created via create_organization RPC, but auxiliary
--   contact and warehouse address attributes (phone, email, address_line1, city, state,
--   pincode) required a secondary client-side UPDATE statement.
--
-- Solution:
--   Enhances public.create_organization to atomically accept and persist all
--   supported organization attributes in a single ACID transaction within
--   the SECURITY DEFINER context.
--
-- Security & Immutability:
--   1. Drop existing 6-parameter create_organization function signature.
--   2. Re-create public.create_organization with 12 parameters (parameters 2-12 have
--      default NULL/INR to preserve 100% backward compatibility with 6-param callers).
--   3. Transaction advisory lock pg_advisory_xact_lock serializes submissions per user.
--   4. Fingerprints all payload parameters into request_hash for user-scoped idempotency.
--   5. Atomically inserts organization, initial owner membership, idempotency record,
--      and audit log event in a single transaction.
--   6. Grants EXECUTE to 'authenticated' and 'service_role'.
--   7. Revokes ALL from 'PUBLIC' and 'anon'.
-- ============================================================================

-- 1. Drop old function signatures to prevent ambiguous function resolution
DROP FUNCTION IF EXISTS public.create_organization(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID);
DROP FUNCTION IF EXISTS public.create_organization(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS public.create_organization(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, UUID);

-- 2. Enhanced atomic organization creation function
CREATE OR REPLACE FUNCTION public.create_organization(
    p_name VARCHAR(255),
    p_legal_name VARCHAR(255) DEFAULT NULL,
    p_gstin VARCHAR(15) DEFAULT NULL,
    p_pan VARCHAR(10) DEFAULT NULL,
    p_currency VARCHAR(3) DEFAULT 'INR',
    p_phone VARCHAR(50) DEFAULT NULL,
    p_email VARCHAR(255) DEFAULT NULL,
    p_address_line1 TEXT DEFAULT NULL,
    p_city VARCHAR(100) DEFAULT NULL,
    p_state VARCHAR(100) DEFAULT NULL,
    p_pincode VARCHAR(10) DEFAULT NULL,
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
    v_phone VARCHAR(50);
    v_email VARCHAR(255);
    v_address_line1 TEXT;
    v_city VARCHAR(100);
    v_state VARCHAR(100);
    v_pincode VARCHAR(10);
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

    -- GSTIN validation
    IF p_gstin IS NOT NULL AND trim(p_gstin) != '' THEN
        v_gstin := upper(trim(p_gstin));
        IF v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' THEN
            RAISE EXCEPTION 'ERR_VALIDATION: Invalid GSTIN format "%". Expected standard 15-character Indian GSTIN', v_gstin;
        END IF;
    ELSE
        v_gstin := NULL;
    END IF;

    -- PAN validation
    IF p_pan IS NOT NULL AND trim(p_pan) != '' THEN
        v_pan := upper(trim(p_pan));
        IF v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$' THEN
            RAISE EXCEPTION 'ERR_VALIDATION: Invalid PAN format "%". Expected standard 10-character Indian PAN', v_pan;
        END IF;
    ELSE
        v_pan := NULL;
    END IF;

    -- Sanitization of auxiliary fields
    v_phone := NULLIF(trim(p_phone), '');
    v_email := NULLIF(trim(p_email), '');
    v_address_line1 := NULLIF(trim(p_address_line1), '');
    v_city := NULLIF(trim(p_city), '');
    v_state := NULLIF(trim(p_state), '');
    v_pincode := NULLIF(trim(p_pincode), '');

    -- 3. Idempotency handling with transaction advisory locking
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('org_create:' || v_uid::text || ':' || p_idempotency_key::text));

        -- Canonical request fingerprint including auxiliary attributes
        v_request_hash := md5(
            coalesce(v_trimmed_name, '') || '|' ||
            coalesce(v_trimmed_legal, '') || '|' ||
            coalesce(v_gstin, '') || '|' ||
            coalesce(v_pan, '') || '|' ||
            v_currency || '|' ||
            coalesce(v_phone, '') || '|' ||
            coalesce(v_email, '') || '|' ||
            coalesce(v_address_line1, '') || '|' ||
            coalesce(v_city, '') || '|' ||
            coalesce(v_state, '') || '|' ||
            coalesce(v_pincode, '')
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
                    'phone', o.phone,
                    'email', o.email,
                    'address_line1', o.address_line1,
                    'city', o.city,
                    'state', o.state,
                    'pincode', o.pincode,
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

    -- 4. Server-side UUID generation
    v_org_id := gen_random_uuid();

    -- 5. Atomically insert organization with ALL fields
    INSERT INTO public.organizations (
        id,
        name,
        legal_name,
        gstin,
        pan,
        phone,
        email,
        address_line1,
        city,
        state,
        pincode,
        currency,
        created_at,
        updated_at
    ) VALUES (
        v_org_id,
        v_trimmed_name,
        v_trimmed_legal,
        v_gstin,
        v_pan,
        v_phone,
        v_email,
        v_address_line1,
        v_city,
        v_state,
        v_pincode,
        v_currency,
        v_now,
        v_now
    );

    -- 6. Atomically insert initial owner membership
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

    -- 7. Record idempotency token if provided
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

    -- 8. Record audit event
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

    -- 9. Construct return JSON payload with all fields
    SELECT jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'legal_name', o.legal_name,
        'gstin', o.gstin,
        'pan', o.pan,
        'phone', o.phone,
        'email', o.email,
        'address_line1', o.address_line1,
        'city', o.city,
        'state', o.state,
        'pincode', o.pincode,
        'currency', o.currency,
        'created_at', o.created_at,
        'updated_at', o.updated_at
    ) INTO v_org_json
    FROM public.organizations o
    WHERE o.id = v_org_id;

    RETURN v_org_json;
END;
$$;

-- 10. Privilege grants
REVOKE ALL ON FUNCTION public.create_organization(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_organization(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, UUID
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_organization(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, UUID
) TO service_role;
