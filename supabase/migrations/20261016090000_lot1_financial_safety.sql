-- MAGNISA Lot 1. Tested on isolated MAGNISA-TEST Supabase project only.
-- Do not apply to production without review, backup, permissions audit and QA sign-off.
-- Current application branch uses the lot1_* functions; keep schema and application releases coordinated.

-- =====================================
-- 1. lot1_01_financial_privileges_hardening_test
-- =====================================
-- Lot 1 / Test only. Restrict dangerous table privileges; never run automatically in production.
DO $lot1$
DECLARE v_table text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY[
  'audit_logs','expenses','financial_accounts','financial_transactions','invoices',
  'payments','supplier_payments','supplier_invoices','journal_entries',
  'journal_entry_lines','credit_notes','loans','partner_accounts','partner_account_movements'
 ] LOOP
  EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated',v_table);
 END LOOP;
END $lot1$;
-- Direct writes on financial totals must go through controlled SECURITY DEFINER functions.
REVOKE INSERT, UPDATE ON TABLE public.invoices FROM authenticated;
REVOKE INSERT ON TABLE public.financial_accounts FROM authenticated;

-- =====================================
-- 2. lot1_02_financial_integrity_constraints_test
-- =====================================
-- Lot 1 / test. Constraints compatible with distinct transfers and source-linked movements.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS payments_org_idempotency_key_unique ON public.payments(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_org_idempotency_key_unique ON public.expenses(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_source_account_kind_unique
ON public.financial_transactions(organization_id,source_type,source_id,financial_account_id,kind)
WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- =====================================
-- 3. lot1_03_transfer_funds_lock_order_test
-- =====================================
CREATE OR REPLACE FUNCTION public.transfer_funds(p_org uuid, p_from uuid, p_to uuid, p_amount numeric, p_date date, p_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a_from public.financial_accounts%rowtype;a_to public.financial_accounts%rowtype;v_transfer uuid:=gen_random_uuid();v_entry uuid;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'treasury.transfer');
  if p_from=p_to then raise exception 'Les comptes doivent être différents';end if;
  if p_amount<=0 then raise exception 'Montant invalide';end if;
  -- Lock both accounts in deterministic order to avoid reverse-transfer deadlocks.
  perform id from public.financial_accounts where organization_id=p_org and is_active and id in (p_from,p_to) order by id for update;
  select * into a_from from public.financial_accounts where id=p_from and organization_id=p_org and is_active;
  select * into a_to from public.financial_accounts where id=p_to and organization_id=p_org and is_active;
  if a_from.id is null or a_to.id is null then raise exception 'Compte invalide';end if;
  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=a_from.id;
  update public.financial_accounts set balance=balance+p_amount,updated_at=now() where id=a_to.id;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description) values
    (p_org,a_from.id,p_date,-p_amount,'transfer_out','transfer',v_transfer,p_reference,'Transfert vers '||a_to.name),
    (p_org,a_to.id,p_date,p_amount,'transfer_in','transfer',v_transfer,p_reference,'Transfert depuis '||a_from.name);
  insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
  values(p_org,p_date,coalesce(nullif(trim(p_reference),''),'TRF-'||left(v_transfer::text,8)),'Transfert interne','transfer',v_transfer,p_amount,p_amount) returning id into v_entry;
  insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id) values
    (p_org,v_entry,'TREASURY:'||a_to.id::text,a_to.name,p_amount,0,a_to.id),
    (p_org,v_entry,'TREASURY:'||a_from.id::text,a_from.name,0,p_amount,a_from.id);
  perform public.audit_event(p_org,'treasury.transfer','transfer',v_transfer,null,jsonb_build_object('from',a_from.id,'to',a_to.id,'amount',p_amount));
  return v_transfer;
end;$function$

-- =====================================
-- 4. lot1_04_financial_audit_immutability_test
-- =====================================
-- Lot 1 / TEST only: immutable audit ledger and row-level financial change history.
CREATE OR REPLACE FUNCTION public.lot1_prevent_audit_log_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
 RAISE EXCEPTION 'Audit logs are append-only';
