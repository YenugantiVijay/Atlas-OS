-- ============================================================================
-- Migration 020: Reliability & Security Hardening
-- ============================================================================
-- Purpose:
--   1. Harden public.self_declare_organization_eligibility to explicitly reject
--      NULL business category (p_category) and NULL electrical declaration (p_sells_electrical)
--      with actionable validation exceptions before rule processing, preventing database
--      constraint crashes.
--   2. Upgrade public.create_organization idempotency hashing from delimiter-separated
--      string concatenation to unambiguous, deterministic structured JSON serialization
--      (jsonb_build_object with to_jsonb(v_product_lines)). This guarantees distinct
--      fingerprints when product line items contain commas or delimiters while preserving
--      deterministic replay for identical requests.
--   3. Preserve all existing business eligibility policies, owner authorization, audit
--      logging, trial initialization, and SECURITY DEFINER search paths.
-- ============================================================================

-- 1. Explicit Eligibility Declaration Validation (Replacing Migration 013 Function)
CREATE OR REPLACE FUNCTION public.self_declare_organization_eligibility(
    p_org_id UUID,
    p_category public.business_category_type,
    p_sells_electrical BOOLEAN,
    p_product_lines TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_old_status public.eligibility_status_type;
    v_new_status public.eligibility_status_type;
    v_action_type VARCHAR(64);
    v_rejection_reason TEXT := NULL;
    v_reviewer_notes TEXT := NULL;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_result JSONB;
BEGIN
    -- 1. Authenticate caller
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ERR_UNAUTHENTICATED: Caller must be authenticated';
    END IF;

    -- 2. Explicit Input Validation: Reject NULL category and electrical declaration upfront
    IF p_category IS NULL THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Business category declaration (p_category) is required';
    END IF;

    IF p_sells_electrical IS NULL THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Electrical products declaration (p_sells_electrical) is required';
    END IF;

    -- 3. Authorization: caller must be an active owner of the target organization
    IF NOT public.user_has_org_role(p_org_id, 'owner') THEN
        RAISE EXCEPTION 'ERR_FORBIDDEN: Only organization owners can submit eligibility declarations';
    END IF;

    -- 4. Fetch existing eligibility state
    SELECT status INTO v_old_status
    FROM public.organization_eligibility
    WHERE organization_id = p_org_id;

    -- 5. Evaluate eligibility rules
    -- Rule A: Unsupported business category
    IF p_category = 'other_unsupported' THEN
        v_new_status := 'rejected';
        v_rejection_reason := 'Unsupported business category. ATLAS OS is exclusively designed for electrical retailers, wholesalers/distributors, and hardware stores selling electrical goods.';
        v_action_type := 'AUTO_REJECTION_CATEGORY';

    -- Rule B: Does not sell electrical products
    ELSIF p_sells_electrical IS NOT TRUE THEN
        v_new_status := 'rejected';
        v_rejection_reason := 'Business does not sell electrical goods. ATLAS OS is exclusively for businesses selling electrical products.';
        v_action_type := 'AUTO_REJECTION_NO_ELECTRICAL';

    -- Rule C: Missing or empty product lines (incomplete declaration -> manual review)
    ELSIF p_product_lines IS NULL OR cardinality(p_product_lines) = 0 THEN
        v_new_status := 'review_required';
        v_reviewer_notes := 'Self-declaration lacked declared product lines. Flagged for manual review.';
        v_action_type := 'FLAGGED_INCOMPLETE_DECLARATION';

    -- Rule D: Resubmission after prior rejection cannot self-approve; queues in appeal review
    ELSIF v_old_status = 'rejected' THEN
        v_new_status := 'review_required';
        v_reviewer_notes := 'Resubmission following previous rejection. Queued for platform reviewer evaluation.';
        v_action_type := 'RESUBMISSION_QUEUED_FOR_REVIEW';

    -- Rule E: Resubmission during ongoing manual review cannot bypass review
    ELSIF v_old_status = 'review_required' THEN
        v_new_status := 'review_required';
        v_reviewer_notes := coalesce(v_reviewer_notes, 'Declaration updated while pending manual review.');
        v_action_type := 'DECLARATION_UPDATED_PENDING_REVIEW';

    -- Rule F: Valid self-declaration in supported category with electrical products
    ELSE
        v_new_status := 'approved';
        v_action_type := 'AUTO_APPROVAL_SELF_DECLARATION';
    END IF;

    -- 6. Upsert eligibility record
    INSERT INTO public.organization_eligibility (
        organization_id,
        business_category,
        sells_electrical_products,
        product_lines,
        status,
        rejection_reason,
        reviewer_notes,
        declared_at,
        declared_by,
        created_at,
        updated_at
    ) VALUES (
        p_org_id,
        p_category,
        coalesce(p_sells_electrical, false),
        coalesce(p_product_lines, '{}'),
        v_new_status,
        v_rejection_reason,
        v_reviewer_notes,
        v_now,
        v_uid,
        v_now,
        v_now
    )
    ON CONFLICT (organization_id) DO UPDATE SET
        business_category = EXCLUDED.business_category,
        sells_electrical_products = EXCLUDED.sells_electrical_products,
        product_lines = EXCLUDED.product_lines,
        status = EXCLUDED.status,
        rejection_reason = EXCLUDED.rejection_reason,
        reviewer_notes = EXCLUDED.reviewer_notes,
        declared_at = EXCLUDED.declared_at,
        declared_by = EXCLUDED.declared_by,
        updated_at = v_now;

    -- 7. If approved, initialize trial idempotently (trusted server timestamp)
    IF v_new_status = 'approved' THEN
        PERFORM public.internal_initialize_organization_trial(p_org_id);
    END IF;

    -- 8. Record immutable eligibility audit log
    INSERT INTO public.eligibility_audit_logs (
        organization_id,
        previous_status,
        new_status,
        action_type,
        actor_id,
        reason,
        snapshot,
        created_at
    ) VALUES (
        p_org_id,
        v_old_status,
        v_new_status,
        v_action_type,
        v_uid,
        coalesce(v_rejection_reason, v_reviewer_notes, 'Self-declaration processed'),
        jsonb_build_object(
            'category', p_category,
            'sells_electrical', p_sells_electrical,
            'product_lines', p_product_lines
        ),
        v_now
    );

    -- 9. Record audit event
    INSERT INTO public.audit_events (
        organization_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
    ) VALUES (
        p_org_id,
        v_uid,
        'BUSINESS_ELIGIBILITY_DECLARED',
        'ORGANIZATION_ELIGIBILITY',
        p_org_id,
        jsonb_build_object(
            'status', v_new_status,
            'action_type', v_action_type,
            'category', p_category
        ),
        v_now
    );

    -- 10. Return response
    SELECT jsonb_build_object(
        'organization_id', e.organization_id,
        'business_category', e.business_category,
        'sells_electrical_products', e.sells_electrical_products,
        'product_lines', e.product_lines,
        'status', e.status,
        'rejection_reason', e.rejection_reason,
        'declared_at', e.declared_at
    ) INTO v_result
    FROM public.organization_eligibility e
    WHERE e.organization_id = p_org_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.self_declare_organization_eligibility(UUID, public.business_category_type, BOOLEAN, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_declare_organization_eligibility(UUID, public.business_category_type, BOOLEAN, TEXT[]) TO authenticated, service_role;


-- 2. Enhanced Atomic Organization Creation with Unambiguous Structured JSON Idempotency Fingerprint
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

    -- Sanitize and canonicalize product lines: trim, remove empty/whitespace items, deduplicate, and sort
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

    -- 3. Idempotency handling with transaction advisory locking & structured JSON fingerprinting
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('org_create:' || v_uid::text || ':' || p_idempotency_key::text));

        -- Deterministic structured JSON serialization of all persisted attributes and normalized product lines
        v_request_hash := md5(jsonb_build_object(
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
            'business_category', p_business_category::text,
            'sells_electrical_products', p_sells_electrical_products,
            'product_lines', to_jsonb(v_product_lines)
        )::text);

        -- Check if key already processed for this user
        SELECT organization_id, request_hash
          INTO v_existing_org_id, v_existing_hash
          FROM public.organization_creation_idempotency
         WHERE user_id = v_uid
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                -- Exact replay: return existing organization, eligibility, and trial details
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
                    'eligibility_status', e.status,
                    'business_category', e.business_category,
                    'sells_electrical_products', e.sells_electrical_products,
                    'product_lines', e.product_lines,
                    'rejection_reason', e.rejection_reason,
                    'reviewer_notes', e.reviewer_notes,
                    'trial_initialized', EXISTS (
                        SELECT 1 FROM public.organization_subscriptions s
                        WHERE s.organization_id = o.id AND s.status = 'trialing'
                    ),
                    'created_at', o.created_at,
                    'updated_at', o.updated_at,
                    'idempotent_replay', true
                ) INTO v_org_json
                FROM public.organizations o
                LEFT JOIN public.organization_eligibility e ON e.organization_id = o.id
                WHERE o.id = v_existing_org_id;

                RETURN v_org_json;
            ELSE
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Idempotency key "%" reused with different request payload', p_idempotency_key;
            END IF;
        END IF;
    END IF;

    -- 4. Server-side UUID generation
    v_org_id := gen_random_uuid();

    -- 5. Atomically insert organization with ALL profile attributes
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

    -- 7. Atomically evaluate and persist business eligibility + initialize trial
    v_eligibility := public.self_declare_organization_eligibility(
        v_org_id,
        p_business_category,
        p_sells_electrical_products,
        v_product_lines
    );

    -- 8. Record idempotency token if provided
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

    -- 9. Record organization creation audit event
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
            'business_category', p_business_category,
            'eligibility_status', v_eligibility->>'status',
            'idempotency_key', p_idempotency_key
        ),
        v_now
    );

    -- 10. Construct return JSON payload
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
        'eligibility_status', v_eligibility->>'status',
        'business_category', v_eligibility->>'business_category',
        'sells_electrical_products', (v_eligibility->>'sells_electrical_products')::boolean,
        'product_lines', v_eligibility->'product_lines',
        'rejection_reason', v_eligibility->>'rejection_reason',
        'reviewer_notes', v_eligibility->>'reviewer_notes',
        'trial_initialized', (v_eligibility->>'trial_initialized')::boolean,
        'created_at', o.created_at,
        'updated_at', o.updated_at
    ) INTO v_org_json
    FROM public.organizations o
    WHERE o.id = v_org_id;

    RETURN v_org_json;
END;
$$;

-- Privilege grants
REVOKE ALL ON FUNCTION public.create_organization(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR,
    public.business_category_type, BOOLEAN, TEXT[], UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_organization(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR,
    public.business_category_type, BOOLEAN, TEXT[], UUID
) TO authenticated, service_role;
