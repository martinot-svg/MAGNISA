-- Ensure commercial SECURITY DEFINER RPCs cannot be invoked by anonymous clients.
revoke all on function public.cancel_order(uuid,uuid,text) from public, anon;
revoke all on function public.cancel_quote(uuid,uuid,text) from public, anon;
revoke all on function public.create_invoice_draft(uuid,uuid,date,jsonb,uuid) from public, anon;
revoke all on function public.update_invoice_line(uuid,uuid,numeric,numeric) from public, anon;
revoke all on function public.delete_invoice_line(uuid,uuid) from public, anon;

grant execute on function public.cancel_order(uuid,uuid,text) to authenticated;
grant execute on function public.cancel_quote(uuid,uuid,text) to authenticated;
grant execute on function public.create_invoice_draft(uuid,uuid,date,jsonb,uuid) to authenticated;
grant execute on function public.update_invoice_line(uuid,uuid,numeric,numeric) to authenticated;
grant execute on function public.delete_invoice_line(uuid,uuid) to authenticated;

-- This legacy RPC exists in some production histories but is not present in every clean repository reconstruction.
do $$
begin
  if to_regprocedure('public.create_invoice_draft_from_order(uuid,uuid)') is not null then
    execute 'revoke all on function public.create_invoice_draft_from_order(uuid,uuid) from public, anon';
    execute 'grant execute on function public.create_invoice_draft_from_order(uuid,uuid) to authenticated';
  end if;
end;
$$;
