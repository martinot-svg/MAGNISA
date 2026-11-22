-- Prepare recurring invoice drafts five local calendar days before their billing date.
-- The cron remains hourly; this only advances draft preparation, never invoice issuance.
create or replace function private.process_due_recurring_invoice_drafts(p_org uuid, p_actor uuid)
returns integer
language plpgsql security definer set search_path=public,private as $$
declare
  c public.recurring_service_contracts%rowtype;
  v_today date := (now() at time zone 'Indian/Antananarivo')::date;
  v_horizon date;
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
  v_horizon := v_today + 5;
  select coalesce(max(default_payment_days),30) into v_due_days
    from public.company_settings where organization_id=p_org;
  v_due_days := coalesce(v_due_days,30);

  for c in
    select * from public.recurring_service_contracts
    where organization_id=p_org and status='active' and next_billing_date <= v_horizon
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

    while v_period_start <= v_horizon and (c.end_date is null or v_period_start <= c.end_date) loop
      v_period_end := (date_trunc('month', v_period_start::timestamp + v_interval) + (c.billing_day - 1) * interval '1 day')::date - 1;
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
          v_number,'draft',v_today,greatest(v_today,v_period_start+v_due_days),
          v_gross,0,v_tax,v_total,0,v_total,
          'Brouillon préparé automatiquement cinq jours avant l’échéance. Vérifier la période et les prestations avant émission.',p_actor
        ) returning id into v_invoice;

        insert into public.invoice_lines(
          organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,
          discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order
        ) values (
          p_org,v_invoice,c.service_id,v_desc,c.quantity,c.unit,c.unit_price,0,0,
          v_gross,c.tax_rate,v_tax,v_total,1
        );

        perform public.audit_event(p_org,'invoice.recurring_draft_created','invoice',v_invoice,null,
          jsonb_build_object('contract_id',c.id,'period_start',v_period_start,'period_end',v_period_end,
            'prepared_days_before_due',greatest(0,v_period_start-v_today),'total',v_total));
        v_created := v_created+1;
      end if;

      v_next_date := (date_trunc('month',v_period_start::timestamp + v_interval) + (c.billing_day - 1) * interval '1 day')::date;
      if v_next_date <= v_period_start then
        raise exception 'La prochaine échéance doit être postérieure à la période courante';
      end if;
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
