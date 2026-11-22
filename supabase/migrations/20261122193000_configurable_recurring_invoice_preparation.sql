-- Organization-level configuration for recurring invoice draft preparation.
alter table public.company_settings
  add column if not exists auto_prepare_recurring_invoices boolean not null default true,
  add column if not exists recurring_invoice_lead_days integer not null default 5;

alter table public.company_settings
  drop constraint if exists company_settings_recurring_invoice_lead_days_check;
alter table public.company_settings
  add constraint company_settings_recurring_invoice_lead_days_check
  check (recurring_invoice_lead_days between 0 and 30);

-- Prepare recurring invoice drafts using each organization's configured lead time.
-- Preserve billing timing, frequency, numbering, invoice lines and audit behavior.
create or replace function private.process_due_recurring_invoice_drafts(p_org uuid, p_actor uuid)
returns integer
language plpgsql security definer set search_path=pg_catalog, public, private as $$
declare
  c public.recurring_service_contracts%rowtype;
  v_trigger date;
  v_period_start date;
  v_period_end date;
  v_next_date date;
  v_interval interval;
  v_invoice uuid;
  v_number text;
  v_prefix text;
  v_sequence bigint;
  v_padding integer;
  v_gross numeric;
  v_tax numeric;
  v_total numeric;
  v_due_days integer;
  v_lead_days integer := 5;
  v_auto_prepare boolean := true;
  v_created integer := 0;
  v_today date := (now() at time zone 'Indian/Antananarivo')::date;
  v_horizon date;
  v_desc text;
begin
  select coalesce(max(default_payment_days),30),
         coalesce(bool_or(auto_prepare_recurring_invoices),true),
         coalesce(max(recurring_invoice_lead_days),5)
    into v_due_days, v_auto_prepare, v_lead_days
    from public.company_settings where organization_id=p_org;
  v_due_days := coalesce(v_due_days,30);
  v_lead_days := greatest(0,least(30,coalesce(v_lead_days,5)));
  v_horizon := v_today + v_lead_days;
  if not coalesce(v_auto_prepare,true) then
    return 0;
  end if;
  for c in
    select * from public.recurring_service_contracts
    where organization_id=p_org and status='active' and next_billing_date <= v_horizon
    order by next_billing_date, created_at
    for update skip locked
  loop
    v_interval := case c.frequency
      when 'daily' then interval '1 day'
      when 'weekly' then interval '1 week'
      when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'semiannual' then interval '6 months'
      when 'annual' then interval '1 year'
      when 'custom' then make_interval(days => coalesce(c.custom_interval_days,30))
    end;
    v_trigger := c.next_billing_date;
    while v_trigger <= v_horizon loop
      if c.billing_timing='arrears' then
        v_period_start := (v_trigger - v_interval)::date;
        v_period_end := (v_trigger - 1)::date;
        v_next_date := (v_trigger + v_interval)::date;
      else
        v_period_start := v_trigger;
        if c.frequency in ('daily','weekly','custom') then
          v_period_end := (v_period_start::timestamp + v_interval)::date - 1;
        else
          v_period_end := (date_trunc('month', v_period_start::timestamp + v_interval) + (c.billing_day - 1) * interval '1 day')::date - 1;
        end if;
        v_period_end := least(v_period_end, (v_period_start::timestamp + v_interval)::date - 1);
        v_next_date := (v_period_start::timestamp + v_interval)::date;
      end if;
      if c.end_date is not null and v_period_start > c.end_date then exit; end if;
      if c.end_date is not null then v_period_end := least(v_period_end, c.end_date); end if;
      if not exists(select 1 from public.invoices i
        where i.organization_id=p_org and i.recurring_contract_id=c.id
          and i.service_period_start=v_period_start) then
        v_gross := round(c.quantity*c.unit_price,2);
        v_tax := round(v_gross*c.tax_rate/100,2);
        v_total := v_gross+v_tax;
        select prefix,next_value,padding into v_prefix,v_sequence,v_padding
          from public.number_sequences
          where organization_id=p_org and document_type='invoice'
          for update;
        if not found then
          raise exception 'Séquence de numérotation non configurée pour invoice';
        end if;
        update public.number_sequences set next_value=v_sequence+1,updated_at=now()
          where organization_id=p_org and document_type='invoice';
        v_number := v_prefix || lpad(v_sequence::text,v_padding,'0');
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
          jsonb_build_object('contract_id',c.id,'period_start',v_period_start,'period_end',v_period_end,'total',v_total));
        v_created := v_created+1;
      end if;
      if v_next_date <= v_trigger then raise exception 'La prochaine échéance doit être postérieure à la période courante'; end if;
      v_trigger := v_next_date;
    end loop;
    update public.recurring_service_contracts set
      next_billing_date=v_trigger,
      status=case when end_date is not null and v_trigger > end_date and (billing_timing='advance' or v_trigger - v_interval > end_date) then 'ended' else status end,
      updated_at=now()
    where id=c.id;
  end loop;
  return v_created;
end; $$;