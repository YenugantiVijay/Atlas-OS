-- Approved full-product counts are immutable. Their expired stock remains in
-- physical stock, but the ledger cannot dispatch or deduct those units.
CREATE TABLE public.stock_count_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_no bigint GENERATED ALWAYS AS IDENTITY,
    organization_id uuid NOT NULL,
    product_id uuid NOT NULL,
    counted_on date NOT NULL,
    counted_quantity integer NOT NULL CHECK (counted_quantity >= 0),
    previous_quantity integer NOT NULL CHECK (previous_quantity >= 0),
    ledger_movement_count bigint NOT NULL CHECK (ledger_movement_count >= 0),
    quarantine_quantity integer NOT NULL CHECK (quarantine_quantity BETWEEN 0 AND counted_quantity),
    expiry_godown_id uuid,
    counted_lines jsonb NOT NULL,
    resulting_lines jsonb NOT NULL,
    request_hash bytea NOT NULL,
    approved_by uuid NOT NULL,
    approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (organization_id, product_id) REFERENCES public.stock_batch_openings(organization_id, product_id),
    FOREIGN KEY (organization_id, expiry_godown_id) REFERENCES public.inventory_godowns(organization_id, id),
    UNIQUE (organization_id, product_id, request_hash)
);

CREATE INDEX stock_count_approvals_latest_idx
    ON public.stock_count_approvals (organization_id, product_id, sequence_no DESC);

ALTER TABLE public.stock_count_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_count_approvals FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.protect_quarantined_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_quarantined integer;
    v_physical bigint;
BEGIN
    -- The existing stock invariant trigger holds the product lock first.
    SELECT quarantine_quantity INTO v_quarantined FROM public.stock_count_approvals
    WHERE organization_id = NEW.organization_id AND product_id = NEW.product_id
    ORDER BY sequence_no DESC LIMIT 1;
    IF COALESCE(v_quarantined, 0) > 0 THEN
        SELECT COALESCE(sum(quantity_change), 0) INTO v_physical FROM public.stock_movements
        WHERE organization_id = NEW.organization_id AND product_id = NEW.product_id;
        IF v_physical + NEW.quantity_change < v_quarantined THEN
            RAISE EXCEPTION 'Only % sellable units are available. % units are in the expiry godown.',
                GREATEST(0, v_physical - v_quarantined), v_quarantined USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_quarantined_stock
    BEFORE INSERT ON public.stock_movements
    FOR EACH ROW WHEN (NEW.quantity_change < 0)
    EXECUTE FUNCTION public.protect_quarantined_stock();

