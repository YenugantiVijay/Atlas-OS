-- ============================================================================
-- Migration 013: Business Eligibility, Trial Management, and Reviewer Controls
-- ============================================================================
-- Purpose:
--   Enforces business policy for ATLAS OS:
--   1. Supported businesses:
--      - Electrical goods shops ('electrical_retail')
--      - Electrical wholesalers and distributors ('electrical_wholesale_distributor')
--      - Hardware shops that sell electrical products ('hardware_electrical')
--   2. Unsupported businesses ('other_unsupported' or not selling electrical goods)
--      are automatically rejected.
--   3. Incomplete declarations (e.g. missing product lines) are flagged for manual review.
--   4. Eligible businesses obtain a 7-day server-calculated trial without payment entry.
--   5. Trial initialization is strictly idempotent and cannot be extended by re-declaring.
--   6. Prior rejections cannot be bypassed: resubmissions require manual review.
--   7. Reviewers cannot approve declarations that violate business policy.
--   8. Platform reviewers are managed separately with immutable decision audit logs.
--   9. Writes audit records using exact checked-in audit_events schema from migration 001.
-- ============================================================================

-- 1. Create Enums
DO $$ BEGIN
    CREATE TYPE public.business_category_type AS ENUM (
        'electrical_retail',
        'electrical_wholesale_distributor',
        'hardware_electrical',
        'other_unsupported'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.eligibility_status_type AS ENUM (
        'pending',
        'approved',
        'review_required',
        'rejected'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.subscription_status_type AS ENUM (
        'trialing',
        'active',
        'past_due',
        'canceled',
        'expired'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. Platform Reviewers Registry (Provisioned by Platform Admins / Service Role only)
CREATE TABLE IF NOT EXISTS public.platform_reviewers (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    granted_by UUID REFERENCES auth.users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.platform_reviewers ENABLE ROW LEVEL SECURITY;

-- Reviewers may view their own reviewer record
DROP POLICY IF EXISTS platform_reviewers_self_select ON public.platform_reviewers;
CREATE POLICY platform_reviewers_self_select ON public.platform_reviewers
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- SECURITY CRITICAL: Direct client writes are strictly denied.
REVOKE ALL ON TABLE public.platform_reviewers FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.platform_reviewers FROM authenticated;
GRANT SELECT ON TABLE public.platform_reviewers TO authenticated;
GRANT ALL ON TABLE public.platform_reviewers TO service_role;

-- Helper to check if a user is an active platform reviewer
CREATE OR REPLACE FUNCTION public.is_platform_reviewer(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.platform_reviewers 
        WHERE user_id = coalesce(p_user_id, auth.uid()) 
          AND is_active = true
    );
$$;

-- Helper to check if a user is an active member of an organization
CREATE OR REPLACE FUNCTION public.user_is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE 
        WHEN auth.uid() IS NULL OR p_org_id IS NULL THEN FALSE
        ELSE EXISTS (
            SELECT 1 
            FROM public.memberships 
            WHERE organization_id = p_org_id 
              AND user_id = auth.uid() 
              AND is_active = TRUE
        )
    END;
$$;

-- 3. Organization Eligibility Table
CREATE TABLE IF NOT EXISTS public.organization_eligibility (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    business_category public.business_category_type NOT NULL,
    sells_electrical_products BOOLEAN NOT NULL DEFAULT true,
    product_lines TEXT[] NOT NULL DEFAULT '{}',
    status public.eligibility_status_type NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    reviewer_notes TEXT,
    declared_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    declared_by UUID NOT NULL REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_hardware_must_sell_electrical CHECK (
        business_category != 'hardware_electrical' OR sells_electrical_products = true
    ),
    CONSTRAINT chk_rejection_reason CHECK (
        status != 'rejected' OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0)
    )
);

ALTER TABLE public.organization_eligibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eligibility_tenant_select ON public.organization_eligibility;
CREATE POLICY eligibility_tenant_select ON public.organization_eligibility
    FOR SELECT TO authenticated
    USING (
        public.user_is_org_member(organization_id) 
        OR public.is_platform_reviewer()
    );

-- Direct client mutation denied: only accessible via RPCs
REVOKE ALL ON TABLE public.organization_eligibility FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_eligibility FROM authenticated;
GRANT SELECT ON TABLE public.organization_eligibility TO authenticated;
GRANT ALL ON TABLE public.organization_eligibility TO service_role;

-- 4. Organization Subscriptions & Trial Tracking Table
CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    status public.subscription_status_type NOT NULL DEFAULT 'trialing',
    plan_tier VARCHAR(50) NOT NULL DEFAULT 'trial',
    trial_started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc'::text, now()) + INTERVAL '7 days'),
    current_period_starts_at TIMESTAMPTZ,
    current_period_ends_at TIMESTAMPTZ,
    grace_period_ends_at TIMESTAMPTZ,
    payment_method_entered BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_tenant_select ON public.organization_subscriptions;
CREATE POLICY subscriptions_tenant_select ON public.organization_subscriptions
    FOR SELECT TO authenticated
    USING (
        public.user_is_org_member(organization_id) 
        OR public.is_platform_reviewer()
    );

-- Direct client mutation denied: managed by system and RPCs only
REVOKE ALL ON TABLE public.organization_subscriptions FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_subscriptions FROM authenticated;
GRANT SELECT ON TABLE public.organization_subscriptions TO authenticated;
GRANT ALL ON TABLE public.organization_subscriptions TO service_role;

-- 5. Immutable Eligibility Audit Log Table
CREATE TABLE IF NOT EXISTS public.eligibility_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    previous_status public.eligibility_status_type,
    new_status public.eligibility_status_type NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    actor_id UUID REFERENCES auth.users(id),
    reason TEXT,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.eligibility_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_tenant_select ON public.eligibility_audit_logs;
CREATE POLICY audit_logs_tenant_select ON public.eligibility_audit_logs
    FOR SELECT TO authenticated
    USING (
        public.user_has_org_role(organization_id, 'owner') 
        OR public.is_platform_reviewer()
    );

REVOKE ALL ON TABLE public.eligibility_audit_logs FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.eligibility_audit_logs FROM authenticated;
GRANT SELECT ON TABLE public.eligibility_audit_logs TO authenticated;
GRANT ALL ON TABLE public.eligibility_audit_logs TO service_role;

-- Trigger to guarantee audit log immutability (blocks UPDATE and DELETE)
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'ERR_IMMUTABLE_LOG: Audit log records cannot be updated or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_eligibility_audit_tampering ON public.eligibility_audit_logs;
CREATE TRIGGER trg_prevent_eligibility_audit_tampering
    BEFORE UPDATE OR DELETE ON public.eligibility_audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- 6. Internal Idempotent Trial Initializer
CREATE OR REPLACE FUNCTION public.internal_initialize_organization_trial(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    -- Idempotently insert trial record only if one does not already exist.
    -- Strict ON CONFLICT DO NOTHING guarantees that an existing or expired trial
    -- cannot be restarted or extended by resubmissions or concurrent calls.
    INSERT INTO public.organization_subscriptions (
        organization_id,
        status,
        plan_tier,
        trial_started_at,
        trial_ends_at,
        current_period_starts_at,
        current_period_ends_at,
        grace_period_ends_at,
        payment_method_entered,
        created_at,
        updated_at
    ) VALUES (
        p_org_id,
        'trialing',
        'trial',
        v_now,
        v_now + INTERVAL '7 days',
        v_now,
        v_now + INTERVAL '7 days',
        NULL,
        false,
        v_now,
        v_now
    )
    ON CONFLICT (organization_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.internal_initialize_organization_trial(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_initialize_organization_trial(UUID) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.internal_initialize_organization_trial(UUID) TO service_role;

-- 7. Self-Declaration RPC (Owner Invocation Only)
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

    -- 2. Authorization: caller must be an active owner of the target organization
    IF NOT public.user_has_org_role(p_org_id, 'owner') THEN
        RAISE EXCEPTION 'ERR_FORBIDDEN: Only organization owners can submit eligibility declarations';
    END IF;

    -- 3. Fetch existing eligibility state
    SELECT status INTO v_old_status
    FROM public.organization_eligibility
    WHERE organization_id = p_org_id;

    -- 4. Evaluate eligibility rules
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

    -- 5. Upsert eligibility record
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

    -- 6. If approved, initialize trial idempotently (trusted server timestamp)
    IF v_new_status = 'approved' THEN
        PERFORM public.internal_initialize_organization_trial(p_org_id);
    END IF;

    -- 7. Record immutable eligibility audit log
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

    -- 8. Record audit event using exact checked-in audit_events schema from migration 001
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

    -- 9. Return response
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

-- 8. Manual Review RPC (Platform Reviewers Only)
CREATE OR REPLACE FUNCTION public.review_organization_eligibility(
    p_org_id UUID,
    p_decision public.eligibility_status_type,
    p_reason TEXT DEFAULT NULL,
    p_reviewer_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_old_status public.eligibility_status_type;
    v_rec RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_result JSONB;
BEGIN
    -- 1. Authenticate caller
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ERR_UNAUTHENTICATED: Caller must be authenticated';
    END IF;

    -- 2. Authorization: caller must be a registered platform reviewer
    IF NOT public.is_platform_reviewer(v_uid) THEN
        RAISE EXCEPTION 'ERR_FORBIDDEN: Caller is not an authorized platform reviewer';
    END IF;

    -- 3. Validate decision
    IF p_decision NOT IN ('approved', 'rejected', 'review_required') THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Review decision must be approved, rejected, or review_required';
    END IF;

    IF p_decision = 'rejected' AND (p_reason IS NULL OR length(trim(p_reason)) = 0) THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Rejection reason is mandatory when rejecting business eligibility';
    END IF;

    -- 4. Verify organization exists and retrieve current declaration state
    SELECT status, business_category, sells_electrical_products
      INTO v_rec
      FROM public.organization_eligibility
     WHERE organization_id = p_org_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: Organization eligibility declaration not found for organization "%"', p_org_id;
    END IF;

    v_old_status := v_rec.status;

    -- 5. Business Policy Enforcement: Reviewers CANNOT approve unsupported business categories
    IF p_decision = 'approved' THEN
        IF v_rec.business_category = 'other_unsupported' OR v_rec.sells_electrical_products IS NOT TRUE THEN
            RAISE EXCEPTION 'ERR_INVALID_APPROVAL: Reviewer cannot approve business declared as unsupported category or not selling electrical goods';
        END IF;
    END IF;

    -- 6. Update eligibility record
    UPDATE public.organization_eligibility
    SET status = p_decision,
        rejection_reason = CASE WHEN p_decision = 'rejected' THEN trim(p_reason) ELSE NULL END,
        reviewer_notes = trim(p_reviewer_notes),
        reviewed_at = v_now,
        reviewed_by = v_uid,
        updated_at = v_now
    WHERE organization_id = p_org_id;

    -- 7. If approved, initialize trial idempotently
    IF p_decision = 'approved' THEN
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
        p_decision,
        'MANUAL_REVIEW_DECISION',
        v_uid,
        coalesce(p_reason, p_reviewer_notes, 'Manual review decision recorded'),
        jsonb_build_object(
            'decision', p_decision,
            'reason', p_reason,
            'reviewer_notes', p_reviewer_notes
        ),
        v_now
    );

    -- 9. Record audit event using exact checked-in audit_events schema from migration 001
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
        'BUSINESS_ELIGIBILITY_REVIEWED',
        'ORGANIZATION_ELIGIBILITY',
        p_org_id,
        jsonb_build_object(
            'previous_status', v_old_status,
            'decision', p_decision,
            'reason', p_reason
        ),
        v_now
    );

    -- 10. Return response
    SELECT jsonb_build_object(
        'organization_id', e.organization_id,
        'business_category', e.business_category,
        'status', e.status,
        'rejection_reason', e.rejection_reason,
        'reviewer_notes', e.reviewer_notes,
        'reviewed_at', e.reviewed_at,
        'reviewed_by', e.reviewed_by
    ) INTO v_result
    FROM public.organization_eligibility e
    WHERE e.organization_id = p_org_id;

    RETURN v_result;
END;
$$;

-- 9. Privileges and Access Control
REVOKE ALL ON FUNCTION public.is_platform_reviewer(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_platform_reviewer(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_platform_reviewer(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_reviewer(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.user_is_org_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_is_org_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_org_member(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.self_declare_organization_eligibility(UUID, public.business_category_type, BOOLEAN, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_declare_organization_eligibility(UUID, public.business_category_type, BOOLEAN, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_declare_organization_eligibility(UUID, public.business_category_type, BOOLEAN, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.self_declare_organization_eligibility(UUID, public.business_category_type, BOOLEAN, TEXT[]) TO service_role;

REVOKE ALL ON FUNCTION public.review_organization_eligibility(UUID, public.eligibility_status_type, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_organization_eligibility(UUID, public.eligibility_status_type, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_organization_eligibility(UUID, public.eligibility_status_type, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_organization_eligibility(UUID, public.eligibility_status_type, TEXT, TEXT) TO service_role;
