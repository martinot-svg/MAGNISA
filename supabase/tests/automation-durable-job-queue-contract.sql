-- Contract checks for the durable tenant-scoped automation queue.
DO $automation_queue_contract$
DECLARE
  v_function regprocedure;
BEGIN
  IF to_regclass('public.automation_jobs') IS NULL THEN
    RAISE EXCEPTION 'automation_jobs table is missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.automation_jobs'::regclass) THEN
    RAISE EXCEPTION 'RLS must be enabled for automation_jobs';
  END IF;

  IF has_table_privilege('authenticated','public.automation_jobs','SELECT')
    OR has_table_privilege('authenticated','public.automation_jobs','INSERT')
    OR has_table_privilege('anon','public.automation_jobs','SELECT') THEN
    RAISE EXCEPTION 'direct client access to automation_jobs must remain revoked';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='automation_jobs'
      AND indexname='automation_jobs_due_idx'
  ) THEN
    RAISE EXCEPTION 'automation due-job index is missing';
  END IF;

  v_function := 'public.enqueue_automation_job(uuid,text,text,text,jsonb,text,integer)'::regprocedure;
  IF NOT has_function_privilege('authenticated',v_function,'EXECUTE')
    OR has_function_privilege('anon',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'enqueue RPC grants are incorrect';
  END IF;

  v_function := 'public.claim_automation_jobs(text,integer,integer)'::regprocedure;
  IF NOT has_function_privilege('service_role',v_function,'EXECUTE')
    OR has_function_privilege('authenticated',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'claim RPC must be service-role only';
  END IF;

  v_function := 'public.complete_automation_job(uuid,uuid)'::regprocedure;
  IF NOT has_function_privilege('service_role',v_function,'EXECUTE')
    OR has_function_privilege('authenticated',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'complete RPC must be service-role only';
  END IF;

  v_function := 'public.fail_automation_job(uuid,uuid,text)'::regprocedure;
  IF NOT has_function_privilege('service_role',v_function,'EXECUTE')
    OR has_function_privilege('authenticated',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'fail RPC must be service-role only';
  END IF;
END
$automation_queue_contract$;
