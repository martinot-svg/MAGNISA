-- Run recurring draft generation hourly without requiring a user to open the invoice module.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres;

create or replace function private.process_due_recurring_invoice_drafts(p_org uuid, p_actor uuid)
returns integer
language plpgsql security definer set search_path=public,private as $$
declare
  c public.recurring_service_contracts%rowtype;
  v_period_start date;
  v_period_end date;
  v_next_date date;
  v_interval interval;
  v_invoice uuid;
  v_number text;
  v_gross numeric;
  v_tax numeric;
  v_total numeric;
  v_due_days integer;
  v_created integer := 0;
  v_desc text;
begin
  select coalesce(max(default_payment_days),30) into v_due_days
    from public.company_settings where organization_id=p_org;
  v_due_days := coalesce(v_due_days,30);
  for c in
    select * from public.recurring_service_contracts
    where organization_id=p_org and status='active' and next_billing_date <= current_date
      and (end_date is null or next_billing_date <= end_date)
    order by next_billing_date, created_at
    for update skip locked
  loop
    v_interval := case c.frequency
      when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'semiannual' then interval '6 months'
      when 'annual' then interval '1 year'
    end;
    v_period_start := c.next_billing_date;
    while v_period_start <= current_date and (c.end_date is null or v_period_start <= c.end_date) loop
      v_period_end := (date_trunc('month', v_period_start::timestamp + v_interval) + (c.billing_day - 1) * interval '1 day')::date - 1;
      -- Keep the service period aligned to the configured billing cycle and never beyond the contract end date.
      v_period_end := least(v_period_end, (v_period_start::timestamp + v_interval)::date - 1);
      if c.end_date is not null then v_period_end := least(v_period_end, c.end_date); end if;
      if not exists(select 1 from public.invoices i
        where i.organization_id=p_org and i.recurring_contract_id=c.id
          and i.service_period_start=v_period_start) then
        v_gross := round(c.quantity*c.unit_price,2);
        v_tax := round(v_gross*c.tax_rate/100,2);
        v_total := v_gross+v_tax;
        v_number := public.next_document_number(p_org,'invoice');
        v_desc := c.description || ' - période du ' || to_char(v_period_start,'DD/MM/YYYY')
          || ' au ' || to_char(v_period_end,'DD/MM/YYYY');
        insert into public.invoices(
          organization_id,customer_id,order_id,recurring_contract_id,service_period_start,service_period_end,
          number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,notes,created_by
        ) values (
          p_org,c.customer_id,c.order_id,c.id,v_period_start,v_period_end,
          v_number,'draft',current_date,greatest(current_date,v_period_start+v_due_days),
          v_gross,0,v_tax,v_total,0,v_total,
          'Facture récurrente préparée en brouillon. Vérifier la période et les prestations avant émission.',p_actor
        ) returning id into v_invoice;
        insert into public.invoice_lines(
          organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,
          discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order
        ) values (
          p_org,v_invoice,c.service_id,v_desc,c.quantity,c.unit,c.unit_price,0,0,
          v_gross,c.tax_rate,v_tax,v_total,1
        );
        perform public.audit_event(p_org,'invoice.recurring_draft_created','invoice',v_invoice,null,
          jsonb_build_object('contract_id',c.id,'period_start',v_period_start,'period_end',v_period_end,'total',v_total));
        v_created := v_created+1;
      end if;
      v_next_date := (date_trunc('month',v_period_start::timestamp + v_interval) + (c.billing_day - 1) * interval '1 day')::date;
      if v_next_date <= v_period_start then raise exception 'La prochaine échéance doit être postérieure à la période courante'; end if;
      v_period_start := v_next_date;
    end loop;
    update public.recurring_service_contracts set
      next_billing_date=v_period_start,
      status=case when end_date is not null and v_period_start > end_date then 'ended' else status end,
      updated_at=now()
    where id=c.id;
  end loop;
  return v_created;
end; $$;

create or replace function public.generate_due_recurring_invoice_drafts(p_org uuid)
returns integer
language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'invoices.create');
  return private.process_due_recurring_invoice_drafts(p_org, auth.uid());
end; $$;

create or replace function private.generate_all_due_recurring_invoice_drafts()
returns integer
language plpgsql security definer set search_path=public,private as $$
declare
  v_org uuid;
  v_total integer := 0;
begin
  for v_org in
    select distinct organization_id
    from public.recurring_service_contracts
    where status='active' and next_billing_date <= current_date
  loop
    v_total := v_total + private.process_due_recurring_invoice_drafts(v_org, null);
  end loop;
  return v_total;
end; $$;

revoke all on function private.process_due_recurring_invoice_drafts(uuid,uuid) from public, anon, authenticated;
revoke all on function private.generate_all_due_recurring_invoice_drafts() from public, anon, authenticated;
grant execute on function private.process_due_recurring_invoice_drafts(uuid,uuid) to postgres;
grant execute on function private.generate_all_due_recurring_invoice_drafts() to postgres;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname='magnisa-recurring-invoice-drafts' loop
    perform cron.unschedule(j.jobid);
  end loop;
  perform cron.schedule(
    'magnisa-recurring-invoice-drafts',
    '0 * * * *',
    'select private.generate_all_due_recurring_invoice_drafts();'
  );
end;
$$;
