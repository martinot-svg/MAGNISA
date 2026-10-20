-- Enforce automatic assignment on every insert and protect tenant ownership.
begin;

create or replace function public.magnisa_assign_module_reference()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_org uuid;
begin
  if TG_OP = 'UPDATE' then
    if NEW.organization_id is distinct from OLD.organization_id then
      raise exception 'L''entreprise propriétaire d''une référence MAGNISA ne peut pas être modifiée';
    end if;
    if NEW.magnisa_reference is distinct from OLD.magnisa_reference then
      raise exception 'La référence MAGNISA est permanente et ne peut pas être modifiée';
    end if;
    return NEW;
  end if;

  v_org := (to_jsonb(NEW)->>'organization_id')::uuid;
  if v_org is null then
    raise exception 'organization_id is required for MAGNISA references';
  end if;

  -- Never trust a client-supplied value; every inserted row gets a DB-generated reference.
  NEW.magnisa_reference := public.magnisa_next_module_reference(v_org, TG_ARGV[0], TG_ARGV[1]);
  return NEW;
end;
$function$;
revoke all on function public.magnisa_assign_module_reference() from public, anon, authenticated;

do $migration$
declare
  item record;
begin
  for item in
    select * from (values
      ('customers','CLI','clients'),
      ('services','SRV','services'),
      ('employees','SAL','employees'),
      ('suppliers','FOU','suppliers'),
      ('prospects','PRS','prospects'),
      ('projects','PRJ','projects'),
      ('payments','PAY','payments'),
      ('expenses','DEP','expenses'),
      ('financial_accounts','CPT','financial_accounts'),
      ('financial_transactions','TRX','financial_transactions'),
      ('magnisa_internal_transfers','TRF','transfers'),
      ('supplier_invoices','DFO','supplier_invoices'),
      ('supplier_payments','PFO','supplier_payments'),
      ('loans','EMP','loans'),
      ('tax_obligations','FIS','tax_obligations'),
      ('social_obligations','SOC','social_obligations'),
      ('journal_entries','ECR','journal_entries'),
      ('partner_accounts','ASS','partner_accounts'),
      ('partner_account_movements','MVA','partner_movements'),
      ('fixed_assets','IMO','fixed_assets'),
      ('budgets','BUD','budgets'),
      ('payroll_runs','PAI','payroll_runs'),
      ('payslips','BUL','payslips'),
      ('payroll_payments','SALP','payroll_payments'),
      ('salary_advances','AVS','salary_advances'),
      ('cheques','CHQ','cheques')
    ) as t(table_name, prefix, module_key)
  loop
    if to_regclass('public.' || item.table_name) is not null
       and exists (
         select 1 from information_schema.columns
         where table_schema='public' and information_schema.columns.table_name=item.table_name
           and column_name='organization_id'
       ) then
      execute format('drop trigger if exists %I on public.%I', item.table_name || '_magnisa_reference', item.table_name);
      execute format(
        'create trigger %I before insert or update of magnisa_reference, organization_id on public.%I for each row execute function public.magnisa_assign_module_reference(%L, %L)',
        item.table_name || '_magnisa_reference', item.table_name, item.module_key, item.prefix
      );
    end if;
  end loop;
end
$migration$;

commit;
