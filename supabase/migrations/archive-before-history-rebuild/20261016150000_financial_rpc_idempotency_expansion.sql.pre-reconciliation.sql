-- TEST ONLY. Completes idempotency for supplier/payroll operations and closes bypass RPCs.
create or replace function public.lot2_record_supplier_payment_idempotent(p_org uuid, p_supplier_invoice uuid, p_account uuid, p_amount numeric, p_method text, p_date date, p_reference text, p_request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare v_digest text; v_old public.lot1_financial_idempotency%rowtype; v_id uuid;
begin
 perform public.assert_org_access(p_org);
 perform public.assert_org_permission(p_org,'suppliers.manage');
 if p_request_key is null then raise exception 'Cle de requete obligatoire'; end if;
 v_digest:=md5(jsonb_build_array(p_org,p_supplier_invoice,p_account,p_amount,p_method,p_date,p_reference)::text);
 insert into public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest) values(p_org,p_request_key,'supplier_payment',v_digest) on conflict do nothing;
 select * into strict v_old from public.lot1_financial_idempotency where organization_id=p_org and request_key=p_request_key for update;
 if v_old.operation_type<>'supplier_payment' or v_old.request_digest<>v_digest then raise exception 'Cle de requete deja utilisee pour une autre operation'; end if;
 if v_old.result_id is not null then return v_old.result_id; end if;
 v_id:=public.record_supplier_payment(p_org,p_supplier_invoice,p_account,p_amount,p_method,p_date,p_reference);
 update public.lot1_financial_idempotency set result_id=v_id where organization_id=p_org and request_key=p_request_key;
 return v_id;
end;
$$;
grant execute on function public.lot2_record_supplier_payment_idempotent(uuid,uuid,uuid,numeric,text,date,text,uuid) to authenticated;
create or replace function public.lot2_record_payroll_payment_idempotent(p_org uuid, p_payslip uuid, p_account uuid, p_amount numeric, p_method text, p_date date, p_reference text, p_request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare v_digest text; v_old public.lot1_financial_idempotency%rowtype; v_id uuid;
begin
 perform public.assert_org_access(p_org);
 perform public.assert_org_permission(p_org,'payroll.pay');
 if p_request_key is null then raise exception 'Cle de requete obligatoire'; end if;
 v_digest:=md5(jsonb_build_array(p_org,p_payslip,p_account,p_amount,p_method,p_date,p_reference)::text);
 insert into public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest) values(p_org,p_request_key,'payroll_payment',v_digest) on conflict do nothing;
 select * into strict v_old from public.lot1_financial_idempotency where organization_id=p_org and request_key=p_request_key for update;
 if v_old.operation_type<>'payroll_payment' or v_old.request_digest<>v_digest then raise exception 'Cle de requete deja utilisee pour une autre operation'; end if;
 if v_old.result_id is not null then return v_old.result_id; end if;
 v_id:=public.record_payroll_payment(p_org,p_payslip,p_account,p_amount,p_method,p_date,p_reference);
 update public.lot1_financial_idempotency set result_id=v_id where organization_id=p_org and request_key=p_request_key;
 return v_id;
end;
$$;
grant execute on function public.lot2_record_payroll_payment_idempotent(uuid,uuid,uuid,numeric,text,date,text,uuid) to authenticated;

revoke execute on function public.record_invoice_payment(uuid,uuid,uuid,numeric,date,text,text) from public,anon,authenticated;
revoke execute on function public.record_expense(uuid,text,numeric,date,uuid,text) from public,anon,authenticated;
revoke execute on function public.transfer_funds(uuid,uuid,uuid,numeric,date,text) from public,anon,authenticated;
revoke execute on function public.record_supplier_payment(uuid,uuid,uuid,numeric,text,date,text) from public,anon,authenticated;
revoke execute on function public.record_payroll_payment(uuid,uuid,uuid,numeric,text,date,text) from public,anon,authenticated;
