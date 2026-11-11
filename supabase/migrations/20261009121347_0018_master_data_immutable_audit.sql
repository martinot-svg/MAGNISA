
-- MAGNISA 0018: immutable database-level audit for master data and configuration.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_org uuid;
  v_entity uuid;
begin
  v_new := case when tg_op='DELETE' then null else to_jsonb(new) end;
  v_old := case when tg_op='INSERT' then null else to_jsonb(old) end;

  v_org := coalesce(
    nullif(coalesce(v_new->>'organization_id',''),'')::uuid,
    nullif(coalesce(v_old->>'organization_id',''),'')::uuid
  );

  if v_org is null then
    return coalesce(new,old);
  end if;

  v_entity := coalesce(
    nullif(coalesce(v_new->>'id',''),'')::uuid,
    nullif(coalesce(v_old->>'id',''),'')::uuid,
    nullif(coalesce(v_new->>'user_id',''),'')::uuid,
    nullif(coalesce(v_old->>'user_id',''),'')::uuid
  );

  insert into public.audit_logs(
    organization_id,actor_user_id,action,entity_type,entity_id,old_values,new_values,created_at
  )
  values(
    v_org,
    auth.uid(),
    tg_table_name||'.'||lower(tg_op),
    tg_table_name,
    v_entity,
    v_old,
    v_new,
    now()
  );

  return coalesce(new,old);
end;
$$;

revoke all on function public.audit_row_change() from public;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','prospects','services','projects','suppliers',
    'financial_accounts','loans','partner_accounts','partner_account_movements',
    'employees','payroll_runs','tax_obligations','social_obligations','budgets',
    'company_settings','organization_features','document_templates','role_permissions',
    'organization_members'
  ]
  loop
    execute format('drop trigger if exists audit_row_change_trg on public.%I',t);
    execute format(
      'create trigger audit_row_change_trg after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t
    );
  end loop;
end
$$;

revoke insert,update,delete on public.audit_logs from authenticated,anon;
