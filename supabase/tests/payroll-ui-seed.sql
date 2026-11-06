-- Isolated fixture for authenticated payroll settings UI tests.
-- This database exists only inside the disposable Supabase CI stack.
\set ON_ERROR_STOP on
\set org_id 'e1000000-0000-4000-8000-000000000001'
\set history_id 'e1000000-0000-4000-8000-000000000011'
\set current_id 'e1000000-0000-4000-8000-000000000012'
\set future_id 'e1000000-0000-4000-8000-000000000013'
\set delete_id 'e1000000-0000-4000-8000-000000000014'
\set invalid_id 'e1000000-0000-4000-8000-000000000015'
\set valid_id 'e1000000-0000-4000-8000-000000000016'

BEGIN;

INSERT INTO public.organizations (id, name)
VALUES (:'org_id'::uuid, 'MAGNISA Payroll UI Test');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (:'org_id'::uuid, :'user_id'::uuid, 'owner', 'active');

SELECT set_config('request.jwt.claim.sub', :'user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'user_id'::uuid, 'role', 'authenticated')::text,
  true
);
SELECT set_config('app.payroll_rule_activation', 'on', true);

INSERT INTO public.payroll_rule_sets (
  id, organization_id, name, effective_from, effective_to, status,
  cnaps_employee_rate, cnaps_employer_rate,
  health_employee_rate, health_employer_rate, fmfp_employer_rate,
  cnaps_monthly_ceiling, health_monthly_ceiling,
  irsa_brackets, irsa_minimum, rounding_policy, legal_reference
) VALUES
  (:'history_id'::uuid, :'org_id'::uuid, 'UI TEST historical', current_date - 10, current_date - 2, 'draft',
   0, 0.01, 0, 0.05, 0.01, 1000000, 1000000,
   '[{"up_to":50000,"rate":0},{"rate":0.1}]'::jsonb, 0, 'floor_100', 'TEST ONLY'),
  (:'current_id'::uuid, :'org_id'::uuid, 'UI TEST current', current_date - 1, null, 'draft',
   0, 0.01, 0, 0.05, 0.01, 1000000, 1000000,
   '[{"up_to":50000,"rate":0},{"rate":0.1}]'::jsonb, 0, 'floor_100', 'TEST ONLY'),
  (:'future_id'::uuid, :'org_id'::uuid, 'UI TEST future', current_date + 10, null, 'draft',
   0, 0.01, 0, 0.05, 0.01, 1000000, 1000000,
   '[{"up_to":50000,"rate":0},{"rate":0.1}]'::jsonb, 0, 'floor_100', 'TEST ONLY'),
  (:'delete_id'::uuid, :'org_id'::uuid, 'UI TEST delete draft', current_date + 50, null, 'draft',
   0, 0.01, 0, 0.05, 0.01, 1000000, 1000000,
   '[]'::jsonb, 0, 'unverified', null),
  (:'invalid_id'::uuid, :'org_id'::uuid, 'UI TEST invalid draft', current_date + 40, null, 'draft',
   0, 0.01, 0, 0.05, 0.01, 1000000, 1000000,
   '[{"up_to":50000,"rate":0},{"rate":0.1}]'::jsonb, 0, 'floor_100', null),
  (:'valid_id'::uuid, :'org_id'::uuid, 'UI TEST valid draft', current_date + 30, null, 'draft',
   0, 0.01, 0, 0.05, 0.01, 1000000, 1000000,
   '[{"up_to":50000,"rate":0},{"rate":0.1}]'::jsonb, 0, 'floor_100', 'TEST ONLY');

UPDATE public.payroll_rule_sets
   SET status = 'validated', reviewed_by = :'user_id'::uuid, reviewed_at = now()
 WHERE id IN (:'history_id'::uuid, :'current_id'::uuid, :'future_id'::uuid);

COMMIT;
