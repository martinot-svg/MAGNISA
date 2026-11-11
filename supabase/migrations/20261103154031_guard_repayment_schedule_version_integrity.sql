create or replace function public.guard_loan_installment_active_version() returns trigger language plpgsql security definer set search_path=public as $$ declare v_active uuid; begin select active_schedule_version_id into v_active from public.loans where id=new.loan_id and organization_id=new.organization_id; if v_active is not null and new.schedule_version_id is distinct from v_active then raise exception 'Une échéance d''une version historique ne peut pas être modifiée par le moteur de remboursement'; end if; return new; end; $$;
drop trigger if exists loan_installments_active_version_guard on public.loan_installments;
create trigger loan_installments_active_version_guard before update on public.loan_installments for each row execute function public.guard_loan_installment_active_version();
revoke all on function public.guard_loan_installment_active_version() from public, anon, authenticated;

drop function if exists public.create_loan_schedule_amendment(uuid,uuid,date,text,text,jsonb);
create or replace function public.create_loan_schedule_amendment(p_organization_id uuid,p_loan_id uuid,p_effective_from date,p_amendment_reference text,p_amendment_reason text,p_installments jsonb) returns uuid language plpgsql security definer set search_path=public as $function$
declare v_loan public.loans%rowtype; v_current public.loan_schedule_versions%rowtype; v_version int; v_id uuid; v jsonb; v_open numeric; v_principal numeric; v_interest numeric; v_fees numeric; v_penalty numeric; v_close numeric; v_running numeric;
begin
 perform public.assert_org_access(p_organization_id); perform public.assert_org_permission(p_organization_id,'finance.view');
 select * into v_loan from public.loans where id=p_loan_id and organization_id=p_organization_id for update;
 if not found or v_loan.status<>'active' then raise exception 'Emprunt introuvable ou non actif'; end if;
 if p_effective_from is null or p_effective_from<=v_loan.start_date then raise exception 'Date d''effet invalide'; end if;
 if nullif(btrim(p_amendment_reference),'') is null or nullif(btrim(p_amendment_reason),'') is null then raise exception 'Référence et motif de l''avenant obligatoires'; end if;
 if jsonb_typeof(p_installments)<>'array' or jsonb_array_length(p_installments)<1 then raise exception 'Nouvel échéancier invalide'; end if;
 select * into v_current from public.loan_schedule_versions where id=v_loan.active_schedule_version_id and loan_id=p_loan_id and organization_id=p_organization_id and status='active' for update;
 if not found then raise exception 'Version active introuvable'; end if;
 if exists (select 1 from public.loan_repayments r join public.loan_installments i on i.id=r.installment_id and i.organization_id=r.organization_id where r.loan_id=p_loan_id and r.organization_id=p_organization_id and r.status='posted' and r.payment_date>=p_effective_from and i.schedule_version_id=v_current.id) then raise exception 'Des remboursements existent déjà à partir de la date d''effet'; end if;
 select coalesce(max(version_number),0)+1 into v_version from public.loan_schedule_versions where loan_id=p_loan_id and organization_id=p_organization_id;
 update public.loan_schedule_versions set status='superseded', effective_until=p_effective_from-1 where id=v_current.id;
 insert into public.loan_schedule_versions(organization_id,loan_id,version_number,version_type,status,effective_from,amendment_reference,amendment_reason,approved_at,approved_by,created_by) values(p_organization_id,p_loan_id,v_version,'amendment','active',p_effective_from,btrim(p_amendment_reference),btrim(p_amendment_reason),now(),auth.uid(),auth.uid()) returning id into v_id;
 for v in select value from jsonb_array_elements(p_installments) order by (value->>'installment_number')::int loop
  v_open:=round((v->>'opening_principal')::numeric,2); v_principal:=round((v->>'principal_due')::numeric,2); v_interest:=round((v->>'interest_due')::numeric,2); v_fees:=round(coalesce((v->>'fees_due')::numeric,0),2); v_penalty:=round(coalesce((v->>'penalty_due')::numeric,0),2); v_close:=round(v_open-v_principal,2);
  if (v->>'due_date')::date<p_effective_from or v_open<0 or v_principal<0 or v_interest<0 or v_fees<0 or v_penalty<0 or v_close<0 then raise exception 'Échéance d''avenant invalide'; end if;
  insert into public.loan_installments(organization_id,loan_id,installment_number,due_date,opening_principal,principal_due,interest_due,fees_due,penalty_due,total_due,closing_principal,status,schedule_version_id) values(p_organization_id,p_loan_id,(v->>'installment_number')::int,(v->>'due_date')::date,v_open,v_principal,v_interest,v_fees,v_penalty,v_principal+v_interest+v_fees+v_penalty,v_close,'planned',v_id);
 end loop;
 select closing_principal into v_running from public.loan_installments where schedule_version_id=v_id order by installment_number desc limit 1;
 if v_running<>0 then raise exception 'Le nouvel échéancier ne solde pas le capital'; end if;
 update public.loans set active_schedule_version_id=v_id,updated_at=now() where id=p_loan_id and organization_id=p_organization_id;
 perform public.audit_event(p_organization_id,'loan.schedule_amendment_created','loan_schedule_version',v_id,null,jsonb_build_object('loan_id',p_loan_id,'version_number',v_version,'effective_from',p_effective_from,'amendment_reference',p_amendment_reference));
 return v_id;
end;$function$;
revoke all on function public.create_loan_schedule_amendment(uuid,uuid,date,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_loan_schedule_amendment(uuid,uuid,date,text,text,jsonb) to authenticated;