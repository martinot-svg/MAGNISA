begin;
revoke all on function public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer,text) from public, anon;
grant execute on function public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer,text) to authenticated;
commit;