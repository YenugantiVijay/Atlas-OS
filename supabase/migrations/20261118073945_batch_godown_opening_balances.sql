-- Allocate the existing ledger balance to batches and godowns without posting stock.
CREATE TABLE public.inventory_godowns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    name_key text GENERATED ALWAYS AS (lower(name)) STORED,
    UNIQUE (organization_id, name_key),
    UNIQUE (organization_id, id)
);

CREATE TABLE public.stock_batch_openings (
    organization_id uuid NOT NULL,
    product_id uuid NOT NULL,
    counted_on date NOT NULL,
    ledger_quantity bigint NOT NULL CHECK (ledger_quantity > 0),
    ledger_movement_count bigint NOT NULL CHECK (ledger_movement_count > 0),
    request_hash bytea NOT NULL,
    recorded_by uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, product_id),
    FOREIGN KEY (product_id, organization_id) REFERENCES public.products(id, organization_id)
);

CREATE TABLE public.stock_batch_opening_lines (
    organization_id uuid NOT NULL,
    product_id uuid NOT NULL,
    godown_id uuid NOT NULL,
    batch_number text NOT NULL CHECK (char_length(batch_number) <= 255),
    batch_key text GENERATED ALWAYS AS (lower(batch_number)) STORED,
    expiry_date date,
    quantity integer NOT NULL CHECK (quantity > 0),
    CHECK (expiry_date IS NULL OR batch_number <> ''),
    PRIMARY KEY (organization_id, product_id, godown_id, batch_key),
    FOREIGN KEY (organization_id, product_id) REFERENCES public.stock_batch_openings(organization_id, product_id),
    FOREIGN KEY (organization_id, godown_id) REFERENCES public.inventory_godowns(organization_id, id)
);

ALTER TABLE public.inventory_godowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_batch_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_batch_opening_lines ENABLE ROW LEVEL SECURITY;

-- The application uses the two bounded RPCs below. No client can change the
-- recorded opening balances through the table API.
REVOKE ALL ON public.inventory_godowns, public.stock_batch_openings, public.stock_batch_opening_lines
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_stock_batch_opening(p_org_id uuid, p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_opening public.stock_batch_openings%ROWTYPE;
    v_quantity bigint;
    v_movements bigint;
    v_lines jsonb;
BEGIN
    IF auth.uid() IS NULL OR COALESCE(public.get_user_org_role(p_org_id), '') NOT IN ('owner', 'admin', 'inventory') THEN
        RAISE EXCEPTION 'You do not have access to this organization’s batch opening balances.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.products WHERE organization_id = p_org_id AND id = p_product_id) THEN
        RAISE EXCEPTION 'Product not found in this organization.' USING ERRCODE = '23503';
    END IF;

    SELECT COALESCE(sum(quantity_change), 0), count(*)
    INTO v_quantity, v_movements
    FROM public.stock_movements WHERE organization_id = p_org_id AND product_id = p_product_id;

    SELECT * INTO v_opening FROM public.stock_batch_openings
    WHERE organization_id = p_org_id AND product_id = p_product_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ledger_quantity', v_quantity, 'ledger_movement_count', v_movements, 'opening', NULL);
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'godown', g.name, 'batch_number', l.batch_number, 'expiry_date', l.expiry_date, 'quantity', l.quantity
    ) ORDER BY g.name_key, l.batch_key) INTO v_lines
    FROM public.stock_batch_opening_lines l
    JOIN public.inventory_godowns g ON g.organization_id = l.organization_id AND g.id = l.godown_id
    WHERE l.organization_id = p_org_id AND l.product_id = p_product_id;

    RETURN jsonb_build_object('ledger_quantity', v_quantity, 'ledger_movement_count', v_movements, 'opening', jsonb_build_object(
        'counted_on', v_opening.counted_on,
        'quantity', v_opening.ledger_quantity,
        'current', v_opening.ledger_movement_count = v_movements AND v_opening.ledger_quantity = v_quantity,
        'lines', v_lines
    ));
END;
$$;

