-- Durable automation queue foundation. Jobs are tenant-scoped and only service_role
-- may claim or mutate execution state. User enqueue is mediated by an org-checked RPC.
begin;

create table public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id text not null check (length(btrim(rule_id)) between 1 and 200),
  event_type text not null check (event_type in (
    'quote.accepted', 'invoice.issued', 'invoice.overdue',
    'payment.received', 'stock.threshold_reached', 'recurring_contract.due'
  )),
  action_type text not null check (action_type in (
    'notification.create', 'email.send', 'task.create'
  )),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 500),
  status text not null default 'queued' check (status in (
    'queued', 'running', 'retry', 'succeeded', 'dead'
  )),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint automation_jobs_lease_consistency check (
    (status = 'running' and locked_at is not null and locked_by is not null and lease_token is not null)
    or
    (status <> 'running' and locked_at is null and locked_by is null and lease_token is null)
  ),
  unique (organization_id, idempotency_key)
);

create index automation_jobs_due_idx
  on public.automation_jobs (next_run_at, created_at, id)
  where status in ('queued', 'retry');

create index automation_jobs_expired_lease_idx
  on public.automation_jobs (locked_at, id)
  where status = 'running';

alter table public.automation_jobs enable row level security;
revoke all on public.automation_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.automation_jobs to service_role;

create or replace function public.enqueue_automation_job(
  p_org uuid,
  p_rule_id text,
  p_event_type text,
  p_action_type text,
  p_payload jsonb,
  p_idempotency_key text,
  p_max_attempts integer default 5
) returns uuid
language plpgsql
security definer
set search_path = ''
as $enqueue$
declare
  v_id uuid;
begin
  perform public.assert_org_access(p_org);

  if p_rule_id is null or length(btrim(p_rule_id)) not between 1 and 200
    or p_event_type not in (
      'quote.accepted', 'invoice.issued', 'invoice.overdue',
      'payment.received', 'stock.threshold_reached', 'recurring_contract.due'
    )
    or p_action_type not in ('notification.create', 'email.send', 'task.create')
    or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 500
    or p_max_attempts not between 1 and 20 then
    raise exception 'Automation job input invalid' using errcode = '22023';
  end if;

  insert into public.automation_jobs (
    organization_id, rule_id, event_type, action_type, payload,
    idempotency_key, max_attempts
  ) values (
    p_org, p_rule_id, p_event_type, p_action_type, p_payload,
    p_idempotency_key, coalesce(p_max_attempts, 5)
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select j.id into v_id
    from public.automation_jobs j
    where j.organization_id = p_org and j.idempotency_key = p_idempotency_key;
  end if;

  return v_id;
end;
$enqueue$;

revoke all on function public.enqueue_automation_job(uuid,text,text,text,jsonb,text,integer) from public, anon;
grant execute on function public.enqueue_automation_job(uuid,text,text,text,jsonb,text,integer) to authenticated;

create or replace function public.claim_automation_jobs(
  p_worker_id text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
) returns setof public.automation_jobs
language plpgsql
security definer
set search_path = ''
as $claim$
declare
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_worker_id is null or length(btrim(p_worker_id)) not between 1 and 120 then
    raise exception 'Automation worker access denied' using errcode = '42501';
  end if;

  -- Reclaim expired leases. A stale worker is fenced by its lease_token.
  update public.automation_jobs j
  set status = case when j.attempts >= j.max_attempts then 'dead' else 'retry' end,
      next_run_at = pg_catalog.clock_timestamp(),
      locked_at = null, locked_by = null, lease_token = null,
      last_error = coalesce(j.last_error, 'Worker lease expired'),
      updated_at = pg_catalog.clock_timestamp(),
      finished_at = case when j.attempts >= j.max_attempts then pg_catalog.clock_timestamp() else null end
  where j.status = 'running'
    and j.locked_at < pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => v_lease_seconds);

  return query
  with candidates as (
    select j.id
    from public.automation_jobs j
    where j.status in ('queued', 'retry')
      and j.next_run_at <= pg_catalog.clock_timestamp()
    order by j.next_run_at, j.created_at, j.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.automation_jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_at = pg_catalog.clock_timestamp(),
      locked_by = p_worker_id,
      lease_token = gen_random_uuid(),
      updated_at = pg_catalog.clock_timestamp(),
      finished_at = null
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$claim$;

create or replace function public.complete_automation_job(
  p_job_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $complete$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Automation worker access denied' using errcode = '42501';
  end if;

  update public.automation_jobs
  set status = 'succeeded', locked_at = null, locked_by = null, lease_token = null,
      last_error = null, updated_at = pg_catalog.clock_timestamp(),
      finished_at = pg_catalog.clock_timestamp()
  where id = p_job_id and status = 'running' and lease_token = p_lease_token;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$complete$;

create or replace function public.fail_automation_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text
) returns text
language plpgsql
security definer
set search_path = ''
as $fail$
declare
  v_job public.automation_jobs%rowtype;
  v_status text;
  v_delay integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Automation worker access denied' using errcode = '42501';
  end if;

  select * into v_job from public.automation_jobs
  where id = p_job_id and status = 'running' and lease_token = p_lease_token
  for update;
  if not found then
    return 'lease_lost';
  end if;

  v_status := case when v_job.attempts >= v_job.max_attempts then 'dead' else 'retry' end;
  v_delay := least(3600, 30 * (2 ^ greatest(v_job.attempts - 1, 0)));

  update public.automation_jobs
  set status = v_status,
      next_run_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => v_delay),
      locked_at = null, locked_by = null, lease_token = null,
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'Automation execution failed'), 2000),
      updated_at = pg_catalog.clock_timestamp(),
      finished_at = case when v_status = 'dead' then pg_catalog.clock_timestamp() else null end
  where id = v_job.id;

  return v_status;
end;
$fail$;

revoke all on function public.claim_automation_jobs(text,integer,integer) from public, anon, authenticated;
revoke all on function public.complete_automation_job(uuid,uuid) from public, anon, authenticated;
revoke all on function public.fail_automation_job(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_automation_jobs(text,integer,integer) to service_role;
grant execute on function public.complete_automation_job(uuid,uuid) to service_role;
grant execute on function public.fail_automation_job(uuid,uuid,text) to service_role;

commit;
