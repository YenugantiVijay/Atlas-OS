-- Broaden the trade categories while retaining identity, review, and trial checks.
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
        v_rejection_reason := 'Choose a supported business category or contact Atlas OS about a specialized workflow.';
        v_action_type := 'AUTO_REJECTION_CATEGORY';

    -- Rule B: Does not sell electrical products
    ELSIF p_category IN ('electrical_retail', 'electrical_wholesale_distributor', 'hardware_electrical')
       AND p_sells_electrical IS NOT TRUE THEN
        v_new_status := 'rejected';
        v_rejection_reason := 'Choose a category that reflects the products your business sells.';
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

    -- Rule G: Valid self-declaration in a supported category with verified identity
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
        IF v_rec.business_category = 'other_unsupported'
           OR (v_rec.business_category IN ('electrical_retail', 'electrical_wholesale_distributor', 'hardware_electrical')
               AND v_rec.sells_electrical_products IS NOT TRUE) THEN
            RAISE EXCEPTION 'ERR_INVALID_APPROVAL: Reviewer cannot approve an unsupported business declaration';
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

ALTER TABLE public.organizations
  ADD COLUMN receipt_template text NOT NULL DEFAULT 'classic'
    CHECK (receipt_template IN ('classic', 'compact')),
  ADD COLUMN receipt_message text NOT NULL DEFAULT ''
    CHECK (char_length(receipt_message) <= 160);

-- Use the recorded payment and current server-managed edition. There is no
-- extra receipt number or ledger row for a counter copy.
CREATE FUNCTION public.get_payment_receipt_print_data(p_org_id uuid, p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_data jsonb;
  v_can_print_counter boolean;
BEGIN
  IF auth.uid() IS NULL
     OR public.user_has_org_role(p_org_id, 'owner', 'admin', 'accounts') IS NOT TRUE
     OR public.can_read_organization_data(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to view this payment receipt' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.organization_subscriptions subscription
    WHERE subscription.organization_id = p_org_id
      AND subscription.plan_tier IN ('professional', 'enterprise_network')
      AND subscription.status = 'active'
      AND subscription.current_period_ends_at IS NOT NULL
      AND (subscription.current_period_starts_at IS NULL OR subscription.current_period_starts_at <= now())
      AND now() <= coalesce(subscription.grace_period_ends_at, subscription.current_period_ends_at)
  ) INTO v_can_print_counter;

  SELECT jsonb_build_object(
    'organizationId', org.id, 'businessName', org.name, 'legalName', org.legal_name,
    'logoUrl', org.logo_url, 'gstin', org.gstin,
    'businessAddress', concat_ws(', ', nullif(btrim(org.address_line1), ''),
       nullif(btrim(org.city), ''), nullif(btrim(org.state), ''), nullif(btrim(org.pincode), '')),
    'contact', concat_ws(' · ', nullif(btrim(org.phone), ''), nullif(btrim(org.email), '')),
    'currency', org.currency, 'template', org.receipt_template, 'message', org.receipt_message,
    'number', payment.payment_number, 'date', payment.payment_date, 'method', payment.payment_method,
    'amount', payment.amount, 'reference', payment.reference_number,
    'customer', coalesce(nullif(btrim(customer.company_name), ''), customer.name, 'Customer'),
    'counterCopyAllowed', v_can_print_counter
  ) INTO v_data
  FROM public.payments payment
  JOIN public.organizations org ON org.id = payment.organization_id
  LEFT JOIN public.customers customer ON customer.id = payment.customer_id AND customer.organization_id = org.id
  WHERE payment.organization_id = p_org_id AND payment.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment receipt is unavailable in this workspace' USING ERRCODE = '22023';
  END IF;
  RETURN v_data;
END;
$$;
REVOKE ALL ON FUNCTION public.get_payment_receipt_print_data(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_receipt_print_data(uuid, uuid) TO authenticated;

-- Count recorded receipts for a business date, independently of the payments
-- screen pagination. A duplicated print has no effect on these totals.
CREATE FUNCTION public.get_daily_payment_receipt_totals(p_org_id uuid, p_day date)
RETURNS TABLE (payment_method text, receipt_count bigint, total numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.user_has_org_role(p_org_id, 'owner', 'admin', 'accounts') IS NOT TRUE
     OR public.can_read_organization_data(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to view receipt totals' USING ERRCODE = '42501';
  END IF;
  IF p_day IS NULL OR NOT isfinite(p_day) THEN
    RAISE EXCEPTION 'Choose a valid receipt date' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT payment.payment_method::text, count(*), sum(payment.amount)
  FROM public.payments payment
  WHERE payment.organization_id = p_org_id AND payment.payment_date = p_day
  GROUP BY payment.payment_method ORDER BY payment.payment_method;
END;
$$;
REVOKE ALL ON FUNCTION public.get_daily_payment_receipt_totals(uuid, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_payment_receipt_totals(uuid, date) TO authenticated;
