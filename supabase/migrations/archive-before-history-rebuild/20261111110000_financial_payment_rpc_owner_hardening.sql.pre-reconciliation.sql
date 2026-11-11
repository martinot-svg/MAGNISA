-- Keep the legacy payment mutation private to the SECURITY DEFINER idempotency boundary.
-- A migration replay can otherwise leave wrapper ownership inconsistent across environments.
ALTER FUNCTION public.record_invoice_payment(uuid,uuid,uuid,numeric,date,text,text) OWNER TO postgres;
ALTER FUNCTION public.lot1_record_invoice_payment_idempotent(uuid,uuid,uuid,numeric,date,text,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.record_customer_payment_with_fee_v3(uuid,uuid,uuid,numeric,date,text,text,uuid,text,numeric,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid,uuid,uuid,numeric,date,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lot1_record_invoice_payment_idempotent(uuid,uuid,uuid,numeric,date,text,text,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_payment_with_fee_v3(uuid,uuid,uuid,numeric,date,text,text,uuid,text,numeric,text)
  TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('authenticated',
       'public.record_invoice_payment(uuid,uuid,uuid,numeric,date,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy non-idempotent invoice payment RPC must remain unavailable to authenticated clients';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.record_customer_payment_with_fee_v3(uuid,uuid,uuid,numeric,date,text,text,uuid,text,numeric,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Idempotent customer payment RPC is not executable by authenticated clients';
  END IF;
END;
$$;
