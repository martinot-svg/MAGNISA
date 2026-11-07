begin;
do $$
declare
  v_rls boolean;
  v_definition text;
begin
  if to_regclass('public.prospect_interventions') is null
     or to_regclass('public.prospect_intervention_history') is null
     or to_regclass('public.prospect_intervention_type_settings') is null then
    raise exception 'Collaborative CRM tables are missing';
  end if;

  select relrowsecurity into v_rls from pg_class where oid='public.prospect_interventions'::regclass;
  if not v_rls then raise exception 'RLS must be enabled on prospect_interventions'; end if;
  select relrowsecurity into v_rls from pg_class where oid='public.prospect_intervention_history'::regclass;
  if not v_rls then raise exception 'RLS must be enabled on prospect_intervention_history'; end if;
  select relrowsecurity into v_rls from pg_class where oid='public.prospect_intervention_type_settings'::regclass;
  if not v_rls then raise exception 'RLS must be enabled on intervention type settings'; end if;

  if has_table_privilege('anon','public.prospect_interventions','SELECT')
     or has_table_privilege('anon','public.prospect_interventions','INSERT')
     or has_table_privilege('anon','public.prospect_intervention_history','SELECT')
     or has_table_privilege('anon','public.prospect_intervention_type_settings','SELECT')
     or has_table_privilege('authenticated','public.prospect_interventions','INSERT')
     or has_table_privilege('authenticated','public.prospect_interventions','UPDATE')
     or has_table_privilege('authenticated','public.prospect_intervention_history','INSERT')
     or has_table_privilege('authenticated','public.prospect_intervention_history','UPDATE')
     or has_table_privilege('authenticated','public.prospect_intervention_type_settings','INSERT')
     or has_table_privilege('authenticated','public.prospect_intervention_type_settings','UPDATE') then
    raise exception 'CRM tables must remain read-only to authenticated clients and unavailable to anon';
  end if;

  if not has_function_privilege('authenticated',
    'public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or has_function_privilege('anon',
    'public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz)','EXECUTE')
     or not has_function_privilege('authenticated',
    'public.create_prospect_with_referrer(uuid,text,text,text,text,text,uuid,text)','EXECUTE')
     or has_function_privilege('anon',
    'public.create_prospect_with_referrer(uuid,text,text,text,text,text,uuid,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.list_collaboration_members(uuid)','EXECUTE')
     or has_function_privilege('anon','public.list_collaboration_members(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.list_prospect_intervention_types(uuid)','EXECUTE')
     or has_function_privilege('anon','public.list_prospect_intervention_types(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.save_prospect_intervention_types(uuid,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.save_prospect_intervention_types(uuid,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.change_prospect_intervention_status(uuid,uuid,text,text)','EXECUTE')
     or has_function_privilege('anon','public.change_prospect_intervention_status(uuid,uuid,text,text)','EXECUTE') then
    raise exception 'Collaborative CRM RPC grants are incorrect';
  end if;

  if has_function_privilege('authenticated','public.assert_commission_contributors_validated()','EXECUTE')
     or has_function_privilege('anon','public.assert_commission_contributors_validated()','EXECUTE') then
    raise exception 'Trigger function execution must not be exposed';
  end if;

  select pg_get_functiondef('public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz)'::regprocedure)
    into v_definition;
  if position('p_contributor is distinct from auth.uid()' in v_definition)=0
     or position('v_requires_evidence' in v_definition)=0
     or position('p_stage_status=''transferred''' in v_definition)=0 then
    raise exception 'Contribution identity, evidence and transfer guards are missing';
  end if;
  select pg_get_functiondef('public.review_prospect_intervention(uuid,uuid,text,text)'::regprocedure)
    into v_definition;
  if position('v_row.created_by=auth.uid()' in v_definition)=0
     or position('v_row.contributor_user_id=auth.uid()' in v_definition)=0 then
    raise exception 'Independent review guard is missing';
  end if;
  select pg_get_functiondef('public.change_prospect_intervention_status(uuid,uuid,text,text)'::regprocedure)
    into v_definition;
  if position('status_changed' in v_definition)=0 or position('validation_status' in v_definition)=0 then
    raise exception 'Audited stage transition RPC is missing';
  end if;
  select pg_get_functiondef('public.assert_commission_contributors_validated()'::regprocedure)
    into v_definition;
  if position('stage_status=''completed''' in v_definition)=0 then
    raise exception 'Commission guard must require a completed contribution';
  end if;

  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='prospect_interventions_automatic_evidence_unique') then
    raise exception 'Automatic CRM event idempotency index is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname='commission_contributors_validation_guard' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_confirmed_order' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_paid_invoice' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_confirmed_payment_insert' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_confirmed_payment_update' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_confirmed_order_insert' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_paid_invoice_insert' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='crm_capture_created_service_contract' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname='seed_prospect_intervention_type_settings' and not tgisinternal) then
    raise exception 'Expected CRM automation / commission guard triggers are missing';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='prospects' and column_name='current_owner_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='current_owner_id') then
    raise exception 'Current owner fields are missing';
  end if;
end $$;
rollback;

-- This assertion suite is run after every clean migration replay.
