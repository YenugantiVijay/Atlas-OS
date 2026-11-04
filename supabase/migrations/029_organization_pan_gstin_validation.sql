-- ============================================================================
-- Migration 029: Organization PAN and GSTIN Business Identity & Privacy Hardening
-- ============================================================================
-- Purpose:
--   1. Enforces standard Indian business tax identifier formats (PAN & GSTIN) on public.organizations.
--   2. Enforces cross-validation: when both GSTIN and PAN are present, characters 3-12
--      of the GSTIN must strictly match the PAN.
--   3. When GSTIN is supplied without PAN, automatically derives PAN from the GSTIN.
--   4. Never silently overwrites an explicitly provided PAN.
--   5. Eliminates raw PAN/GSTIN from all exception messages, application logs, and audit metadata.
--   6. Introduces SQL masking functions public.mask_pan and public.mask_gstin.
--   7. Implements trusted backend boundary authorization for documented statutory PAN exceptions
--      ('GOVERNMENT_EXEMPT_ENTITY', 'INFORMAL_SECTOR_MICRO_ENTERPRISE', 'PAN_ISSUANCE_IN_PROGRESS').
--      Organizations created under exceptions are routed to 'review_required' (no automatic trial).
--   8. Hardens public.self_declare_organization_eligibility: businesses without a verified PAN
--      cannot self-approve for write operations.
-- ============================================================================