END;
$fn$;
DROP TRIGGER IF EXISTS lot1_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER lot1_audit_logs_append_only
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.lot1_prevent_audit_log_change();
DO $lot1$
DECLARE v_table text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY[
  'invoices','payments','expenses','financial_transactions','supplier_payments'
 ] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS lot1_financial_row_audit ON public.%I',v_table);
  EXECUTE format('CREATE TRIGGER lot1_financial_row_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',v_table);
 END LOOP;
END $lot1$;
REVOKE ALL ON FUNCTION public.lot1_prevent_audit_log_change() FROM PUBLIC, anon, authenticated;

-- =====================================
-- 5. lot1_05_financial_reconciliation_views_test
-- =====================================
-- Lot 1 reconciliation diagnostics; access revoked for public clients until permissions are explicitly audited.
CREATE OR REPLACE VIEW public.lot1_invoice_payment_reconciliation WITH (security_invoker=true) AS
SELECT i.organization_id, i.id AS invoice_id, i.number,
 i.total, i.paid_amount AS booked_paid, i.balance_due,
 COALESCE(p.confirmed_paid,0) AS recorded_paid,
 i.paid_amount-COALESCE(p.confirmed_paid,0) AS paid_gap,
 i.balance_due-(i.total-i.paid_amount) AS balance_gap
FROM public.invoices i
LEFT JOIN (
 SELECT organization_id, invoice_id, SUM(amount) confirmed_paid
 FROM public.payments WHERE status IN ('confirmed','reconciled')
 GROUP BY organization_id, invoice_id
) p ON p.organization_id=i.organization_id AND p.invoice_id=i.id
WHERE i.status <> 'cancelled';
CREATE OR REPLACE VIEW public.lot1_financial_account_movement_review WITH (security_invoker=true) AS
SELECT a.organization_id,a.id account_id,a.name,a.type,a.balance current_balance,
 COALESCE(m.movement_total,0) recorded_movement_total,
 a.balance-COALESCE(m.movement_total,0) residual_opening_or_unrecorded
FROM public.financial_accounts a
LEFT JOIN (
 SELECT organization_id,financial_account_id,SUM(amount) movement_total
 FROM public.financial_transactions GROUP BY organization_id,financial_account_id
) m ON m.organization_id=a.organization_id AND m.financial_account_id=a.id;
REVOKE ALL ON public.lot1_invoice_payment_reconciliation,public.lot1_financial_account_movement_review FROM PUBLIC,anon,authenticated;
COMMENT ON VIEW public.lot1_financial_account_movement_review IS 'Residual can include legitimate opening balances. Not evidence of error without opening balance records.';

-- =====================================
-- 6. lot1_06_safe_financial_account_creation_test
-- =====================================
CREATE OR REPLACE FUNCTION public.lot1_create_financial_account(p_org uuid,p_name text,p_type text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $func$
DECLARE v_id uuid;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'treasury.transfer');
 IF p_name IS NULL OR length(trim(p_name))<2 THEN RAISE EXCEPTION 'Nom de compte invalide'; END IF;
 IF p_type NOT IN ('bank','cash','mobile_money','cheque_clearing') THEN RAISE EXCEPTION 'Type de compte invalide'; END IF;
 INSERT INTO public.financial_accounts(organization_id,name,type,balance,is_active)
 VALUES(p_org,trim(p_name),p_type,0,true) RETURNING id INTO v_id;
 PERFORM public.audit_event(p_org,'financial_account.created','financial_account',v_id,NULL,jsonb_build_object('name',trim(p_name),'type',p_type));
 RETURN v_id;
