-- Prevent anonymous execution of the expanded recurring-contract SECURITY DEFINER RPC.
-- The previous frequency expansion recreated this overload after the general RPC hardening.
begin;
revoke all on function public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer,text) from public, anon;
grant execute on function public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer,text) to authenticated;
commit;
