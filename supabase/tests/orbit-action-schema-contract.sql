-- Orbit Action: read-only schema and authorization contract.
DO $orbit_action_contract$
DECLARE missing text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
   WHERE version='20261114121000') THEN
   RAISE EXCEPTION 'Orbit Action task migration absent';
 END IF;
 IF (SELECT count(*) FROM pg_class WHERE oid IN (
   to_regclass('public.orbit_action_tasks'),
   to_regclass('public.orbit_action_comments')
 ) AND relrowsecurity)<>2 THEN
   RAISE EXCEPTION 'Orbit Action tasks/comments RLS missing';
 END IF;
 IF has_table_privilege('anon','public.orbit_action_tasks','SELECT')
 OR has_table_privilege('anon','public.orbit_action_comments','SELECT')
 OR has_table_privilege('anon','public.orbit_action_tasks','INSERT')
 OR has_table_privilege('anon','public.orbit_action_comments','INSERT') THEN
   RAISE EXCEPTION 'Anonymous role must not inspect or create Action records';
 END IF;
 IF has_table_privilege('authenticated','public.orbit_action_tasks','DELETE')
 OR has_table_privilege('authenticated','public.orbit_action_comments','UPDATE')
 OR has_table_privilege('authenticated','public.orbit_action_comments','DELETE') THEN
   RAISE EXCEPTION 'Task deletion/comment rewriting unexpectedly permitted';
 END IF;
 IF has_column_privilege('authenticated','public.orbit_action_tasks','organization_id','UPDATE')
 OR has_column_privilege('authenticated','public.orbit_action_tasks','created_by','UPDATE')
 OR has_column_privilege('authenticated','public.orbit_action_tasks','project_id','UPDATE')
 OR has_column_privilege('authenticated','public.orbit_action_tasks','parent_task_id','UPDATE') THEN
   RAISE EXCEPTION 'Task security-critical fields unexpectedly mutable';
 END IF;
 SELECT string_agg(expected.policy,', ') INTO missing
 FROM (VALUES
 ('orbit_action_tasks','orbit_action_tasks_read'),
 ('orbit_action_tasks','orbit_action_tasks_create'),
 ('orbit_action_tasks','orbit_action_tasks_update'),
 ('orbit_action_comments','orbit_action_comments_read'),
 ('orbit_action_comments','orbit_action_comments_create')
 ) expected(tbl,policy)
 LEFT JOIN pg_policies existing ON existing.schemaname='public'
   AND existing.tablename=expected.tbl AND existing.policyname=expected.policy
 WHERE existing.policyname IS NULL;
 IF missing IS NOT NULL THEN
   RAISE EXCEPTION 'Action policies missing: %',missing;
 END IF;
 RAISE NOTICE 'PASS Orbit Action: tasks/comments tenant RLS, immutable scope, no anonymous access';
END
$orbit_action_contract$;