-- 1. Helper functions for redacting sensitive business tax identifiers
CREATE OR REPLACE FUNCTION public.mask_pan(p_pan TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_pan IS NULL OR length(trim(p_pan)) = 0 THEN ''
        WHEN trim(p_pan) ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$' THEN 'XXXXX' || substring(trim(p_pan) from 6 for 5)
        ELSE '••••••••••'
    END;
$$;

CREATE OR REPLACE FUNCTION public.mask_gstin(p_gstin TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_gstin IS NULL OR length(trim(p_gstin)) = 0 THEN ''
        WHEN trim(p_gstin) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'
            THEN substring(trim(p_gstin) from 1 for 2) || 'XXXXX' || substring(trim(p_gstin) from 8 for 4) || 'Z' || substring(trim(p_gstin) from 15 for 1)
        ELSE '•••••••••••••••'
    END;
$$;

GRANT EXECUTE ON FUNCTION public.mask_pan(TEXT) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mask_gstin(TEXT) TO PUBLIC, anon, authenticated, service_role;

-- 2. Validation trigger function for public.organizations (without identifier leakage)
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

    -- Validate GSTIN format if present (sanitized error message without raw input)
    IF NEW.gstin IS NOT NULL THEN
        IF NEW.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' THEN
            RAISE EXCEPTION 'ERR_VALIDATION_GSTIN: Invalid Indian GSTIN format. Expected standard 15-character Indian GSTIN (e.g. 29ABCDE1234F1Z5)';
        END IF;
    END IF;

    -- Validate PAN format if present (sanitized error message without raw input)
    IF NEW.pan IS NOT NULL THEN
        IF NEW.pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$' THEN
            RAISE EXCEPTION 'ERR_VALIDATION_PAN: Invalid Indian PAN format. Expected standard 10-character Indian PAN (e.g. ABCDE1234F)';
        END IF;
    END IF;

    -- Cross-validate: if both GSTIN and PAN are present, verify embedded PAN matches submitted PAN
    IF NEW.gstin IS NOT NULL AND NEW.pan IS NOT NULL THEN
        IF substring(NEW.gstin from 3 for 10) != NEW.pan THEN
            RAISE EXCEPTION 'ERR_PAN_GSTIN_MISMATCH: Provided PAN does not match the PAN embedded within the GSTIN';
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

-- 3. Update create_organization RPC to enforce PAN policy, exception boundaries, and audit privacy
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
    p_idempotency_key UUID DEFAULT NULL,
    p_pan_exception_reason VARCHAR(64) DEFAULT NULL,
    p_pan_exception_reference TEXT DEFAULT NULL
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
    v_has_pan_exception BOOLEAN := FALSE;
    v_sanitized_reason VARCHAR(64) := NULL;
    v_sanitized_ref TEXT := NULL;
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
            RAISE EXCEPTION 'ERR_VALIDATION_GSTIN: Invalid Indian GSTIN format. Expected standard 15-character Indian GSTIN (e.g. 29ABCDE1234F1Z5)';
        END IF;
    ELSE
        v_gstin := NULL;
    END IF;

    -- PAN validation
    IF p_pan IS NOT NULL AND trim(p_pan) != '' THEN
        v_pan := upper(trim(p_pan));
        IF v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$' THEN
            RAISE EXCEPTION 'ERR_VALIDATION_PAN: Invalid Indian PAN format. Expected standard 10-character Indian PAN (e.g. ABCDE1234F)';
        END IF;
    ELSE
        v_pan := NULL;
    END IF;

    -- Cross-validation: GSTIN embedded PAN vs PAN
    IF v_gstin IS NOT NULL AND v_pan IS NOT NULL THEN
        IF substring(v_gstin from 3 for 10) != v_pan THEN
            RAISE EXCEPTION 'ERR_PAN_GSTIN_MISMATCH: Provided PAN does not match the PAN embedded within the GSTIN';
        END IF;
    ELSIF v_gstin IS NOT NULL AND v_pan IS NULL THEN
        v_pan := substring(v_gstin from 3 for 10);
    END IF;

    -- Business Identity Policy: Enforce PAN requirement or authorized backend exception
    IF v_pan IS NULL THEN
        IF p_pan_exception_reason IS NOT NULL AND trim(p_pan_exception_reason) != '' THEN
            v_sanitized_reason := trim(p_pan_exception_reason);
            IF v_sanitized_reason NOT IN ('GOVERNMENT_EXEMPT_ENTITY', 'INFORMAL_SECTOR_MICRO_ENTERPRISE', 'PAN_ISSUANCE_IN_PROGRESS') THEN
                RAISE EXCEPTION 'ERR_PAN_EXCEPTION_INVALID: Unsupported PAN exception reason. Must be one of: GOVERNMENT_EXEMPT_ENTITY, INFORMAL_SECTOR_MICRO_ENTERPRISE, PAN_ISSUANCE_IN_PROGRESS';
            END IF;

            v_sanitized_ref := trim(coalesce(p_pan_exception_reference, ''));
            IF length(v_sanitized_ref) < 3 THEN
                RAISE EXCEPTION 'ERR_PAN_EXCEPTION_INVALID: Documented statutory reference or rationale (minimum 3 characters) is required when requesting a PAN exemption';
            END IF;

            v_has_pan_exception := TRUE;
        ELSE
            RAISE EXCEPTION 'ERR_PAN_REQUIRED: Valid Indian PAN is required for business onboarding. If seeking a statutory exemption, provide documented exception details for platform review.';
        END IF;
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
            coalesce(array_to_string(v_product_lines, ','), ''),
            coalesce(v_sanitized_reason, '')
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

    -- 6. Atomic Eligibility Declaration
    -- If created under a PAN exception, cannot auto-approve; route to manual review without starting trial
    IF v_has_pan_exception THEN
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
            reviewed_at,
            reviewed_by,
            created_at,
            updated_at
        ) VALUES (
            v_org_id,
            p_business_category,
            p_sells_electrical_products,
            v_product_lines,
            'review_required',
            NULL,
            'Onboarded under documented PAN exception (' || v_sanitized_reason || '). Reference: ' || v_sanitized_ref || '. Queued for administrative review.',
            v_now,
            v_uid,
            NULL,
            NULL,
            v_now,
            v_now
        );

        v_eligibility := jsonb_build_object(
            'organization_id', v_org_id,
            'status', 'review_required',
            'category', p_business_category,
            'sells_electrical', p_sells_electrical_products,
            'product_lines', v_product_lines,
            'rejection_reason', NULL,
            'reviewer_notes', 'Onboarded under documented PAN exception (' || v_sanitized_reason || '). Reference: ' || v_sanitized_ref || '. Queued for administrative review.',
            'trial_initialized', false
        );
    ELSE
        -- Standard workflow with verified PAN: executes self_declare_organization_eligibility
        v_eligibility := public.self_declare_organization_eligibility(
            v_org_id,
            p_business_category,
            p_sells_electrical_products,
            v_product_lines
        );
    END IF;

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

    -- 8. Record audit event with REDACTED sensitive identifiers
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
            'pan_masked', public.mask_pan(v_pan),
            'gstin_masked', public.mask_gstin(v_gstin),
            'pan_provided', (v_pan IS NOT NULL),
            'pan_exception_reason', v_sanitized_reason
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
        'trial_initialized', coalesce((v_eligibility->>'trial_initialized')::boolean, false),
        'created_at', v_now,
        'updated_at', v_now,
        'idempotent_replay', false
    );
END;
$$;

