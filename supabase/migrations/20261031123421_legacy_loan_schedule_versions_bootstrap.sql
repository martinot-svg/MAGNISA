-- Local replay-only restoration of a pre-existing production schema object.
-- Keep this schema aligned with the read-only production catalog; never deploy it.
-- The release executor explicitly rejects this version through the replay-only manifest.
-- The production migration ledger has no create-table migration for this object,
-- but later recorded migrations depend on it. This local-only version sorts
-- after the loan foundation and is excluded from production deployment.
begin;

create table if not exists public.loan_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  loan_id uuid not null references public.loans(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  version_type text not null check (version_type in ('initial','amendment')),
  status text not null default 'active' check (status in ('active','superseded','cancelled')),
  effective_from date not null,
  effective_until date,
  amendment_reference text,
  amendment_reason text,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (loan_id, version_number),
  check (effective_until is null or effective_until >= effective_from),
  unique (id, loan_id, organization_id)
);

alter table public.loan_installments add column if not exists schedule_version_id uuid;
alter table public.loans add column if not exists active_schedule_version_id uuid;

insert into public.loan_schedule_versions
  (organization_id, loan_id, version_number, version_type, status, effective_from, approved_at)
select l.organization_id, l.id, 1, 'initial', 'active', l.start_date, l.created_at
from public.loans l
where exists (select 1 from public.loan_installments i where i.loan_id=l.id)
on conflict (loan_id,version_number) do nothing;

update public.loan_installments i
set schedule_version_id=v.id
from public.loan_schedule_versions v
where v.loan_id=i.loan_id and v.version_number=1 and i.schedule_version_id is null;

update public.loans l
set active_schedule_version_id=v.id
from public.loan_schedule_versions v
where v.loan_id=l.id and v.status='active' and l.active_schedule_version_id is null;

alter table public.loan_installments alter column schedule_version_id set not null;
do $constraints$
begin
  if not exists (select 1 from pg_constraint where conname='loan_installments_schedule_version_fk') then
    alter table public.loan_installments add constraint loan_installments_schedule_version_fk
      foreign key (schedule_version_id,loan_id,organization_id)
      references public.loan_schedule_versions(id,loan_id,organization_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='loans_active_schedule_version_fk') then
    alter table public.loans add constraint loans_active_schedule_version_fk
      foreign key (active_schedule_version_id,id,organization_id)
      references public.loan_schedule_versions(id,loan_id,organization_id) on delete restrict;
  end if;
end;
$constraints$;

create index if not exists loan_schedule_versions_loan_effective_idx
  on public.loan_schedule_versions(loan_id,effective_from desc);
create unique index if not exists loan_schedule_versions_one_active_per_loan
  on public.loan_schedule_versions(loan_id) where status='active';
create index if not exists loan_installments_schedule_version_idx
  on public.loan_installments(schedule_version_id,installment_number);

alter table public.loan_schedule_versions enable row level security;
drop policy if exists loan_schedule_versions_select on public.loan_schedule_versions;
create policy loan_schedule_versions_select on public.loan_schedule_versions
for select to authenticated using (public.has_org_permission(organization_id,'finance.view'));
drop policy if exists loan_schedule_versions_insert on public.loan_schedule_versions;
create policy loan_schedule_versions_insert on public.loan_schedule_versions
for insert to authenticated with check (public.has_org_role(organization_id,ARRAY['owner','admin','director','finance_manager','accountant']));
revoke update, delete on public.loan_schedule_versions from authenticated, anon;

create or replace function public.guard_loan_schedule_version_history()
returns trigger language plpgsql set search_path=public
as $function$
begin
  if tg_op='DELETE' then
    raise exception 'Une version d’échéancier historique ne peut pas être supprimée.';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.loan_id is distinct from old.loan_id
     or new.version_number is distinct from old.version_number
     or new.version_type is distinct from old.version_type
     or new.effective_from is distinct from old.effective_from
     or new.amendment_reference is distinct from old.amendment_reference
     or new.amendment_reason is distinct from old.amendment_reason
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'Les données contractuelles d’une version sont immuables.';
  end if;
  if new.status not in ('superseded','cancelled') or old.status <> 'active' then
    raise exception 'Seule la désactivation d’une version active est autorisée.';
  end if;
  return new;
end;
$function$;

drop trigger if exists loan_schedule_versions_no_update on public.loan_schedule_versions;
create trigger loan_schedule_versions_no_update
before update or delete on public.loan_schedule_versions
for each row execute function public.guard_loan_schedule_version_history();

commit;
