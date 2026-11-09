-- Structural regression checks for safe PCG mapping resolution.
DO $$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_viewdef('public.pcg2005_journal_lines'::regclass, true);

  IF position('TRANSIT:%' IN v_definition) = 0
     OR position('581' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Explicit internal-transfer keys must map to PCG 581';
  END IF;

  IF position('EXPENSE:%' IN v_definition) = 0
     OR position('mapped_pcg.kind' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Generic expense mappings must be validated against PCG account kind';
  END IF;

  IF has_table_privilege('authenticated', 'public.pcg2005_journal_lines', 'INSERT')
     OR has_table_privilege('authenticated', 'public.pcg2005_journal_lines', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.pcg2005_journal_lines', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated users must not mutate the PCG journal-lines view';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.pcg2005_journal_lines', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated users must retain read access to the PCG journal-lines view';
  END IF;
END $$;
