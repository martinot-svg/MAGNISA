do $$
declare v_sql text;
begin
  select pg_get_functiondef(p.oid) into v_sql from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_loan_repayment';
  if v_sql is null then raise exception 'record_loan_repayment introuvable'; end if;

  if position('schedule_version_id=v_loan.active_schedule_version_id' in v_sql)=0 then
    v_sql := replace(v_sql,
      E'if p_payment_date < v_loan.start_date then raise exception ''La date de paiement précède la date de départ du contrat''; end if;',
      E'if v_loan.active_schedule_version_id is null then raise exception ''Aucun échéancier actif n''''est associé à cet emprunt''; end if;\n  if p_payment_date < v_loan.start_date then raise exception ''La date de paiement précède la date de départ du contrat''; end if;\n  if not exists (select 1 from public.loan_schedule_versions v where v.id=v_loan.active_schedule_version_id and v.loan_id=p_loan_id and v.organization_id=p_organization_id and v.status=''active'') then raise exception ''La version active de l''''échéancier est invalide''; end if;');
    v_sql := replace(v_sql,
      E'and organization_id = p_organization_id\n    for update;',
      E'and organization_id = p_organization_id\n      and schedule_version_id = v_loan.active_schedule_version_id\n    for update;');
    v_sql := replace(v_sql,
      E'where earlier.loan_id = p_loan_id and earlier.organization_id = p_organization_id\n        and earlier.installment_number < v_installment.installment_number',
      E'where earlier.loan_id = p_loan_id and earlier.organization_id = p_organization_id\n        and earlier.schedule_version_id = v_loan.active_schedule_version_id\n        and earlier.installment_number < v_installment.installment_number');
    v_sql := replace(v_sql,
      E'where loan_id = p_loan_id and organization_id = p_organization_id\n        and (status in (''overdue'',''partial'') or (due_date <= p_payment_date and status = ''planned''))',
      E'where loan_id = p_loan_id and organization_id = p_organization_id\n        and schedule_version_id = v_loan.active_schedule_version_id\n        and (status in (''overdue'',''partial'') or (due_date <= p_payment_date and status = ''planned''))');
    v_sql := replace(v_sql,
      E'where loan_id = p_loan_id and organization_id = p_organization_id\n      and status = ''planned'' and due_date > p_payment_date',
      E'where loan_id = p_loan_id and organization_id = p_organization_id\n      and schedule_version_id = v_loan.active_schedule_version_id\n      and status = ''planned'' and due_date > p_payment_date');
    v_sql := replace(v_sql,
      E'where id = p_installment_id and organization_id = p_organization_id\n    on conflict do nothing;',
      E'where id = p_installment_id and organization_id = p_organization_id\n      and schedule_version_id = v_loan.active_schedule_version_id\n    on conflict do nothing;');
    v_sql := replace(v_sql,
      E'where id = p_installment_id and organization_id = p_organization_id;\n  else',
      E'where id = p_installment_id and organization_id = p_organization_id\n      and schedule_version_id = v_loan.active_schedule_version_id;\n  else');
    v_sql := replace(v_sql,
      E'where id=v_row.id and organization_id=p_organization_id;',
      E'where id=v_row.id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id;');
    v_sql := replace(v_sql,
      E'where i.loan_id=p_loan_id and i.organization_id=p_organization_id and i.status in (''planned'',''partial'',''overdue'')',
      E'where i.loan_id=p_loan_id and i.organization_id=p_organization_id and i.schedule_version_id=v_loan.active_schedule_version_id and i.status in (''planned'',''partial'',''overdue'')');
    execute v_sql;
  end if;

  revoke all on function public.record_loan_repayment(uuid,uuid,uuid,date,numeric,uuid,uuid,text,text) from public, anon;
  grant execute on function public.record_loan_repayment(uuid,uuid,uuid,date,numeric,uuid,uuid,text,text) to authenticated;
end $$;