-- 4. Harden self_declare_organization_eligibility to require verified PAN
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
    v_org_pan VARCHAR(10);
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

    -- 2. Explicit Input Validation
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

    -- 4. Check business identity: Organization MUST possess a valid PAN to be auto-approved
    SELECT pan INTO v_org_pan
    FROM public.organizations
    WHERE id = p_org_id;

    -- 5. Fetch existing eligibility state
    SELECT status INTO v_old_status
    FROM public.organization_eligibility
    WHERE organization_id = p_org_id;

    -- 6. Evaluate eligibility rules
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

    -- Rule C: Missing business PAN (cannot auto-approve without tax identity)
    ELSIF v_org_pan IS NULL THEN
        v_new_status := 'review_required';
        v_reviewer_notes := 'Self-declaration submitted without recorded business PAN. Queued for platform reviewer identity verification.';
        v_action_type := 'FLAGGED_MISSING_PAN';

    -- Rule D: Missing or empty product lines (incomplete declaration -> manual review)
    ELSIF p_product_lines IS NULL OR cardinality(p_product_lines) = 0 THEN
        v_new_status := 'review_required';
        v_reviewer_notes := 'Self-declaration lacked declared product lines. Flagged for manual review.';
        v_action_type := 'FLAGGED_INCOMPLETE_DECLARATION';

    -- Rule E: Resubmission after prior rejection cannot self-approve; queues in appeal review
    ELSIF v_old_status = 'rejected' THEN
        v_new_status := 'review_required';
        v_reviewer_notes := 'Resubmission following previous rejection. Queued for platform reviewer evaluation.';
        v_action_type := 'RESUBMISSION_QUEUED_FOR_REVIEW';

    -- Rule F: Resubmission during ongoing manual review cannot bypass review
    ELSIF v_old_status = 'review_required' THEN
        v_new_status := 'review_required';
        v_reviewer_notes := coalesce(v_reviewer_notes, 'Declaration updated while pending manual review.');
        v_action_type := 'DECLARATION_UPDATED_PENDING_REVIEW';

    -- Rule G: Valid self-declaration with verified PAN, supported category, and electrical products
    ELSE
        v_new_status := 'approved';
        v_action_type := 'AUTO_APPROVAL_SELF_DECLARATION';
    END IF;

    -- 7. Persist eligibility record atomically
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
        reviewed_at,
        reviewed_by,
        created_at,
        updated_at
    ) VALUES (
        p_org_id,
        p_category,
        p_sells_electrical,
        p_product_lines,
        v_new_status,
        v_rejection_reason,
        v_reviewer_notes,
        v_now,
        v_uid,
        NULL,
        NULL,
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

    -- 8. If approved, initialize trial atomically (preserves existing trials without resetting)
    IF v_new_status = 'approved' THEN
        PERFORM public.internal_initialize_organization_trial(p_org_id);
    END IF;

    -- 9. Record audit event with masked identifier
    INSERT INTO public.audit_events (
        organization_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        p_org_id,
        v_uid,
        v_action_type,
        'organization_eligibility',
        p_org_id,
        jsonb_build_object(
            'old_status', v_old_status,
            'new_status', v_new_status,
            'category', p_category,
            'sells_electrical', p_sells_electrical,
            'product_lines_count', cardinality(p_product_lines),
            'pan_masked', public.mask_pan(v_org_pan),
            'pan_present', (v_org_pan IS NOT NULL)
        ),
        v_now
    );

    -- 10. Return canonical JSON result
    v_result := jsonb_build_object(
        'organization_id', p_org_id,
        'status', v_new_status,
        'category', p_category,
        'sells_electrical', p_sells_electrical,
        'product_lines', p_product_lines,
        'rejection_reason', v_rejection_reason,
        'reviewer_notes', v_reviewer_notes,
        'trial_initialized', (v_new_status = 'approved')
    );

    RETURN v_result;
END;
$$;

-- Revoke and grant privileges safely
REVOKE ALL ON FUNCTION public.create_organization(
    VARCHAR(255), VARCHAR(255), VARCHAR(15), VARCHAR(10), VARCHAR(3),
    VARCHAR(50), VARCHAR(255), TEXT, VARCHAR(100), VARCHAR(100),
    VARCHAR(10), public.business_category_type, BOOLEAN, TEXT[], UUID,
    VARCHAR(64), TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_organization(
    VARCHAR(255), VARCHAR(255), VARCHAR(15), VARCHAR(10), VARCHAR(3),
    VARCHAR(50), VARCHAR(255), TEXT, VARCHAR(100), VARCHAR(100),
    VARCHAR(10), public.business_category_type, BOOLEAN, TEXT[], UUID,
    VARCHAR(64), TEXT
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.self_declare_organization_eligibility(
    UUID, public.business_category_type, BOOLEAN, TEXT[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.self_declare_organization_eligibility(
    UUID, public.business_category_type, BOOLEAN, TEXT[]
) TO authenticated, service_role;
