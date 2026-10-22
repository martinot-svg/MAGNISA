-- Support advance or arrears billing on each recurring service contract.
alter table public.recurring_service_contracts
  add column if not exists billing_timing text not null default 'advance'
  check (billing_timing in ('advance','arrears'));

drop function if exists public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer);

create or replace function public.create_recurring_service_contract(
  p_org uuid,
  p_order uuid,
  p_order_line uuid,
  p_frequency text,
  p_start_date date,
  p_end_date date default null,
  p_billing_day integer default null,
  p_billing_timing text default 'advance'
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  o public.orders%rowtype;
  l public.order_lines%rowtype;
  v_id uuid;
  v_day integer;
  v_interval interval;
  v_first_due date;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'orders.manage');
  if p_frequency not in ('monthly','quarterly','semiannual','annual') then
    raise exception 'Fréquence de facturation invalide';
  end if;
  if p_billing_timing not in ('advance','arrears') then
    raise exception 'Mode de facturation invalide';
  end if;
  if p_start_date is null or (p_end_date is not null and p_end_date < p_start_date) then
    raise exception 'Période du contrat invalide';
  end if;
  v_interval := case p_frequency
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months'
    when 'annual' then interval '1 year'
  end;
  v_day := coalesce(p_billing_day, least(extract(day from p_start_date)::integer, 28));
  if v_day < 1 or v_day > 28 then raise exception 'Le jour de facturation doit être compris entre 1 et 28'; end if;
  select * into o from public.orders
    where id=p_order and organization_id=p_org and status in ('confirmed','in_progress','completed')
    for update;
  if not found then raise exception 'Commande confirmée introuvable'; end if;
  select * into l from public.order_lines
    where id=p_order_line and order_id=o.id and organization_id=p_org
    for update;
  if not found or l.service_id is null then raise exception 'Ligne de commande invalide'; end if;
  if exists(select 1 from public.recurring_service_contracts
    where organization_id=p_org and order_line_id=l.id and status in ('active','suspended')) then
    raise exception 'Cette ligne possède déjà une prestation récurrente active';
  end if;
  v_first_due := case when p_billing_timing='advance' then p_start_date else (p_start_date + v_interval)::date end;
  insert into public.recurring_service_contracts(
    organization_id,order_id,order_line_id,customer_id,service_id,description,quantity,unit,
    unit_price,tax_rate,frequency,start_date,end_date,billing_day,next_billing_date,billing_timing,created_by
  ) values (
    p_org,o.id,l.id,o.customer_id,l.service_id,l.description,l.quantity,l.unit,
    round(l.line_total / nullif(l.quantity * (1 + l.tax_rate / 100), 0), 2),l.tax_rate,
    p_frequency,p_start_date,p_end_date,v_day,v_first_due,p_billing_timing,auth.uid()
  ) returning id into v_id;
  perform public.audit_event(p_org,'recurring_service.created','recurring_service',v_id,null,
    jsonb_build_object('order_id',o.id,'order_line_id',l.id,'frequency',p_frequency,
      'start_date',p_start_date,'end_date',p_end_date,'billing_timing',p_billing_timing));
  return v_id;
end; $$;

revoke all on function public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer,text) from public, anon;
grant execute on function public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer,text) to authenticated;

create or replace function private.process_due_recurring_invoice_drafts(p_org uuid, p_actor uuid)
returns integer
language plpgsql security definer set search_path=public,private as $$
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
  v_created integer := 0;
  v_desc text;
