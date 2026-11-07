-- Versioned IRSA compensation rules and immutable per-payslip fiscal evidence.
alter table public.payroll_rule_sets
  add column if not exists irsa_compensation_rules jsonb not null default '[]'::jsonb;
alter table public.payroll_rule_sets
  drop constraint if exists payroll_rule_compensation_rules_array;
alter table public.payroll_rule_sets
  add constraint payroll_rule_compensation_rules_array
  check (jsonb_typeof(irsa_compensation_rules) = 'array');

alter table public.payslips
  add column if not exists fiscal_snapshot jsonb,
  add column if not exists overtime_details jsonb;

create or replace function public.write_payslip_fiscal_snapshot(
  p_org uuid, p_payslip uuid, p_snapshot jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Snapshot fiscal invalide';
  end if;
  if not public.has_org_permission(p_org, 'payroll.manage') then
    raise exception 'Permission paie insuffisante';
  end if;
  update public.payslips
     set fiscal_snapshot = p_snapshot,
         overtime_details = coalesce(p_snapshot->'overtime', '{}'::jsonb)
   where organization_id = p_org
     and id = p_payslip
     and status = 'calculated'
     and fiscal_snapshot is null;
  if not found then
    raise exception 'Bulletin absent, déjà historisé ou non modifiable';
  end if;
end;
$$;

create or replace function public.prevent_payslip_fiscal_snapshot_change()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.fiscal_snapshot is not null
     and new.fiscal_snapshot is distinct from old.fiscal_snapshot then
    raise exception 'Le snapshot fiscal d’un bulletin est immuable';
  end if;
  if old.overtime_details is not null
     and new.overtime_details is distinct from old.overtime_details then
    raise exception 'Le détail des heures supplémentaires est immuable';
  end if;
  return new;
end;
$$;

drop trigger if exists payslip_fiscal_snapshot_immutable on public.payslips;
create trigger payslip_fiscal_snapshot_immutable
before update on public.payslips
for each row execute function public.prevent_payslip_fiscal_snapshot_change();

revoke all on function public.write_payslip_fiscal_snapshot(uuid,uuid,jsonb) from public, anon;
grant execute on function public.write_payslip_fiscal_snapshot(uuid,uuid,jsonb) to authenticated, service_role;
