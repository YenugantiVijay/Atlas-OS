-- ============================================================================
-- Migration 029: Organization PAN and GSTIN Format & Cross-Validation
-- ============================================================================
-- Purpose:
--   1. Enforces standard Indian tax identifier formats (PAN & GSTIN) on public.organizations.
--   2. Enforces cross-validation: when both GSTIN and PAN are present, characters 3-12
--      of the GSTIN must strictly match the PAN.
--   3. When GSTIN is supplied without PAN, automatically derives PAN from the GSTIN.
--   4. Never silently overwrites an explicitly provided PAN.
--   5. Supports legitimate exceptions: PAN and GSTIN remain optional/nullable for
--      exempt non-corporate entities or non-registered businesses.
--   6. Preserves existing organization records and historical data integrity.
--   7. Updates the create_organization RPC to align with this validation rule.
-- ============================================================================

-- 1. Validation trigger function for public.organizations
CREATE OR REPLACE FUNCTION public.validate_organization_pan_gstin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Normalize whitespace and casing
    IF NEW.gstin IS NOT NULL THEN
        NEW.gstin := upper(trim(NEW.gstin));
        IF NEW.gstin = '' THEN
            NEW.gstin := NULL;
        END IF;
    END IF;

    IF NEW.pan IS NOT NULL THEN
        NEW.pan := upper(trim(NEW.pan));
        IF NEW.pan = '' THEN
            NEW.pan := NULL;
        END IF;
    END IF;

    -- Validate GSTIN format if present
    IF NEW.gstin IS NOT NULL THEN
        IF NEW.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' THEN
            RAISE EXCEPTION 'ERR_VALIDATION_GSTIN: Invalid Indian GSTIN format "%". Expected 15-character format (e.g. 29ABCDE1234F1Z5)', NEW.gstin;
        END IF;
    END IF;

    -- Validate PAN format if present
    IF NEW.pan IS NOT NULL THEN
        IF NEW.pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$' THEN
            RAISE EXCEPTION 'ERR_VALIDATION_PAN: Invalid Indian PAN format "%". Expected 10-character format (e.g. ABCDE1234F)', NEW.pan;
        END IF;
    END IF;

    -- Cross-validate: if both GSTIN and PAN are present, verify embedded PAN matches submitted PAN
    IF NEW.gstin IS NOT NULL AND NEW.pan IS NOT NULL THEN
        IF substring(NEW.gstin from 3 for 10) != NEW.pan THEN
            RAISE EXCEPTION 'ERR_PAN_GSTIN_MISMATCH: PAN "%" does not match the PAN embedded within GSTIN "%"', NEW.pan, NEW.gstin;
        END IF;
    ELSIF NEW.gstin IS NOT NULL AND NEW.pan IS NULL THEN
        -- Auto-derive PAN from GSTIN if PAN was not supplied
        NEW.pan := substring(NEW.gstin from 3 for 10);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_organization_pan_gstin ON public.organizations;
CREATE TRIGGER trg_validate_organization_pan_gstin
    BEFORE INSERT OR UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.validate_organization_pan_gstin();