END;$func$;
REVOKE ALL ON FUNCTION public.lot1_create_financial_account(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lot1_create_financial_account(uuid,text,text) TO authenticated;

-- =====================================
-- 7. lot1_07_idempotent_financial_rpcs_test
-- =====================================
CREATE TABLE IF NOT EXISTS public.lot1_financial_idempotency(
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 request_key uuid NOT NULL,
 operation_type text NOT NULL,
 request_digest text NOT NULL,
 result_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id,request_key)
);
ALTER TABLE public.lot1_financial_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lot1_financial_idempotency FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lot1_record_invoice_payment_idempotent(
 p_org uuid,p_invoice uuid,p_account uuid,p_amount numeric,p_paid_at date,p_method text,p_reference text,p_request_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_digest text;v_old public.lot1_financial_idempotency%rowtype;v_id uuid;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'payments.record');
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'Clé de requête obligatoire'; END IF;
 v_digest:=md5(jsonb_build_array(p_org,p_invoice,p_account,p_amount,p_paid_at,p_method,p_reference)::text);
 INSERT INTO public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest)
 VALUES(p_org,p_request_key,'customer_payment',v_digest) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT v_old FROM public.lot1_financial_idempotency WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
 IF v_old.operation_type<>'customer_payment' OR v_old.request_digest<>v_digest THEN RAISE EXCEPTION 'Clé de requête déjà utilisée pour une autre opération'; END IF;
 IF v_old.result_id IS NOT NULL THEN RETURN v_old.result_id; END IF;
 v_id:=public.record_invoice_payment(p_org,p_invoice,p_account,p_amount,p_paid_at,p_method,p_reference);
 UPDATE public.lot1_financial_idempotency SET result_id=v_id WHERE organization_id=p_org AND request_key=p_request_key;
 RETURN v_id;
END;$fn$;

CREATE OR REPLACE FUNCTION public.lot1_record_expense_idempotent(
 p_org uuid,p_description text,p_amount numeric,p_date date,p_account uuid,p_category text,p_request_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_digest text;v_old public.lot1_financial_idempotency%rowtype;v_id uuid;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'expenses.record');
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'Clé de requête obligatoire'; END IF;
 v_digest:=md5(jsonb_build_array(p_org,p_description,p_amount,p_date,p_account,p_category)::text);
 INSERT INTO public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest)
 VALUES(p_org,p_request_key,'expense',v_digest) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT v_old FROM public.lot1_financial_idempotency WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
 IF v_old.operation_type<>'expense' OR v_old.request_digest<>v_digest THEN RAISE EXCEPTION 'Clé de requête déjà utilisée pour une autre opération'; END IF;
 IF v_old.result_id IS NOT NULL THEN RETURN v_old.result_id; END IF;
 v_id:=public.record_expense(p_org,p_description,p_amount,p_date,p_account,p_category);
 UPDATE public.lot1_financial_idempotency SET result_id=v_id WHERE organization_id=p_org AND request_key=p_request_key;
 RETURN v_id;
END;$fn$;

CREATE OR REPLACE FUNCTION public.lot1_transfer_funds_idempotent(
 p_org uuid,p_from uuid,p_to uuid,p_amount numeric,p_date date,p_reference text,p_request_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_digest text;v_old public.lot1_financial_idempotency%rowtype;v_id uuid;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'treasury.transfer');
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'Clé de requête obligatoire'; END IF;
 v_digest:=md5(jsonb_build_array(p_org,p_from,p_to,p_amount,p_date,p_reference)::text);
 INSERT INTO public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest)
 VALUES(p_org,p_request_key,'transfer',v_digest) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT v_old FROM public.lot1_financial_idempotency WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
 IF v_old.operation_type<>'transfer' OR v_old.request_digest<>v_digest THEN RAISE EXCEPTION 'Clé de requête déjà utilisée pour une autre opération'; END IF;
 IF v_old.result_id IS NOT NULL THEN RETURN v_old.result_id; END IF;
 v_id:=public.transfer_funds(p_org,p_from,p_to,p_amount,p_date,p_reference);
 UPDATE public.lot1_financial_idempotency SET result_id=v_id WHERE organization_id=p_org AND request_key=p_request_key;
 RETURN v_id;
END;$fn$;
REVOKE ALL ON FUNCTION public.lot1_record_invoice_payment_idempotent(uuid,uuid,uuid,numeric,date,text,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.lot1_record_expense_idempotent(uuid,text,numeric,date,uuid,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.lot1_transfer_funds_idempotent(uuid,uuid,uuid,numeric,date,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lot1_record_invoice_payment_idempotent(uuid,uuid,uuid,numeric,date,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lot1_record_expense_idempotent(uuid,text,numeric,date,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lot1_transfer_funds_idempotent(uuid,uuid,uuid,numeric,date,text,uuid) TO authenticated;
