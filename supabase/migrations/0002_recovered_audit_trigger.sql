-- Trigger-only audit helper required before the historical security hardening migration.
-- Later audit migrations replace this implementation where appropriate.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    perform public.audit_event(old.organization_id,'row.delete',tg_table_name,old.id,to_jsonb(old),null);
    return old;
  elsif tg_op='UPDATE' then
    perform public.audit_event(new.organization_id,'row.update',tg_table_name,new.id,to_jsonb(old),to_jsonb(new));
    return new;
  else
    perform public.audit_event(new.organization_id,'row.insert',tg_table_name,new.id,null,to_jsonb(new));
    return new;
  end if;
end;
$$;
revoke execute on function public.audit_row_change() from public,anon,authenticated;
grant execute on function public.audit_row_change() to service_role;
