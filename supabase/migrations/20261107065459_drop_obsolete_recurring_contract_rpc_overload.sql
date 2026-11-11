-- Remove the obsolete seven-argument overload. The eight-argument
-- version has a default for billing_timing; keeping both creates ambiguous RPC resolution.
begin;
drop function if exists public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer);
commit;