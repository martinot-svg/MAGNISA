-- Acceptance guardrails for the centralized accounting engine.
-- This migration is intentionally data-safe: it adds validation helpers only.

CREATE OR REPLACE FUNCTION public.magnisa_assert_accounting_invariants(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bad bigint;
BEGIN
  PERFORM public.assert_org_access(p_org);

  SELECT count(*) INTO v_bad
  FROM public.journal_entries e
  WHERE e.organization_id = p_org
    AND round(coalesce(e.total_debit,0),2) <> round(coalesce(e.total_credit,0),2);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Accounting invariant failed: unbalanced journal entries=%', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.journal_entry_lines l
  JOIN public.journal_entries e ON e.id=l.journal_entry_id
  WHERE e.organization_id=p_org
    AND l.debit > 0 AND l.credit > 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Accounting invariant failed: mixed debit/credit lines=%', v_bad;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.magnisa_assert_accounting_invariants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.magnisa_assert_accounting_invariants(uuid) TO authenticated;
