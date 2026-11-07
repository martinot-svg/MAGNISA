begin;
do $$
declare
  v_rls boolean;
begin
  if to_regclass('public.prospect_interventions') is null
     or to_regclass('public.prospect_intervention_history') is null then
    raise exception 'Collaborative CRM tables are missing';
  end if;
  select relrowsecurity into v_rls from pg_class where oid='public.prospect_interventions'::regclass;
  if not v_rls then raise exception 'RLS must be enabled on prospect_interventions'; end if;
  select relrowsecurity into v_rls from pg_class where oid='public.prospect_intervention_history'::regclass;
  if not v_rls then raise exception 'RLS must be enabled on prospect_intervention_history'; end if;
  if has_table_privilege('anon','public.prospect_interventions','SELECT')
     or has_table_privilege('anon','public.prospect_interventions','INSERT')
     or has_table_privilege('anon','public.prospect_intervention_history','SELECT')
     or has_table_privilege('authenticated','public.prospect_interventions','INSERT')
     or has_table_privilege('authenticated','public.prospect_interventions','UPDATE')
     or has_table_privilege('authenticated','public.prospect_intervention_history','INSERT')
     or has_table_privilege('authenticated','public.prospect_intervention_history','UPDATE') then
    raise exception 'Anonymous access must be denied for CRM contribution data';
  end if;
  if not has_function_privilege('authenticated',
    'public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('anon',
    'public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz)','EXECUTE') then
    raise exception 'Contribution RPC grants are incorrect';
  end if;
  if has_function_privilege('authenticated','public.assert_commission_contributors_validated()','EXECUTE')
     or has_function_privilege('anon','public.assert_commission_contributors_validated()','EXECUTE') then
    raise exception 'Trigger function execution must not be exposed';
  end if;
  if not exists (select 1 from pg_trigger where tgname='commission_contributors_validation_guard' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_confirmed_order' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_paid_invoice' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_created_service_contract' and not tgisinternal) then
    raise exception 'Expected CRM automation / commission guard triggers are missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='prospects' and column_name='current_owner_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='current_owner_id') then
    raise exception 'Current owner fields are missing';
  end if;
end $$;
rollback;

-- This assertion suite is run after every clean migration replay.
