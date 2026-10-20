-- Global, immutable MAGNISA references for master data, operations and accounting.
-- Existing legal/document references are preserved; this adds a separate internal identifier.
begin;

create table if not exists public.magnisa_reference_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null,
  next_value bigint not null default 1 check (next_value > 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, module_key)
);
alter table public.magnisa_reference_sequences enable row level security;
revoke all on public.magnisa_reference_sequences from public, anon, authenticated;

create or replace function public.magnisa_next_module_reference(p_org uuid, p_module text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_value bigint;
begin
  if p_org is null or p_module is null or p_prefix is null
     or p_module !~ '^[a-z][a-z0-9_]{1,40}$'
     or p_prefix !~ '^[A-Z]{2,5}$' then
    raise exception 'Invalid reference sequence configuration';
  end if;

  insert into public.magnisa_reference_sequences(organization_id, module_key, next_value)
  values (p_org, p_module, 2)
  on conflict (organization_id, module_key) do update
    set next_value = public.magnisa_reference_sequences.next_value + 1,
        updated_at = now()
  returning next_value - 1 into v_value;

  return p_prefix || '-' || lpad(v_value::text, greatest(5, length(v_value::text)), '0');
end;
$function$;
revoke all on function public.magnisa_next_module_reference(uuid, text, text) from public, anon, authenticated;

create or replace function public.magnisa_assign_module_reference()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_org uuid;
  v_current text;
begin
  v_org := (to_jsonb(NEW)->>'organization_id')::uuid;
  v_current := nullif(btrim(to_jsonb(NEW)->>'magnisa_reference'), '');

  if TG_OP = 'UPDATE'
     and coalesce(NEW.magnisa_reference, '') <> coalesce(OLD.magnisa_reference, '') then
    raise exception 'La référence MAGNISA est permanente et ne peut pas être modifiée';
  end if;

  if v_org is null then
    raise exception 'organization_id is required for MAGNISA references';
  end if;

  if v_current is null then
    NEW.magnisa_reference := public.magnisa_next_module_reference(v_org, TG_ARGV[0], TG_ARGV[1]);
  end if;

  return NEW;
end;
$function$;

-- The canonical internal reference is distinct from any external reference,
-- supplier invoice number, bank transaction id, or legally numbered document.
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
      execute format('alter table public.%I add column if not exists magnisa_reference text', item.table_name);
      execute format('drop trigger if exists %I on public.%I', item.table_name || '_magnisa_reference', item.table_name);
      execute format(
        'create trigger %I before insert or update of magnisa_reference on public.%I for each row execute function public.magnisa_assign_module_reference(%L, %L)',
        item.table_name || '_magnisa_reference', item.table_name, item.module_key, item.prefix
      );
      execute format(
        'create unique index if not exists %I on public.%I (organization_id, magnisa_reference) where magnisa_reference is not null',
        item.table_name || '_magnisa_reference_unique', item.table_name
      );
      execute format('update public.%I set magnisa_reference = null where magnisa_reference is null', item.table_name);
    end if;
  end loop;
end
$migration$;

comment on column public.customers.magnisa_reference is 'Permanent internal MAGNISA identifier; generated automatically and never reused.';
comment on column public.services.magnisa_reference is 'Permanent internal MAGNISA identifier; distinct from any user-defined service reference.';
comment on column public.employees.magnisa_reference is 'Permanent internal MAGNISA identifier; distinct from statutory/social identifiers.';
comment on column public.payments.magnisa_reference is 'Permanent internal MAGNISA identifier; distinct from receipt and external payment references.';
comment on column public.financial_transactions.magnisa_reference is 'Permanent internal MAGNISA identifier for a single ledger movement.';

commit;
