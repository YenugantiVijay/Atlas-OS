BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN gst_place_of_supply_code text,
  ADD COLUMN gst_seller_state_code text,
  ADD CONSTRAINT invoice_gst_jurisdiction_valid CHECK (
    (gst_place_of_supply_code IS NULL AND gst_seller_state_code IS NULL)
    OR (
      gst_place_of_supply_code IS NOT NULL AND gst_seller_state_code IS NOT NULL
      AND gst_place_of_supply_code ~ '^(0[1-9]|1[0-9]|2[0-4679]|3[0-8]|97|99)$'
      AND gst_seller_state_code ~ '^(0[1-9]|1[0-9]|2[0-4679]|3[0-8]|97|99)$'
    )
  );

CREATE FUNCTION public.guard_invoice_gst_jurisdiction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.gst_place_of_supply_code, NEW.gst_seller_state_code)
       IS NOT DISTINCT FROM ROW(OLD.gst_place_of_supply_code, OLD.gst_seller_state_code) THEN
      RETURN NEW;
    END IF;
    IF OLD.gst_place_of_supply_code IS NOT NULL THEN
      RAISE EXCEPTION 'The confirmed GST jurisdiction is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.gst_place_of_supply_code IS NOT NULL AND current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Use confirm_invoice_gst_jurisdiction to confirm GST jurisdiction' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_invoice_gst_jurisdiction
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_gst_jurisdiction();

CREATE FUNCTION public.confirm_invoice_gst_jurisdiction(p_org_id uuid, p_invoice_id uuid, p_place_of_supply_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  invoice_row public.invoices%ROWTYPE;
  seller_state text;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.get_user_org_role(p_org_id), '') NOT IN ('owner', 'admin', 'accounts') THEN
    RAISE EXCEPTION 'An active owner, admin, or accounts membership is required' USING ERRCODE = '42501';
  END IF;

  IF p_place_of_supply_code IS NULL OR p_place_of_supply_code !~ '^(0[1-9]|1[0-9]|2[0-4679]|3[0-8]|97|99)$' THEN
    RAISE EXCEPTION 'Choose a valid invoice place of supply' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = p_invoice_id AND organization_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND OR invoice_row.status NOT IN ('ISSUED', 'PARTIALLY_PAID', 'PAID') THEN
    RAISE EXCEPTION 'An issued invoice in this workspace is required' USING ERRCODE = '22023';
  END IF;

  IF invoice_row.gst_place_of_supply_code IS NOT NULL THEN
    IF invoice_row.gst_place_of_supply_code <> p_place_of_supply_code THEN
      RAISE EXCEPTION 'The confirmed place of supply cannot be changed' USING ERRCODE = '23514';
    END IF;
    seller_state := invoice_row.gst_seller_state_code;
  ELSE
    SELECT left(upper(btrim(gstin)), 2) INTO seller_state
    FROM public.organizations WHERE id = p_org_id
      AND upper(btrim(gstin)) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$';
    IF seller_state IS NULL OR seller_state !~ '^(0[1-9]|1[0-9]|2[0-4679]|3[0-8]|97|99)$' THEN
      RAISE EXCEPTION 'A valid seller GSTIN is required' USING ERRCODE = '22023';
    END IF;

    UPDATE public.invoices
    SET gst_place_of_supply_code = p_place_of_supply_code, gst_seller_state_code = seller_state
    WHERE id = p_invoice_id AND organization_id = p_org_id;

    INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    VALUES (p_org_id, auth.uid(), 'CONFIRM_INVOICE_GST_JURISDICTION', 'INVOICE', p_invoice_id,
      jsonb_build_object('place_of_supply_code', p_place_of_supply_code, 'seller_state_code', seller_state));
  END IF;

  RETURN jsonb_build_object('place_of_supply_code', p_place_of_supply_code, 'seller_state_code', seller_state);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_invoice_gst_jurisdiction(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_invoice_gst_jurisdiction(uuid, uuid, text) TO authenticated;

COMMIT;
