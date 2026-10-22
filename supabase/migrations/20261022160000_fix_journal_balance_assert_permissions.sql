-- Allow authenticated accounting flows to validate journal balance safely.
-- The check is scoped to the caller's organization before exposing validation results.
CREATE OR REPLACE FUNCTION public.magnisa_assert_journal_balanced(p_entry uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h public.journal_entries%rowtype;
  d numeric;
  c numeric;
BEGIN
  SELECT * INTO h
  FROM public.journal_entries
  WHERE id = p_entry;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Écriture introuvable';
  END IF;

  PERFORM public.assert_org_access(h.organization_id);

  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
  INTO d, c
  FROM public.journal_entry_lines
  WHERE journal_entry_id = p_entry;

  IF round(d, 2) <> round(c, 2)
     OR round(d, 2) <> round(h.total_debit, 2)
     OR round(c, 2) <> round(h.total_credit, 2) THEN
    RAISE EXCEPTION 'Écriture déséquilibrée: débit %, crédit %', d, c;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.magnisa_assert_journal_balanced(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.magnisa_assert_journal_balanced(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.magnisa_assert_journal_balanced(uuid) TO authenticated, service_role;
