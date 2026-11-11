-- Read customer receivables for accounting statements without requiring billing.view
-- or treasury.view. Tenant and accounting permission are enforced inside the definer RPC.
CREATE OR REPLACE FUNCTION public.get_accounting_receivable_maturity(
  p_organization_id uuid,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $receivables$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_org_permission(p_organization_id, 'accounting.view') THEN
    RAISE EXCEPTION 'Permission accounting.view requise pour consulter les échéances clients'
      USING ERRCODE = '42501';
  END IF;

  WITH scoped_invoices AS (
    SELECT i.id,i.number,i.due_date,i.total,i.paid_amount,i.balance_due
    FROM public.invoices i
    WHERE i.organization_id=p_organization_id
      AND i.issue_date<=p_period_end
      AND i.issued_at IS NOT NULL
      AND (i.issued_at AT TIME ZONE 'Indian/Antananarivo')::date<=p_period_end
      AND (i.cancelled_at IS NULL OR (i.cancelled_at AT TIME ZONE 'Indian/Antananarivo')::date>p_period_end)
  ),
  payment_totals AS (
    SELECT p.invoice_id,
      COALESCE(sum(p.amount) FILTER (WHERE p.paid_at IS NOT NULL AND (p.paid_at AT TIME ZONE 'Indian/Antananarivo')::date<=p_period_end),0)::numeric AS paid_as_of,
      COALESCE(sum(p.amount),0)::numeric AS paid_total,
      COALESCE(sum(p.amount) FILTER (WHERE p.paid_at IS NULL),0)::numeric AS missing_paid_date_amount
    FROM public.payments p
    WHERE p.organization_id=p_organization_id
      AND p.status IN ('confirmed','reconciled')
    GROUP BY p.invoice_id
  ),
  invoice_rows AS (
    SELECT i.id,i.number,i.due_date,
      round(i.total-COALESCE(p.paid_as_of,0),2) AS outstanding_amount,
      abs(i.paid_amount-COALESCE(p.paid_total,0))
        + abs(i.balance_due-(i.total-COALESCE(p.paid_total,0))) AS integrity_gap,
      COALESCE(p.missing_paid_date_amount,0) AS missing_paid_date_amount
    FROM scoped_invoices i
    LEFT JOIN payment_totals p ON p.invoice_id=i.id
  ),
  invoice_controls AS (
    SELECT COALESCE(sum(integrity_gap),0)::numeric AS invoice_payment_integrity_gap,
      COALESCE(sum(missing_paid_date_amount),0)::numeric AS payments_missing_date_amount
    FROM invoice_rows
  ),
  unallocated_payments AS (
    SELECT COALESCE(sum(p.amount),0)::numeric AS unallocated_customer_payments_amount
    FROM public.payments p
    WHERE p.organization_id=p_organization_id
      AND p.status IN ('confirmed','reconciled')
      AND p.invoice_id IS NULL
  )
  SELECT jsonb_build_object(
    'invoices',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',r.id,
        'number',r.number,
        'due_date',r.due_date,
        'outstanding_amount',r.outstanding_amount
      ) ORDER BY r.due_date NULLS LAST,r.number)
      FROM invoice_rows r
      WHERE abs(r.outstanding_amount)>=0.005
    ),'[]'::jsonb),
    'invoice_payment_integrity_gap',(SELECT invoice_payment_integrity_gap FROM invoice_controls),
    'payments_missing_date_amount',(SELECT payments_missing_date_amount FROM invoice_controls)
      + (SELECT COALESCE(sum(p.amount),0) FROM public.payments p
         WHERE p.organization_id=p_organization_id
           AND p.status IN ('confirmed','reconciled') AND p.paid_at IS NULL
           AND p.invoice_id IS NULL),
    'unallocated_customer_payments_amount',(SELECT unallocated_customer_payments_amount FROM unallocated_payments)
  )
  INTO v_result;

  RETURN COALESCE(v_result,'{}'::jsonb);
END;
$receivables$;

REVOKE ALL ON FUNCTION public.get_accounting_receivable_maturity(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accounting_receivable_maturity(uuid,date) TO authenticated;

DO $rpc_assert$
DECLARE
  v_function oid;
  v_security_definer boolean;
BEGIN
  v_function := to_regprocedure('public.get_accounting_receivable_maturity(uuid,date)');
  SELECT p.prosecdef INTO v_security_definer
  FROM pg_proc p
  WHERE p.oid=v_function;
  IF v_function IS NULL OR NOT v_security_definer THEN
    RAISE EXCEPTION 'Receivables RPC must exist and execute as SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon',v_function,'EXECUTE')
     OR NOT has_function_privilege('authenticated',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'Receivables RPC grants are not restricted to authenticated users';
  END IF;
END;
$rpc_assert$;

COMMENT ON FUNCTION public.get_accounting_receivable_maturity(uuid,date) IS
  'Accounting-only, tenant-scoped customer receivable maturity and invoice/payment reconciliation. SECURITY DEFINER is guarded by accounting.view and does not grant billing or treasury access.';
