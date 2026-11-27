DO $contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname='btree_gist'
      AND n.nspname='extensions'
      AND e.extrelocatable
  ) THEN
    RAISE EXCEPTION 'btree_gist must be installed in the extensions schema';
  END IF;
END;
$contract$;