begin
  select coalesce(max(default_payment_days),30) into v_due_days
    from public.company_settings where organization_id=p_org;
  v_due_days := coalesce(v_due_days,30);
  for c in
    select * from public.recurring_service_contracts
    where organization_id=p_org and status='active' and next_billing_date <= current_date
    order by next_billing_date, created_at
    for update skip locked
  loop
    v_interval := case c.frequency
      when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'semiannual' then interval '6 months'
      when 'annual' then interval '1 year'
    end;
    v_trigger := c.next_billing_date;
    while v_trigger <= current_date loop
      if c.billing_timing='arrears' then
        v_period_start := (v_trigger - v_interval)::date;
        v_period_end := (v_trigger - 1)::date;
        v_next_date := (v_trigger + v_interval)::date;
      else
        v_period_start := v_trigger;
        v_period_end := (v_trigger + v_interval - interval '1 day')::date;
        v_next_date := (v_trigger + v_interval)::date;
      end if;
      if c.end_date is not null and v_period_start > c.end_date then exit; end if;
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
        if not found then raise exception 'Séquence de numérotation non configurée pour invoice'; end if;
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
          v_number,'draft',current_date,current_date+v_due_days,
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
          jsonb_build_object('contract_id',c.id,'period_start',v_period_start,'period_end',v_period_end,
            'billing_timing',c.billing_timing,'total',v_total));
        v_created := v_created+1;
      end if;
      if v_next_date <= v_trigger then raise exception 'La prochaine échéance doit être postérieure à la période courante'; end if;
      v_trigger := v_next_date;
    end loop;
    update public.recurring_service_contracts set
      next_billing_date=v_trigger,
      status=case
        when end_date is not null and
          (case when billing_timing='arrears' then (v_trigger - v_interval)::date else v_trigger end) > end_date
        then 'ended' else status end,
      updated_at=now()
    where id=c.id;
  end loop;
  return v_created;
end; $$;

-- Resuming a contract skips missed periods and schedules the next cycle without creating backdated drafts.
create or replace function public.set_recurring_service_status(
  p_org uuid, p_contract uuid, p_status text, p_reason text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare
  c public.recurring_service_contracts%rowtype;
  v_interval interval;
  v_next_billing_date date;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'orders.manage');
  if p_status not in ('active','suspended','cancelled') then raise exception 'Statut invalide'; end if;
  if p_status in ('suspended','cancelled') and length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'Un motif d''au moins 3 caractères est obligatoire';
  end if;
  select * into c from public.recurring_service_contracts
    where id=p_contract and organization_id=p_org for update;
  if not found then raise exception 'Prestation récurrente introuvable'; end if;
  if c.status in ('cancelled','ended') then raise exception 'Cette prestation récurrente est clôturée'; end if;
  v_next_billing_date := c.next_billing_date;
  v_interval := case c.frequency
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months'
    when 'annual' then interval '1 year'
  end;
  if p_status='active' and c.status='suspended' and c.next_billing_date <= current_date then
    if c.billing_timing='arrears' then
      v_next_billing_date := (date_trunc('month',current_date::timestamp + interval '2 months')
        + (c.billing_day - 1) * interval '1 day' + v_interval)::date;
    else
      v_next_billing_date := (date_trunc('month',current_date::timestamp + interval '1 month')
        + (c.billing_day - 1) * interval '1 day')::date;
    end if;
  end if;
  update public.recurring_service_contracts set
    status=case when p_status='active' and end_date is not null and
      (case when billing_timing='arrears' then (v_next_billing_date - v_interval)::date else v_next_billing_date end) > end_date
      then 'ended' else p_status end,
    next_billing_date=v_next_billing_date,
    suspension_reason=case when p_status='suspended' then trim(p_reason) when p_status='active' then null else suspension_reason end,
    suspended_at=case when p_status='suspended' then now() when p_status='active' then null else suspended_at end,
    cancellation_reason=case when p_status='cancelled' then trim(p_reason) else cancellation_reason end,
    cancelled_at=case when p_status='cancelled' then now() else cancelled_at end,
    updated_at=now()
    where id=c.id;
  perform public.audit_event(p_org,'recurring_service.'||p_status,'recurring_service',c.id,
    jsonb_build_object('status',c.status),
    jsonb_build_object('status',p_status,'reason',nullif(trim(coalesce(p_reason,'')),'')));
end; $$;

revoke all on function public.set_recurring_service_status(uuid,uuid,text,text) from public, anon;
grant execute on function public.set_recurring_service_status(uuid,uuid,text,text) to authenticated;
