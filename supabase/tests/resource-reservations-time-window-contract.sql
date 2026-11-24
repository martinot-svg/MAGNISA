-- Contract checks for tenant-safe resource reservations.
DO $reservation_contract$
DECLARE
  v_function regprocedure;
BEGIN
  IF to_regclass('public.reservable_resources') IS NULL
     OR to_regclass('public.resource_reservations') IS NULL THEN
    RAISE EXCEPTION 'resource reservation tables are missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.reservable_resources'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.resource_reservations'::regclass) THEN
    RAISE EXCEPTION 'RLS must be enabled for resource reservation tables';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.resource_reservations'::regclass
      AND conname='resource_reservations_no_overlap'
      AND contype='x'
  ) THEN
    RAISE EXCEPTION 'reservation exclusion constraint is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='resource_reservations'
      AND indexname='resource_reservations_idempotency_unique'
  ) THEN
    RAISE EXCEPTION 'reservation idempotency constraint is missing';
  END IF;

  v_function := 'public.create_resource_reservation(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text)'::regprocedure;
  IF NOT has_function_privilege('authenticated',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot create reservations';
  END IF;
  IF has_function_privilege('anon',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'anon can create reservations';
  END IF;
  v_function := 'public.cancel_resource_reservation(uuid,uuid,text)'::regprocedure;
  IF NOT has_function_privilege('authenticated',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot cancel reservations';
  END IF;
  IF has_function_privilege('anon',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'anon can cancel reservations';
  END IF;
END
$reservation_contract$;
