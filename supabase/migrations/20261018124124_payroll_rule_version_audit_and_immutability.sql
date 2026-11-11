create table if not exists public.payroll_rule_change_log (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 rule_id uuid not null,
 action text not null,
 actor_id uuid,
 changed_at timestamptz not null default now(),
 old_values jsonb,
 new_values jsonb
);
create index if not exists payroll_rule_change_log_org_date_idx on public.payroll_rule_change_log(organization_id,changed_at desc);
alter table public.payroll_rule_change_log enable row level security;
drop policy if exists payroll_rule_change_log_read on public.payroll_rule_change_log;
create policy payroll_rule_change_log_read on public.payroll_rule_change_log for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id=payroll_rule_change_log.organization_id and m.user_id=auth.uid() and m.status='active'));
create or replace function public.audit_payroll_rule_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then
   insert into public.payroll_rule_change_log(organization_id,rule_id,action,actor_id,new_values)
   values(new.organization_id,new.id,'created',auth.uid(),to_jsonb(new));
   return new;
 elsif tg_op='UPDATE' then
   if old.status in ('validated','archived') and (
     old.cnaps_employee_rate is distinct from new.cnaps_employee_rate or
     old.cnaps_employer_rate is distinct from new.cnaps_employer_rate or
     old.health_employee_rate is distinct from new.health_employee_rate or
     old.health_employer_rate is distinct from new.health_employer_rate or
     old.fmfp_employer_rate is distinct from new.fmfp_employer_rate or
     old.cnaps_monthly_ceiling is distinct from new.cnaps_monthly_ceiling or
     old.health_monthly_ceiling is distinct from new.health_monthly_ceiling or
     old.irsa_brackets is distinct from new.irsa_brackets or
     old.irsa_minimum is distinct from new.irsa_minimum or
     old.rounding_policy is distinct from new.rounding_policy or
     old.effective_from is distinct from new.effective_from)
   then raise exception 'Règle de paie validée immuable : créer une nouvelle version'; end if;
   insert into public.payroll_rule_change_log(organization_id,rule_id,action,actor_id,old_values,new_values)
   values(new.organization_id,new.id,'updated',auth.uid(),to_jsonb(old),to_jsonb(new));
   return new;
 elsif tg_op='DELETE' then
   if old.status in ('validated','archived') then raise exception 'Suppression interdite pour une version validée ou archivée'; end if;
   insert into public.payroll_rule_change_log(organization_id,rule_id,action,actor_id,old_values)
   values(old.organization_id,old.id,'deleted',auth.uid(),to_jsonb(old));
   return old;
 end if;
 return null;
end $$;
drop trigger if exists payroll_rule_change_audit on public.payroll_rule_sets;
create trigger payroll_rule_change_audit before insert or update or delete on public.payroll_rule_sets for each row execute function public.audit_payroll_rule_change();