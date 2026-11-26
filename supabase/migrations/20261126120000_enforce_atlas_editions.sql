-- Edition checks supplement subscription, role and business eligibility checks.
-- Reads and existing record history are governed by the original RLS policies.
CREATE FUNCTION atlas_private.require_trade_procurement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  workspace_id uuid;
  edition text;
BEGIN
  IF TG_TABLE_NAME = 'goods_receipt_follow_up_resolutions' THEN
    SELECT organization_id INTO workspace_id FROM public.goods_receipts WHERE id = NEW.receipt_id;
  ELSE
    workspace_id := NEW.organization_id;
  END IF;

  -- Serialize with edition changes through the owner console.
  SELECT plan_tier INTO edition
    FROM public.organization_subscriptions
    WHERE organization_id = workspace_id
    FOR SHARE;
  IF edition = 'starter' THEN
    RAISE EXCEPTION 'Atlas Trade is required to write procurement records'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.require_trade_procurement() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER require_trade_for_goods_receipts
  BEFORE INSERT OR UPDATE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION atlas_private.require_trade_procurement();
CREATE TRIGGER require_trade_for_purchase_orders
  BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION atlas_private.require_trade_procurement();
CREATE TRIGGER require_trade_for_supplier_follow_up
  BEFORE INSERT ON atlas_private.goods_receipt_follow_up_resolutions
  FOR EACH ROW EXECUTE FUNCTION atlas_private.require_trade_procurement();
CREATE TRIGGER require_trade_for_supplier_quotes
  BEFORE INSERT ON public.supplier_price_history
  FOR EACH ROW WHEN (NEW.source_type = 'SUPPLIER_QUOTE')
  EXECUTE FUNCTION atlas_private.require_trade_procurement();

-- Network is planned. Existing Network workspaces retain their billing and access.
CREATE FUNCTION atlas_private.limit_new_network_sales()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'organization_subscriptions' THEN
    -- Privileged maintenance and restores run without a signed-in end user.
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.plan_tier = 'enterprise_network' THEN RETURN NEW; END IF;
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.organization_subscriptions
    WHERE organization_id = NEW.organization_id AND plan_tier = 'enterprise_network'
    FOR SHARE
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Atlas Network is unavailable for new subscriptions'
    USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.limit_new_network_sales() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER limit_new_network_subscriptions
  BEFORE INSERT OR UPDATE OF plan_tier ON public.organization_subscriptions
  FOR EACH ROW WHEN (NEW.plan_tier = 'enterprise_network')
  EXECUTE FUNCTION atlas_private.limit_new_network_sales();
CREATE TRIGGER limit_new_network_purchases
  BEFORE INSERT ON atlas_private.atlas_plan_purchases
  FOR EACH ROW WHEN (NEW.product = 'enterprise_network')
  EXECUTE FUNCTION atlas_private.limit_new_network_sales();
