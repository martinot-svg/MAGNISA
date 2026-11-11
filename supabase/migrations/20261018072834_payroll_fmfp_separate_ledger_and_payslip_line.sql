alter table public.payslips add column if not exists employer_fmfp numeric(18,2) not null default 0;
alter table public.payslips add constraint payslip_fmfp_nonnegative check (employer_fmfp>=0);
create or replace function public.payroll_compute_fmfp_on_insert() returns trigger language plpgsql security definer set search_path=public as $$
declare v_rate numeric;v_ceiling numeric;v_count integer;v_end date;
begin
 select period_end into v_end from public.payroll_runs where id=new.payroll_run_id and organization_id=new.organization_id;
 if v_end is null then raise exception 'Période de paie introuvable';end if;
 select count(*), max(fmfp_employer_rate), max(cnaps_monthly_ceiling) into v_count,v_rate,v_ceiling
 from public.payroll_rule_sets where organization_id=new.organization_id and status='validated'
 and effective_from<=v_end and (effective_to is null or effective_to>=v_end);
 if v_count<>1 or v_ceiling is null then raise exception 'Aucun référentiel réglementaire unique complet pour FMFP';end if;
 new.employer_fmfp:=round(least(new.gross_pay,v_ceiling)*v_rate,2);
 return new;
end $$;
drop trigger if exists trg_payroll_compute_fmfp_on_insert on public.payslips;
create trigger trg_payroll_compute_fmfp_on_insert before insert on public.payslips for each row execute function public.payroll_compute_fmfp_on_insert();
do $$
declare v_def text;
begin
 select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='validate_payslip' limit 1;
 if v_def is null or position('coalesce(ps.employer_health,0)' in v_def)=0 or position('if ps.net_pay > 0 then' in v_def)=0 then raise exception 'Unexpected validate_payslip definition';end if;
 v_def:=replace(v_def,'coalesce(ps.employer_social,0)+coalesce(ps.employer_health,0)','coalesce(ps.employer_social,0)+coalesce(ps.employer_health,0)+coalesce(ps.employer_fmfp,0)');
 v_def:=replace(v_def,'if ps.net_pay > 0 then', $insert$
  if ps.employer_fmfp > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values(p_org,v_entry,'FMFP_PAYABLE','FMFP à payer',0,ps.employer_fmfp);
  end if;
  if ps.net_pay > 0 then$insert$);
 v_def:=replace(v_def,'v_employer_contrib,0);', 'v_employer_contrib-ps.employer_fmfp,0);');
 if position('v_employer_contrib-ps.employer_fmfp' in v_def)=0 then raise exception 'FMFP separation replacement failed';end if;
 v_def:=replace(v_def,'''PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS'',''Charges patronales'',v_employer_contrib-ps.employer_fmfp,0', '''PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS'',''Charges patronales'',v_employer_contrib-ps.employer_fmfp,0');
 execute v_def;
 select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_payslip' limit 1;
 if v_def is null or position('sum(employer_social+employer_health)' in v_def)=0 then raise exception 'Unexpected create_payslip definition';end if;
 v_def:=replace(v_def,'sum(employer_social+employer_health)','sum(employer_social+employer_health+employer_fmfp)');
 execute v_def;
end $$;