CREATE FUNCTION public.get_stock_count_approval(p_org_id uuid, p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_opening jsonb := public.get_stock_batch_opening(p_org_id, p_product_id);
    v_approval jsonb;
BEGIN
    -- get_stock_batch_opening checks the caller's role and product tenancy.
    SELECT jsonb_build_object(
        'id', a.id, 'counted_on', a.counted_on, 'quantity', a.counted_quantity,
        'previous_quantity', a.previous_quantity, 'quarantine_quantity', a.quarantine_quantity,
        'expiry_godown', g.name, 'lines', a.resulting_lines,
        'current', a.ledger_movement_count = (v_opening->>'ledger_movement_count')::bigint,
        'sellable_quantity', GREATEST(0, (v_opening->>'ledger_quantity')::bigint - a.quarantine_quantity)
    ) INTO v_approval
    FROM public.stock_count_approvals a
    LEFT JOIN public.inventory_godowns g ON g.id = a.expiry_godown_id AND g.organization_id = a.organization_id
    WHERE a.organization_id = p_org_id AND a.product_id = p_product_id
    ORDER BY a.sequence_no DESC LIMIT 1;
    RETURN v_opening || jsonb_build_object('approval', v_approval);
END;
$$;

CREATE FUNCTION public.approve_stock_count(
    p_org_id uuid, p_product_id uuid, p_counted_on date, p_lines jsonb,
    p_expected_movement_count bigint, p_expected_approval_id uuid, p_expiry_godown text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
    v_lines jsonb;
    v_result jsonb;
    v_expiry text := NULLIF(btrim(regexp_replace(p_expiry_godown, '[[:space:]]+', ' ', 'g')), '');
    v_expiry_id uuid;
    v_request_hash bytea;
    v_id uuid;
    v_current_approval uuid;
    v_ledger bigint;
    v_movements bigint;
    v_total bigint;
    v_quarantined bigint;
BEGIN
    IF v_user IS NULL OR COALESCE(public.get_user_org_role(p_org_id), '') NOT IN ('owner', 'admin')
        OR public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'Only an owner or administrator with inventory write access can approve counts.' USING ERRCODE = '42501';
    END IF;
    IF p_counted_on IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR char_length(v_expiry) > 255 THEN
        RAISE EXCEPTION 'Provide a count date, batch rows, and a valid expiry godown name.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Provide between 1 and 1,000 batch rows per product.' USING ERRCODE = '22023';
    END IF;

    WITH normalized AS (
        SELECT btrim(regexp_replace(godown, '[[:space:]]+', ' ', 'g')) AS godown,
               btrim(regexp_replace(COALESCE(batch_number, ''), '[[:space:]]+', ' ', 'g')) AS batch_number,
               expiry_date, trim_scale(quantity) AS quantity
        FROM jsonb_to_recordset(p_lines) AS l(godown text, batch_number text, expiry_date date, quantity numeric)
    )
    SELECT jsonb_agg(to_jsonb(n) ORDER BY lower(godown), lower(batch_number))
    INTO v_lines FROM normalized n;

    IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(v_lines) AS l(godown text, batch_number text, expiry_date date, quantity numeric)
        WHERE godown IS NULL OR char_length(godown) NOT BETWEEN 1 AND 255 OR char_length(batch_number) > 255
           OR (expiry_date IS NOT NULL AND (batch_number = '' OR expiry_date NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'))
           OR quantity IS NULL OR quantity NOT BETWEEN 0 AND 2147483647 OR quantity <> trunc(quantity)
    ) OR EXISTS (
        SELECT 1 FROM jsonb_to_recordset(v_lines) AS l(godown text, batch_number text)
        GROUP BY lower(godown), lower(batch_number) HAVING count(*) > 1
    ) OR EXISTS (
        SELECT 1 FROM jsonb_to_recordset(v_lines) AS l(batch_number text, expiry_date date)
        WHERE batch_number <> '' GROUP BY lower(batch_number)
        HAVING count(DISTINCT expiry_date) > 1 OR (count(expiry_date) > 0 AND count(expiry_date) <> count(*))
    ) THEN
        RAISE EXCEPTION 'Check batch, godown, expiry, and whole quantities. Each batch must have one expiry date and appear once per godown.' USING ERRCODE = '22023';
    END IF;

    SELECT sum(quantity), COALESCE(sum(quantity) FILTER (WHERE expiry_date <= p_counted_on), 0)
    INTO v_total, v_quarantined
    FROM jsonb_to_recordset(v_lines) AS l(expiry_date date, quantity integer);
    IF v_total > 2147483647 THEN
        RAISE EXCEPTION 'The total exceeds the stock ledger’s quantity limit.' USING ERRCODE = '22023';
    END IF;
    IF v_quarantined > 0 AND (v_expiry IS NULL OR EXISTS (
        SELECT 1 FROM jsonb_to_recordset(v_lines) AS l(godown text, expiry_date date, quantity integer)
        WHERE lower(godown) = lower(v_expiry) AND quantity > 0 AND (expiry_date IS NULL OR expiry_date > p_counted_on)
    )) THEN
        RAISE EXCEPTION 'Choose a separate expiry godown that holds no usable stock for this product.' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.products WHERE id = p_product_id AND organization_id = p_org_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active product not found in this organization.' USING ERRCODE = '23503'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.stock_batch_openings WHERE product_id = p_product_id AND organization_id = p_org_id
    ) THEN
        RAISE EXCEPTION 'Record opening batch balances before approving a stock count.' USING ERRCODE = '23503';
    END IF;

    v_request_hash := sha256(convert_to(jsonb_build_array(
        p_counted_on, v_lines, p_expected_movement_count, p_expected_approval_id, v_expiry
    )::text, 'UTF8'));
    SELECT id INTO v_id FROM public.stock_count_approvals
    WHERE organization_id = p_org_id AND product_id = p_product_id AND request_hash = v_request_hash;
    IF FOUND THEN RETURN v_id; END IF;

    IF p_counted_on <> v_today THEN
        RAISE EXCEPTION 'Only counts dated today can be approved.' USING ERRCODE = '22023';
    END IF;
    SELECT id INTO v_current_approval FROM public.stock_count_approvals
    WHERE organization_id = p_org_id AND product_id = p_product_id ORDER BY sequence_no DESC LIMIT 1;
    SELECT COALESCE(sum(quantity_change),0), count(*) INTO v_ledger, v_movements FROM public.stock_movements
    WHERE organization_id = p_org_id AND product_id = p_product_id;
    IF v_movements IS DISTINCT FROM p_expected_movement_count OR v_current_approval IS DISTINCT FROM p_expected_approval_id THEN
        RAISE EXCEPTION 'Stock or the approved count changed. Refresh and verify before approving.' USING ERRCODE = '40001';
    END IF;

    -- Previously quarantined batches must be counted explicitly, even if
    -- zero units remain. An omitted row must never release held stock.
    IF EXISTS (
        SELECT 1
        FROM public.stock_count_approvals a
        CROSS JOIN LATERAL jsonb_to_recordset(a.resulting_lines) AS old(godown text, batch_number text, expiry_date date)
        WHERE a.id = v_current_approval AND old.expiry_date <= a.counted_on
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_to_recordset(v_lines) AS counted(godown text, batch_number text, expiry_date date)
              WHERE lower(counted.godown) = lower(old.godown)
                AND lower(counted.batch_number) = lower(old.batch_number)
                AND counted.expiry_date = old.expiry_date
          )
    ) THEN
        RAISE EXCEPTION 'Include all previously quarantined batches in their expiry godown. Enter zero if a batch is gone.' USING ERRCODE = '22023';
    END IF;

    IF v_quarantined > 0 THEN
        INSERT INTO public.inventory_godowns (organization_id, name) VALUES (p_org_id, v_expiry)
        ON CONFLICT (organization_id, name_key) DO NOTHING;
        SELECT id, name INTO v_expiry_id, v_expiry FROM public.inventory_godowns
        WHERE organization_id = p_org_id AND name_key = lower(v_expiry);
    END IF;

    WITH located AS (
        SELECT CASE WHEN expiry_date <= p_counted_on THEN v_expiry ELSE godown END AS godown,
               batch_number, expiry_date, quantity
        FROM jsonb_to_recordset(v_lines) AS l(godown text, batch_number text, expiry_date date, quantity integer)
        WHERE quantity > 0
    ), combined AS (
        SELECT min(godown) AS godown, min(batch_number) AS batch_number, expiry_date, sum(quantity) AS quantity
        FROM located GROUP BY lower(godown), lower(batch_number), expiry_date
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY lower(godown), lower(batch_number)), '[]'::jsonb)
    INTO v_result FROM combined c;

    -- Post the expiry floor and the adjustment in one transaction. The
    -- existing adjustment function supplies locking, audit and idempotency.
    INSERT INTO public.stock_count_approvals
        (organization_id, product_id, counted_on, counted_quantity, previous_quantity, ledger_movement_count,
         quarantine_quantity, expiry_godown_id, counted_lines, resulting_lines, request_hash, approved_by)
    VALUES (p_org_id, p_product_id, p_counted_on, v_total, v_ledger,
            v_movements + CASE WHEN v_ledger <> v_total THEN 1 ELSE 0 END,
            v_quarantined, v_expiry_id, v_lines, v_result, v_request_hash, v_user)
    RETURNING id INTO v_id;

    IF v_ledger <> v_total THEN
        PERFORM public.record_stock_adjustment(
            p_org_id, p_product_id, (v_total - v_ledger)::integer, 'Approved stock count ' || v_id::text, v_id
        );
    END IF;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_quarantined_stock(), public.get_stock_count_approval(uuid,uuid),
    public.approve_stock_count(uuid,uuid,date,jsonb,bigint,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_count_approval(uuid,uuid),
    public.approve_stock_count(uuid,uuid,date,jsonb,bigint,uuid,text) TO authenticated;
