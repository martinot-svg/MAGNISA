alter table public.financial_accounts
 add column if not exists mvola_account_category text;
alter table public.financial_accounts
 add constraint financial_accounts_mvola_category_check
 check (
  mvola_account_category is null
  or (type='mobile_money' and mvola_account_category in ('personal','business','merchant'))
 );
create or replace function public.create_mvola_financial_account(
 p_org uuid,p_name text,p_category text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 perform public.assert_org_access(p_org);
 perform public.assert_org_permission(p_org,'treasury.transfer');
 if p_category is null or p_category not in ('personal','business','merchant') then
  raise exception 'Categorie MVola invalide';
 end if;
 v_id:=public.lot1_create_financial_account(p_org,p_name,'mobile_money');
 update public.financial_accounts set mvola_account_category=p_category
 where id=v_id and organization_id=p_org;
 perform public.audit_event(p_org,'financial_account.mvola_category_set','financial_account',v_id,null,jsonb_build_object('category',p_category));
 return v_id;
end $$;
revoke all on function public.create_mvola_financial_account(uuid,text,text) from public,anon;
grant execute on function public.create_mvola_financial_account(uuid,text,text) to authenticated;