-- 2. Update create_organization RPC to enforce PAN/GSTIN cross-validation
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
    p_business_category public.business_category_type DEFAULT NULL,
    p_sells_electrical_products BOOLEAN DEFAULT TRUE,
    p_product_lines TEXT[] DEFAULT '{}',
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
    v_product_lines TEXT[];
    v_request_hash TEXT;
    v_existing_org_id UUID;
    v_existing_hash TEXT;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_eligibility JSONB;
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

    -- Cross-validation: GSTIN embedded PAN vs PAN
    IF v_gstin IS NOT NULL AND v_pan IS NOT NULL THEN
        IF substring(v_gstin from 3 for 10) != v_pan THEN
            RAISE EXCEPTION 'ERR_PAN_GSTIN_MISMATCH: PAN "%" does not match the PAN embedded within GSTIN "%"', v_pan, v_gstin;
        END IF;
    ELSIF v_gstin IS NOT NULL AND v_pan IS NULL THEN
        v_pan := substring(v_gstin from 3 for 10);
    END IF;

    -- Business Eligibility Validations: Category and Electrical declaration are mandatory
    IF p_business_category IS NULL THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Business category declaration (p_business_category) is required';
    END IF;

    IF p_sells_electrical_products IS NULL THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Electrical products declaration (p_sells_electrical_products) is required';
    END IF;

    IF p_business_category = 'hardware_electrical' AND p_sells_electrical_products = false THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Hardware shops must sell electrical products to use ATLAS OS';
    END IF;

    -- Sanitize and canonicalize product lines
    SELECT coalesce(array_agg(DISTINCT trimmed_line ORDER BY trimmed_line), '{}'::text[])
      INTO v_product_lines
      FROM (
          SELECT trim(line) AS trimmed_line
          FROM unnest(coalesce(p_product_lines, '{}'::text[])) AS line
          WHERE line IS NOT NULL AND length(trim(line)) > 0
      ) sanitized;

    -- Sanitization of auxiliary fields
    v_phone := NULLIF(trim(p_phone), '');
    v_email := NULLIF(trim(p_email), '');
    v_address_line1 := NULLIF(trim(p_address_line1), '');
    v_city := NULLIF(trim(p_city), '');
    v_state := NULLIF(trim(p_state), '');
    v_pincode := NULLIF(trim(p_pincode), '');

    -- 3. Idempotency handling
    IF p_idempotency_key IS NOT NULL THEN
        v_request_hash := md5(concat_ws('|',
            v_trimmed_name,
            coalesce(v_trimmed_legal, ''),
            coalesce(v_gstin, ''),
            coalesce(v_pan, ''),
            v_currency,
            coalesce(v_phone, ''),
            coalesce(v_email, ''),
            coalesce(v_address_line1, ''),
            coalesce(v_city, ''),
            coalesce(v_state, ''),
            coalesce(v_pincode, ''),
            p_business_category::text,
            p_sells_electrical_products::text,
            coalesce(array_to_string(v_product_lines, ','), '')
        ));

        SELECT organization_id, request_hash
          INTO v_existing_org_id, v_existing_hash
          FROM public.organization_creation_requests
         WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                SELECT jsonb_build_object(
                    'id', o.id,
                    'name', o.name,
                    'legal_name', o.legal_name,
                    'gstin', o.gstin,
                    'pan', o.pan,
                    'currency', o.currency,
                    'phone', o.phone,
                    'email', o.email,
                    'address_line1', o.address_line1,
                    'city', o.city,
                    'state', o.state,
                    'pincode', o.pincode,
                    'created_at', o.created_at,
                    'updated_at', o.updated_at,
                    'role', 'owner',
                    'idempotent_replay', true
                ) INTO v_org_json
                FROM public.organizations o
                WHERE o.id = v_existing_org_id;

                RETURN v_org_json;
            ELSE
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Idempotency key already used with different parameters';
            END IF;
        END IF;
    END IF;

    -- 4. Create Organization
    INSERT INTO public.organizations (
        name,
        legal_name,
        gstin,
        pan,
        currency,
        phone,
        email,
        address_line1,
        city,
        state,
        pincode,
        created_at,
        updated_at
    ) VALUES (
        v_trimmed_name,
        v_trimmed_legal,
        v_gstin,
        v_pan,
        v_currency,
        v_phone,
        v_email,
        v_address_line1,
        v_city,
        v_state,
        v_pincode,
        v_now,
        v_now
    )
    RETURNING id INTO v_org_id;

    -- 5. Create Owner Membership
    INSERT INTO public.memberships (
        organization_id,
        user_id,
        role,
        is_active,
        created_at
    ) VALUES (
        v_org_id,
        v_uid,
        'owner',
        true,
        v_now
    );

    -- 6. Atomic Self-Declaration of Eligibility (invokes trial initializer internally on approval)
    v_eligibility := public.self_declare_organization_eligibility(
        v_org_id,
        p_business_category,
        p_sells_electrical_products,
        v_product_lines
    );

    -- 7. Record Idempotency mapping
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.organization_creation_requests (
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
        metadata,
        created_at
    ) VALUES (
        v_org_id,
        v_uid,
        'ORGANIZATION_CREATED_ATOMIC',
        'organizations',
        v_org_id,
        jsonb_build_object(
            'name', v_trimmed_name,
            'category', p_business_category,
            'sells_electrical', p_sells_electrical_products,
            'eligibility_status', v_eligibility->>'status',
            'pan', v_pan,
            'gstin', v_gstin
        ),
        v_now
    );

    -- 9. Return synthesized organization response
    RETURN jsonb_build_object(
        'id', v_org_id,
        'name', v_trimmed_name,
        'legal_name', v_trimmed_legal,
        'gstin', v_gstin,
        'pan', v_pan,
        'currency', v_currency,
        'phone', v_phone,
        'email', v_email,
        'address_line1', v_address_line1,
        'city', v_city,
        'state', v_state,
        'pincode', v_pincode,
        'role', 'owner',
        'eligibility_status', v_eligibility->>'status',
        'business_category', v_eligibility->>'category',
        'sells_electrical_products', (v_eligibility->>'sells_electrical')::boolean,
        'product_lines', v_eligibility->'product_lines',
        'rejection_reason', v_eligibility->>'rejection_reason',
        'reviewer_notes', v_eligibility->>'reviewer_notes',
        'trial_initialized', (v_eligibility->>'trial_initialized')::boolean,
        'created_at', v_now,
        'updated_at', v_now,
        'idempotent_replay', false
    );
END;
$$;
