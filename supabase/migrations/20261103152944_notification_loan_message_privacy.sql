create or replace function private.notify_loan_repayment_posted()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if new.status='posted' and (tg_op='INSERT' or old.status is distinct from 'posted') then
    insert into public.notification_events(organization_id,event_key,event_type,source_table,source_id,payload)
    values(new.organization_id,'loan-repayment-posted:'||new.id::text,'loan.repayment.posted','loan_repayments',new.id,
      jsonb_build_object('loan_id',new.loan_id,'amount',new.amount,'payment_date',new.payment_date))
    on conflict(organization_id,event_key) do nothing;
    perform private.create_org_notification(
      new.organization_id,'loan','info','Remboursement d’emprunt enregistré',
      'Un remboursement d’emprunt a été enregistré. Consulte les dossiers auxquels tu as accès.',
      '/emprunts','loan_repayment',new.id,'loan-repayment-posted:'||new.id::text,
      jsonb_build_object('event_type','loan.repayment.posted')
    );
  end if;
  return new;
end; $$;