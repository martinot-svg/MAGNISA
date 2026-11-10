-- Explicit PCG mapping for treasury accounts and accounting-only reconciliation RPC.
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS pcg_account_code text;

DO $cash_mapping_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.financial_accounts'::regclass
      AND conname='financial_accounts_pcg_account_code_fkey'
  ) THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_pcg_account_code_fkey
      FOREIGN KEY (pcg_account_code) REFERENCES public.pcg2005_accounts(code) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.financial_accounts'::regclass
      AND conname='financial_accounts_pcg_account_code_class5_check'
  ) THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_pcg_account_code_class5_check
      CHECK (pcg_account_code IS NULL OR pcg_account_code ~ '^5');
  END IF;
END;
$cash_mapping_fk$;

UPDATE public.financial_accounts
SET pcg_account_code=CASE type
  WHEN 'bank' THEN '512'
  WHEN 'mobile_money' THEN '517'
  WHEN 'cash' THEN '53'
  ELSE NULL
END
WHERE pcg_account_code IS NULL;

CREATE OR REPLACE FUNCTION public.set_financial_account_pcg_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $set_cash_code$
BEGIN
  IF NEW.pcg_account_code IS NULL
     OR (TG_OP='UPDATE'
         AND NEW.type IS DISTINCT FROM OLD.type
         AND NEW.pcg_account_code IS NOT DISTINCT FROM OLD.pcg_account_code) THEN
    NEW.pcg_account_code:=CASE NEW.type
      WHEN 'bank' THEN '512'
      WHEN 'mobile_money' THEN '517'
      WHEN 'cash' THEN '53'
      ELSE NULL
    END;
  END IF;
  RETURN NEW;
END;
$set_cash_code$;

DROP TRIGGER IF EXISTS set_financial_account_pcg_code ON public.financial_accounts;
CREATE TRIGGER set_financial_account_pcg_code
BEFORE INSERT OR UPDATE OF type,pcg_account_code ON public.financial_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_financial_account_pcg_code();

CREATE INDEX IF NOT EXISTS financial_accounts_org_pcg_idx
  ON public.financial_accounts(organization_id,pcg_account_code);

COMMENT ON COLUMN public.financial_accounts.pcg_account_code IS
  'PCG 2005 class 5 account used to reconcile this bank, mobile-money or cash account with the general ledger.';

CREATE OR REPLACE FUNCTION public.get_accounting_cash_reconciliation(
  p_organization_id uuid,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $cash_reconciliation$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_org_permission(p_organization_id,'accounting.view') THEN
    RAISE EXCEPTION 'Permission accounting.view requise pour rapprocher la trésorerie'
      USING ERRCODE='42501';
  END IF;

  WITH accounts AS (
    SELECT fa.id,fa.name,fa.type,fa.pcg_account_code,fa.balance AS current_balance,
      COALESCE(sum(ft.amount),0)::numeric AS movements_total,
      COALESCE(sum(ft.amount) FILTER (WHERE ft.transaction_date<=p_period_end),0)::numeric AS as_of_balance
    FROM public.financial_accounts fa
    LEFT JOIN public.financial_transactions ft
      ON ft.organization_id=fa.organization_id AND ft.financial_account_id=fa.id
    WHERE fa.organization_id=p_organization_id
    GROUP BY fa.id,fa.name,fa.type,fa.pcg_account_code,fa.balance
  ),
  financial_by_code AS (
    SELECT pcg_account_code,
      COALESCE(sum(as_of_balance),0)::numeric AS financial_balance,
      COALESCE(sum(abs(current_balance-movements_total)),0)::numeric AS movement_gap,
      count(*)::int AS account_count
    FROM accounts
    WHERE pcg_account_code IS NOT NULL
    GROUP BY pcg_account_code
  ),
  ledger_by_code AS (
    SELECT pcg_code,
      COALESCE(sum(debit-credit),0)::numeric AS ledger_balance
    FROM public.pcg2005_journal_lines
    WHERE organization_id=p_organization_id
      AND status='posted'
      AND entry_date<=p_period_end
      AND pcg_code ~ '^(511|512|515|517|518|53|54)$'
    GROUP BY pcg_code
  ),
  comparisons AS (
    SELECT COALESCE(f.pcg_account_code,l.pcg_code) AS pcg_account_code,
      COALESCE(f.financial_balance,0)::numeric AS financial_balance,
      COALESCE(l.ledger_balance,0)::numeric AS ledger_balance,
      (COALESCE(f.financial_balance,0)-COALESCE(l.ledger_balance,0))::numeric AS difference,
      COALESCE(f.account_count,0)::int AS account_count
    FROM financial_by_code f
    FULL OUTER JOIN ledger_by_code l ON l.pcg_code=f.pcg_account_code
  ),
  unknown_accounts AS (
    SELECT count(*)::int AS account_count,
      COALESCE(sum(current_balance),0)::numeric AS current_balance
    FROM accounts WHERE pcg_account_code IS NULL
  )
  SELECT jsonb_build_object(
    'accounts',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',a.id,'name',a.name,'type',a.type,'pcg_account_code',a.pcg_account_code,
        'current_balance',a.current_balance,'movements_total',a.movements_total,
        'as_of_balance',a.as_of_balance,'movement_gap',a.current_balance-a.movements_total
      ) ORDER BY a.name) FROM accounts a
    ),'[]'::jsonb),
    'comparisons',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pcg_account_code',c.pcg_account_code,'financial_balance',c.financial_balance,
        'ledger_balance',c.ledger_balance,'difference',c.difference,'account_count',c.account_count
      ) ORDER BY c.pcg_account_code) FROM comparisons c
    ),'[]'::jsonb),
    'account_movement_gap',(SELECT COALESCE(sum(abs(current_balance-movements_total)),0) FROM accounts),
    'gl_reconciliation_gap',(SELECT COALESCE(sum(abs(difference)),0) FROM comparisons),
    'unknown_account_count',(SELECT account_count FROM unknown_accounts),
    'unknown_current_balance',(SELECT current_balance FROM unknown_accounts)
  )
  INTO v_result;

  RETURN COALESCE(v_result,'{}'::jsonb);
END;
$cash_reconciliation$;

REVOKE ALL ON FUNCTION public.get_accounting_cash_reconciliation(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_accounting_cash_reconciliation(uuid,date) TO authenticated;

DO $cash_rpc_assert$
DECLARE
  v_function oid;
  v_security_definer boolean;
BEGIN
  v_function:=to_regprocedure('public.get_accounting_cash_reconciliation(uuid,date)');
  SELECT p.prosecdef INTO v_security_definer FROM pg_proc p WHERE p.oid=v_function;
  IF v_function IS NULL OR NOT v_security_definer
     OR has_function_privilege('anon',v_function,'EXECUTE')
     OR NOT has_function_privilege('authenticated',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'Cash reconciliation RPC security/grants are invalid';
  END IF;
END;
$cash_rpc_assert$;

COMMENT ON FUNCTION public.get_accounting_cash_reconciliation(uuid,date) IS
  'Tenant-scoped cash and bank reconciliation for accounting.view users. Compares treasury subledger balances and movements with posted PCG class 5 general-ledger balances as of the reporting date.';
