-- Recurring service contracts and idempotent draft invoice generation.
alter table public.invoices
  add column if not exists recurring_contract_id uuid,
  add column if not exists service_period_start date,
  add column if not exists service_period_end date;

create table if not exists public.recurring_service_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_line_id uuid not null references public.order_lines(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  description text not null,
  quantity numeric not null check (quantity > 0),
  unit text,
  unit_price numeric not null check (unit_price >= 0),
  tax_rate numeric not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  frequency text not null check (frequency in ('monthly','quarterly','semiannual','annual')),
  start_date date not null,
  end_date date,
  billing_day integer not null check (billing_day between 1 and 28),
  next_billing_date date not null,
  status text not null default 'active' check (status in ('active','suspended','cancelled','ended')),
  suspension_reason text,
  cancellation_reason text,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_service_contracts_date_check check (end_date is null or end_date >= start_date)
);

create unique index if not exists recurring_service_contracts_active_line_uidx
  on public.recurring_service_contracts(organization_id, order_line_id)
  where status in ('active','suspended');
create index if not exists recurring_service_contracts_due_idx
  on public.recurring_service_contracts(organization_id, status, next_billing_date);

alter table public.invoices
  add constraint invoices_recurring_contract_fk
  foreign key (recurring_contract_id) references public.recurring_service_contracts(id) on delete restrict;

create unique index if not exists invoices_recurring_period_uidx
  on public.invoices(organization_id, recurring_contract_id, service_period_start)
  where recurring_contract_id is not null;
create index if not exists invoices_recurring_contract_idx
  on public.invoices(organization_id, recurring_contract_id, service_period_start);

alter table public.recurring_service_contracts enable row level security;
drop policy if exists recurring_service_contracts_select on public.recurring_service_contracts;
create policy recurring_service_contracts_select on public.recurring_service_contracts
  for select to authenticated using (public.has_org_permission(organization_id, 'sales.view'));

create or replace function public.create_recurring_service_contract(
  p_org uuid, p_order uuid, p_order_line uuid, p_frequency text,
  p_start_date date, p_end_date date default null, p_billing_day integer default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  o public.orders%rowtype;
  l public.order_lines%rowtype;
  v_id uuid;
  v_day integer;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'orders.manage');
  if p_frequency not in ('monthly','quarterly','semiannual','annual') then
    raise exception 'Fréquence de facturation invalide';
  end if;
  if p_start_date is null or (p_end_date is not null and p_end_date < p_start_date) then
    raise exception 'Période du contrat invalide';
  end if;
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
  insert into public.recurring_service_contracts(
    organization_id,order_id,order_line_id,customer_id,service_id,description,quantity,unit,
    unit_price,tax_rate,frequency,start_date,end_date,billing_day,next_billing_date,created_by
  ) values (
    p_org,o.id,l.id,o.customer_id,l.service_id,l.description,l.quantity,l.unit,l.unit_price,l.tax_rate,
    p_frequency,p_start_date,p_end_date,v_day,p_start_date,auth.uid()
  ) returning id into v_id;
  perform public.audit_event(p_org,'recurring_service.created','recurring_service',v_id,null,
    jsonb_build_object('order_id',o.id,'order_line_id',l.id,'frequency',p_frequency,'start_date',p_start_date,'end_date',p_end_date));
  return v_id;
end; $$;

create or replace function public.set_recurring_service_status(
  p_org uuid, p_contract uuid, p_status text, p_reason text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare c public.recurring_service_contracts%rowtype;
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
  update public.recurring_service_contracts set
    status=p_status,
    suspension_reason=case when p_status='suspended' then trim(p_reason) when p_status='active' then null else suspension_reason end,
    cancellation_reason=case when p_status='cancelled' then trim(p_reason) else cancellation_reason end,
    cancelled_at=case when p_status='cancelled' then now() else cancelled_at end,
    updated_at=now()
    where id=c.id;
  perform public.audit_event(p_org,'recurring_service.'||p_status,'recurring_service',c.id,
    jsonb_build_object('status',c.status),
    jsonb_build_object('status',p_status,'reason',nullif(trim(coalesce(p_reason,'')),'')));
end; $$;

create or replace function public.generate_due_recurring_invoice_drafts(p_org uuid)
returns integer
language plpgsql security definer set search_path=public as $$
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
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'invoices.create');
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
          and i.service_period_start=v_period_start and i.status <> 'cancelled') then
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
          'Facture récurrente préparée en brouillon. Vérifier la période et les prestations avant émission.',auth.uid()
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

revoke all on function public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer) from public, anon;
revoke all on function public.set_recurring_service_status(uuid,uuid,text,text) from public, anon;
revoke all on function public.generate_due_recurring_invoice_drafts(uuid) from public, anon;
grant execute on function public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer) to authenticated;
grant execute on function public.set_recurring_service_status(uuid,uuid,text,text) to authenticated;
grant execute on function public.generate_due_recurring_invoice_drafts(uuid) to authenticated;
