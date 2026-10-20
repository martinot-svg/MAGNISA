-- Reconstruct final missing payroll activation and document appearance objects.
-- Hardened from the production body: authenticated callers only; trigger-only
-- appearance capture remains non-callable directly from client roles.
begin;

do $migration$
begin
  if not exists (select 1 from pg_constraint where conname='company_document_theme_object' and conrelid='public.company_settings'::regclass) then
    alter table public.company_settings add constraint company_document_theme_object
      check (jsonb_typeof(document_theme)='object' and pg_column_size(document_theme)<8192);
  end if;
  if not exists (select 1 from pg_constraint where conname='payroll_rule_ceiling_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_ceiling_check
      check ((cnaps_monthly_ceiling is null or cnaps_monthly_ceiling>=0)
        and (health_monthly_ceiling is null or health_monthly_ceiling>=0));
  end if;
  if not exists (select 1 from pg_constraint where conname='payroll_rule_date_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_date_check
      check (effective_to is null or effective_to>=effective_from);
  end if;
  if not exists (select 1 from pg_constraint where conname='payroll_rule_rates_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_rates_check
      check (
        cnaps_employee_rate between 0 and 1 and
        cnaps_employer_rate between 0 and 1 and
        health_employee_rate between 0 and 1 and
        health_employer_rate between 0 and 1 and
        fmfp_employer_rate between 0 and 1
      );
  end if;
end
$migration$;

-- Normalize the differently named staging constraint after verifying identical semantics.
alter table public.payroll_rule_sets drop constraint if exists payroll_rule_dates_check;

create or replace function public.activate_payroll_rule(p_org uuid,p_rule uuid)
returns void language plpgsql security definer set search_path = public
as $function$
declare v public.payroll_rule_sets%rowtype; v_role text;
begin
  perform public.assert_org_access(p_org);
  select role into v_role from public.organization_members
    where organization_id=p_org and user_id=auth.uid() and status='active';
  if v_role not in ('owner','admin') then
    raise exception 'Activation réservée à un administrateur autorisé';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_org::text),1742);
  select * into v from public.payroll_rule_sets
    where id=p_rule and organization_id=p_org for update;
  if not found then raise exception 'Paramètres introuvables'; end if;
  if v.status<>'pending_review' then
    raise exception 'Seuls les paramètres à vérifier peuvent être activés';
  end if;
  if nullif(trim(coalesce(v.legal_reference,'')),'') is null
    or v.cnaps_monthly_ceiling is null or v.health_monthly_ceiling is null
    or v.rounding_policy<>'floor_100' or jsonb_typeof(v.irsa_brackets)<>'array'
    or jsonb_array_length(v.irsa_brackets)=0 then
    raise exception 'Référentiel incomplet : références, plafonds, arrondis et barème IRSA validés obligatoires';
  end if;
  if exists (
    select 1 from public.payroll_rule_sets x
    where x.organization_id=p_org and x.id<>p_rule and x.status='validated'
      and daterange(x.effective_from,coalesce(x.effective_to,'infinity'::date),'[]')
          && daterange(v.effective_from,coalesce(v.effective_to,'infinity'::date),'[]')
  ) then raise exception 'Une règle validée couvre déjà cette période'; end if;
  update public.payroll_rule_sets
    set status='validated',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=p_rule and organization_id=p_org;
end
$function$;
revoke all on function public.activate_payroll_rule(uuid,uuid) from public,anon;
grant execute on function public.activate_payroll_rule(uuid,uuid) to authenticated;

drop trigger if exists capture_invoice_appearance on public.invoices;
create trigger capture_invoice_appearance after insert or update of status on public.invoices
for each row execute function public.capture_document_appearance('invoice','issued,partially_paid,paid');
drop trigger if exists capture_quote_appearance on public.quotes;
create trigger capture_quote_appearance after insert or update of status on public.quotes
for each row execute function public.capture_document_appearance('quote','accepted,converted');

commit;
