-- ============================================================================
-- Migration 030: Organization Identity Privacy, Canonical Contract & Continuing Enforcement
-- ============================================================================
-- Purpose:
--   1. Introduces canonical create_organization_v2 RPC with 17 parameters and
--      replaces legacy 15-parameter create_organization with a secure compatibility wrapper.
--   2. Ensures legacy clients cannot bypass mandatory PAN identity checks or obtain
--      automatic approval without PAN.
--   3. Corrects audit logging to use the authoritative column `details` (resolving `metadata` mismatch).
--   4. Hardens privacy: introduces public.mask_pan and public.mask_gstin; sanitizes all
--      database exception messages to completely eliminate raw identifier leakage.
--   5. Implements continuing PAN identity enforcement on UPDATE: approved organizations
--      cannot remove PAN, and altering an approved PAN automatically demotes eligibility
--      to 'review_required' for administrative review.
--   6. Hardens public.self_declare_organization_eligibility: organizations without a verified
--      PAN cannot self-approve for write operations.
--   7. Preserves existing organizations, memberships, eligibility, trial, audit, and invoice records.
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

-- 2. Validation and continuing identity enforcement trigger for public.organizations
CREATE OR REPLACE FUNCTION public.validate_organization_pan_gstin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_eligibility_status public.eligibility_status_type;
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

    -- Continuing Identity Enforcement on UPDATE:
    -- Guard A: An organization with a registered PAN cannot have its PAN removed
    -- (Evaluated before auto-derive to prevent explicit clearing of PAN)
    IF TG_OP = 'UPDATE' THEN
        IF OLD.pan IS NOT NULL AND NEW.pan IS NULL THEN
            RAISE EXCEPTION 'ERR_CANNOT_REMOVE_PAN: Cannot remove PAN from an active registered organization';
        END IF;
    END IF;

    -- Cross-validate: if both GSTIN and PAN are present, verify embedded PAN matches submitted PAN
    IF NEW.gstin IS NOT NULL AND NEW.pan IS NOT NULL THEN
        IF substring(NEW.gstin from 3 for 10) != NEW.pan THEN
            RAISE EXCEPTION 'ERR_PAN_GSTIN_MISMATCH: Provided PAN does not match the PAN embedded within the GSTIN. Please verify credentials.';
        END IF;
    ELSIF NEW.gstin IS NOT NULL AND NEW.pan IS NULL THEN
        -- Auto-derive PAN from GSTIN if PAN was not supplied
        NEW.pan := substring(NEW.gstin from 3 for 10);
    END IF;

    -- Continuing Identity Enforcement on UPDATE:
    IF TG_OP = 'UPDATE' THEN
        -- Fetch existing eligibility state
        SELECT status INTO v_eligibility_status
        FROM public.organization_eligibility
        WHERE organization_id = NEW.id;

        -- Guard B: If an approved organization changes its PAN (legal entity alteration),
        -- its approval is automatically revoked to 'review_required' to prevent unverified privilege carryover
        IF OLD.pan IS NOT NULL AND NEW.pan IS NOT NULL AND OLD.pan != NEW.pan THEN
            IF v_eligibility_status = 'approved' THEN
                UPDATE public.organization_eligibility
                SET status = 'review_required',
                    reviewer_notes = 'Organization PAN updated from ' || public.mask_pan(OLD.pan) || ' to ' || public.mask_pan(NEW.pan) || '. Compliance review required.',
                    updated_at = timezone('utc'::text, now())
                WHERE organization_id = NEW.id;
            END IF;

            -- Log audit event for legal PAN change using authoritative column `details`
            INSERT INTO public.audit_events (
                organization_id,
                actor_id,
                action,
                entity_type,
                entity_id,
                details,
                created_at
            ) VALUES (
                NEW.id,
                (SELECT auth.uid()),
                'ORGANIZATION_PAN_UPDATED',
                'organizations',
                NEW.id,
                jsonb_build_object(
                    'old_pan', public.mask_pan(OLD.pan),
                    'new_pan', public.mask_pan(NEW.pan),
                    'eligibility_demoted', (v_eligibility_status = 'approved')
                ),
                timezone('utc'::text, now())
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_organization_pan_gstin ON public.organizations;
CREATE TRIGGER trg_validate_organization_pan_gstin
    BEFORE INSERT OR UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.validate_organization_pan_gstin();

-- 3. Canonical RPC: public.create_organization_v2 (17 parameters)
CREATE OR REPLACE FUNCTION public.create_organization_v2(
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
    p_pan_exception_reason TEXT DEFAULT NULL,
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
    v_is_exception BOOLEAN := FALSE;
    v_valid_reasons TEXT[] := ARRAY['GOVERNMENT_EXEMPT_ENTITY', 'INFORMAL_SECTOR_MICRO_ENTERPRISE', 'PAN_ISSUANCE_IN_PROGRESS'];
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

    v_trimmed_legal := NULLIF(trim(p_legal_name), '');
    v_gstin := NULLIF(upper(trim(p_gstin)), '');
    v_pan := NULLIF(upper(trim(p_pan)), '');
    v_currency := upper(trim(coalesce(p_currency, 'INR')));
    v_phone := NULLIF(trim(p_phone), '');
    v_email := NULLIF(lower(trim(p_email)), '');
    v_address_line1 := NULLIF(trim(p_address_line1), '');
    v_city := NULLIF(trim(p_city), '');
    v_state := NULLIF(trim(p_state), '');
    v_pincode := NULLIF(trim(p_pincode), '');
    v_product_lines := coalesce(p_product_lines, '{}');

    -- Auto-derive PAN from GSTIN if PAN is not directly supplied
    IF v_pan IS NULL AND v_gstin IS NOT NULL AND length(v_gstin) >= 12 THEN
        v_pan := substring(v_gstin from 3 for 10);
    END IF;

    -- Enforce Mandatory Business Identity Policy
    IF v_pan IS NULL THEN
        IF p_pan_exception_reason IS NOT NULL THEN
            IF NOT (p_pan_exception_reason = ANY(v_valid_reasons)) THEN
                RAISE EXCEPTION 'ERR_PAN_EXCEPTION_INVALID: Invalid documented exception reason "%"', p_pan_exception_reason;
            END IF;
            IF p_pan_exception_reference IS NULL OR length(trim(p_pan_exception_reference)) < 3 THEN
                RAISE EXCEPTION 'ERR_PAN_EXCEPTION_REF_REQUIRED: Documented exception requires an official reference identifier (minimum 3 characters)';
            END IF;
            v_is_exception := TRUE;
        ELSE
            RAISE EXCEPTION 'ERR_PAN_REQUIRED: Valid Indian PAN is required for business registration, or a documented exception reason and reference must be provided.';
        END IF;
    END IF;

    -- 3. Idempotency Check with serialized user lock
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('org_create:' || v_uid::text || ':' || p_idempotency_key::text));

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
            coalesce(p_pan_exception_reason, ''),
            coalesce(p_pan_exception_reference, '')
        ));

        SELECT organization_id, request_hash
          INTO v_existing_org_id, v_existing_hash
          FROM public.organization_creation_idempotency
         WHERE user_id = v_uid
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                RETURN (
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
                        'role', 'owner',
                        'eligibility_status', coalesce(e.status::text, 'review_required'),
                        'business_category', e.business_category,
                        'sells_electrical_products', coalesce(e.sells_electrical_products, false),
                        'product_lines', to_jsonb(coalesce(e.product_lines, '{}'::text[])),
                        'rejection_reason', e.rejection_reason,
                        'reviewer_notes', e.reviewer_notes,
                        'trial_initialized', EXISTS (
                            SELECT 1 FROM public.organization_subscriptions s
                            WHERE s.organization_id = o.id AND s.status = 'trialing'
                        ),
                        'created_at', o.created_at,
                        'updated_at', o.updated_at,
                        'idempotent_replay', true
                    )
                    FROM public.organizations o
                    LEFT JOIN public.organization_eligibility e ON e.organization_id = o.id
                    WHERE o.id = v_existing_org_id
                );
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

    -- 6. Evaluate or Declare Eligibility
    IF v_is_exception THEN
        -- Organizations created under statutory PAN exceptions are quarantined into review_required (NO automatic trial)
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
            v_org_id,
            p_business_category,
            coalesce(p_sells_electrical_products, false),
            v_product_lines,
            'review_required',
            NULL,
            'Registered under documented PAN exception: ' || p_pan_exception_reason || ' (Ref: ' || trim(p_pan_exception_reference) || '). Manual platform verification required before operational writes can be enabled.',
            v_now,
            v_uid,
            v_now,
            v_now
        );

        v_eligibility := jsonb_build_object(
            'status', 'review_required',
            'category', p_business_category,
            'sells_electrical', p_sells_electrical_products,
            'product_lines', to_jsonb(v_product_lines),
            'rejection_reason', NULL,
            'reviewer_notes', 'Registered under documented PAN exception',
            'trial_initialized', false
        );
    ELSE
        -- Standard organization with verified PAN: invoke self_declare_organization_eligibility
        v_eligibility := public.self_declare_organization_eligibility(
            v_org_id,
            p_business_category,
            p_sells_electrical_products,
            v_product_lines
        );
    END IF;

    -- 7. Record Idempotency mapping
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.organization_creation_idempotency (
            user_id,
            idempotency_key,
            organization_id,
            request_hash,
            created_at
        ) VALUES (
            v_uid,
            p_idempotency_key,
            v_org_id,
            v_request_hash,
            v_now
        );
    END IF;

    -- 8. Record audit event using authoritative column `details`
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
        'ORGANIZATION_CREATED_ATOMIC',
        'organizations',
        v_org_id,
        jsonb_build_object(
            'name', v_trimmed_name,
            'category', p_business_category,
            'sells_electrical', p_sells_electrical_products,
            'eligibility_status', v_eligibility->>'status',
            'pan', public.mask_pan(v_pan),
            'gstin', public.mask_gstin(v_gstin),
            'pan_exception_reason', p_pan_exception_reason
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

-- 4. Secure Legacy Wrapper: public.create_organization (15 parameters)
-- Replaces existing 15-parameter function with a delegation wrapper that passes NULL exception parameters.
-- Legacy callers cannot bypass mandatory PAN validation; missing PAN raises ERR_PAN_REQUIRED.
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
BEGIN
    RETURN public.create_organization_v2(
        p_name := p_name,
        p_legal_name := p_legal_name,
        p_gstin := p_gstin,
        p_pan := p_pan,
        p_currency := p_currency,
        p_phone := p_phone,
        p_email := p_email,
        p_address_line1 := p_address_line1,
        p_city := p_city,
        p_state := p_state,
        p_pincode := p_pincode,
        p_business_category := p_business_category,
        p_sells_electrical_products := p_sells_electrical_products,
        p_product_lines := p_product_lines,
        p_idempotency_key := p_idempotency_key,
        p_pan_exception_reason := NULL,
        p_pan_exception_reference := NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_v2(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, public.business_category_type, BOOLEAN, TEXT[], UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_v2(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, public.business_category_type, BOOLEAN, TEXT[], UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_organization(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, public.business_category_type, BOOLEAN, TEXT[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, public.business_category_type, BOOLEAN, TEXT[], UUID) TO authenticated, service_role;

-- 5. Hardened Self-Declaration Guard: Requires recorded PAN before auto-approval
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
    v_org_pan VARCHAR(10);
    v_org_gstin VARCHAR(15);
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

    -- 4. Fetch existing eligibility state & organization tax identifiers
    SELECT status INTO v_old_status
    FROM public.organization_eligibility
    WHERE organization_id = p_org_id;

    SELECT pan, gstin INTO v_org_pan, v_org_gstin
    FROM public.organizations
    WHERE id = p_org_id;

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

    -- Rule F: Missing verified PAN on organization: CANNOT self-approve, queues in review
    ELSIF v_org_pan IS NULL AND (v_org_gstin IS NULL OR length(trim(v_org_gstin)) < 12) THEN
        v_new_status := 'review_required';
        v_reviewer_notes := 'Organization lacks verified PAN or GSTIN. Flagged for identity review before operational write access can be enabled.';
        v_action_type := 'FLAGGED_MISSING_PAN';

    -- Rule G: Valid self-declaration in supported category with electrical products and verified identity
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
            'product_lines', p_product_lines,
            'pan', public.mask_pan(v_org_pan),
            'gstin', public.mask_gstin(v_org_gstin)
        ),
        v_now
    );

    -- 9. Record general audit event using authoritative column `details`
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
        'ELIGIBILITY_SELF_DECLARED',
        'organization_eligibility',
        p_org_id,
        jsonb_build_object(
            'category', p_category,
            'sells_electrical', p_sells_electrical,
            'new_status', v_new_status,
            'action_type', v_action_type
        ),
        v_now
    );

    -- 10. Return synthesized response
    RETURN jsonb_build_object(
        'organization_id', p_org_id,
        'status', v_new_status,
        'category', p_category,
        'sells_electrical', p_sells_electrical,
        'product_lines', p_product_lines,
        'rejection_reason', v_rejection_reason,
        'reviewer_notes', v_reviewer_notes,
        'trial_initialized', (v_new_status = 'approved'),
        'declared_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.self_declare_organization_eligibility(UUID, public.business_category_type, BOOLEAN, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_declare_organization_eligibility(UUID, public.business_category_type, BOOLEAN, TEXT[]) TO authenticated, service_role;

-- 6. Privacy Compliance Diagnostic Procedure
CREATE OR REPLACE FUNCTION public.inspect_audit_privacy_compliance()
RETURNS TABLE (
    total_audit_events BIGINT,
    events_with_unmasked_pan BIGINT,
    events_with_unmasked_gstin BIGINT,
    compliance_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total BIGINT;
    v_unmasked_pan BIGINT;
    v_unmasked_gstin BIGINT;
BEGIN
    SELECT count(*) INTO v_total FROM public.audit_events;

    -- Count occurrences of unmasked 10-char PAN in details JSON without leaking raw values
    SELECT count(*) INTO v_unmasked_pan
    FROM public.audit_events
    WHERE details::text ~* '[A-Z]{5}[0-9]{4}[A-Z]{1}'
      AND details::text !~* 'XXXXX[0-9]{4}[A-Z]{1}';

    -- Count occurrences of unmasked 15-char GSTIN in details JSON without leaking raw values
    SELECT count(*) INTO v_unmasked_gstin
    FROM public.audit_events
    WHERE details::text ~* '[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}'
      AND details::text !~* '[0-9]{2}XXXXX[0-9]{4}[A-Z]{1}';

    RETURN QUERY SELECT
        v_total,
        v_unmasked_pan,
        v_unmasked_gstin,
        CASE
            WHEN v_unmasked_pan = 0 AND v_unmasked_gstin = 0 THEN 'FULLY_COMPLIANT'
            ELSE 'HISTORICAL_REMEDIATION_RECOMMENDED'
        END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inspect_audit_privacy_compliance() TO authenticated, service_role;