CREATE FUNCTION public.record_stock_batch_opening(
    p_org_id uuid, p_product_id uuid, p_counted_on date, p_lines jsonb, p_expected_movement_count bigint
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_lines jsonb;
    v_hash bytea;
    v_existing_hash bytea;
    v_quantity bigint;
    v_movements bigint;
BEGIN
    IF v_user IS NULL OR COALESCE(public.get_user_org_role(p_org_id), '') NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only an owner or administrator can record opening batch balances.' USING ERRCODE = '42501';
    END IF;
    IF public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'This organization cannot write inventory records.' USING ERRCODE = '42501';
    END IF;
    IF p_counted_on IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Provide a count date and batch allocation rows.' USING ERRCODE = '22023';
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
        WHERE godown IS NULL OR char_length(godown) NOT BETWEEN 1 AND 255
           OR char_length(batch_number) > 255 OR (expiry_date IS NOT NULL AND batch_number = '')
           OR (expiry_date IS NOT NULL AND expiry_date NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31')
           OR quantity IS NULL OR quantity NOT BETWEEN 1 AND 2147483647 OR quantity <> trunc(quantity)
    ) THEN
        RAISE EXCEPTION 'Enter a godown, valid batch details, and a positive whole quantity on each row.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(v_lines) AS l(godown text, batch_number text)
        GROUP BY lower(godown), lower(batch_number) HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'A batch can only appear once per godown.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(v_lines) AS l(batch_number text, expiry_date date)
        WHERE batch_number <> ''
        GROUP BY lower(batch_number)
        HAVING count(DISTINCT expiry_date) > 1 OR (count(expiry_date) > 0 AND count(expiry_date) <> count(*))
    ) THEN
        RAISE EXCEPTION 'Use the same expiry date for a batch across all godowns.' USING ERRCODE = '22023';
    END IF;

    -- Stock movement inserts take this same lock before updating the ledger.
    PERFORM id FROM public.products WHERE organization_id = p_org_id AND id = p_product_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active product not found in this organization.' USING ERRCODE = '23503';
    END IF;

    v_hash := sha256(convert_to(p_counted_on::text || v_lines::text, 'UTF8'));
    SELECT request_hash INTO v_existing_hash FROM public.stock_batch_openings
    WHERE organization_id = p_org_id AND product_id = p_product_id;
    IF FOUND THEN
        IF v_hash = v_existing_hash THEN RETURN; END IF;
        RAISE EXCEPTION 'An opening batch allocation already exists for this product.' USING ERRCODE = '23505';
    END IF;
    IF p_counted_on <> (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN
        RAISE EXCEPTION 'Opening balances require a count dated today.' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(sum(quantity_change), 0), count(*)
    INTO v_quantity, v_movements
    FROM public.stock_movements WHERE organization_id = p_org_id AND product_id = p_product_id;

    IF v_movements IS DISTINCT FROM p_expected_movement_count THEN
        RAISE EXCEPTION 'The stock ledger changed. Refresh it and verify the count before saving.' USING ERRCODE = '40001';
    END IF;
    IF v_quantity <> (SELECT sum(quantity) FROM jsonb_to_recordset(v_lines) AS l(quantity numeric)) THEN
        RAISE EXCEPTION 'The opening rows must add up to the existing ledger balance of %.', v_quantity USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.inventory_godowns (organization_id, name)
    SELECT p_org_id, min(godown) FROM jsonb_to_recordset(v_lines) AS l(godown text)
    GROUP BY lower(godown) ORDER BY lower(godown)
    ON CONFLICT (organization_id, name_key) DO NOTHING;

    INSERT INTO public.stock_batch_openings
        (organization_id, product_id, counted_on, ledger_quantity, ledger_movement_count, request_hash, recorded_by)
    VALUES (p_org_id, p_product_id, p_counted_on, v_quantity, v_movements, v_hash, v_user);

    INSERT INTO public.stock_batch_opening_lines (organization_id, product_id, godown_id, batch_number, expiry_date, quantity)
    SELECT p_org_id, p_product_id, g.id, l.batch_number, l.expiry_date, l.quantity::integer
    FROM jsonb_to_recordset(v_lines) AS l(godown text, batch_number text, expiry_date date, quantity numeric)
    JOIN public.inventory_godowns g ON g.organization_id = p_org_id AND g.name_key = lower(l.godown);
END;
$$;

REVOKE ALL ON FUNCTION public.get_stock_batch_opening(uuid, uuid),
    public.record_stock_batch_opening(uuid, uuid, date, jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_batch_opening(uuid, uuid),
    public.record_stock_batch_opening(uuid, uuid, date, jsonb, bigint) TO authenticated;
