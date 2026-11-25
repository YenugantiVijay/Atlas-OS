BEGIN;

-- Keep the existing invoice RPC signature and all stock, authorization, and
-- idempotency logic. Extend the accepted rate values for goods in Notification
-- 9/2025-Integrated Tax (Rate). Keep 12% for existing and historical workflows.
DO $migration$
DECLARE
    rpc_oid regprocedure := 'public.create_invoice_atomic(uuid,uuid,jsonb,date,date,character varying,text,uuid,uuid)'::regprocedure;
    definition text := pg_get_functiondef(rpc_oid);
    old_rates constant text := 'NOT IN (0.00, 5.00, 12.00, 18.00, 28.00)';
    new_rates constant text := 'NOT IN (0.00, 0.25, 1.50, 3.00, 5.00, 12.00, 18.00, 28.00, 40.00)';
BEGIN
    IF strpos(definition, old_rates) = 0 THEN
        RAISE EXCEPTION 'Unexpected invoice GST validation. Review the current create_invoice_atomic definition.';
    END IF;

    definition := replace(definition, old_rates, new_rates);
    definition := replace(definition, '0, 5, 12, 18, 28 for issued invoices',
        '0, 0.25, 1.50, 3, 5, 12, 18, 28, or 40 for issued invoices');
    EXECUTE definition;
END;
$migration$;

COMMIT;
