-- Capture CRM activity from real order, invoice and payment lifecycle transitions.
create unique index if not exists prospect_interventions_automatic_evidence_unique
  on public.prospect_interventions(organization_id,evidence_reference)
  where evidence_reference is not null
    and evidence_reference ~ '^(order|invoice|payment|service_contract):[0-9a-f-]{36}
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $evt$
begin
  if new.status='confirmed' and (tg_op='INSERT' or old.status is distinct from new.status)
     and new.created_by is not null
     and exists (select 1 from public.organization_members
       where organization_id=new.organization_id and user_id=new.created_by and status='active') then
    insert into public.prospect_interventions(
      organization_id,customer_id,contributor_user_id,created_by,intervention_type,
      contribution_role,stage_status,validation_status,description,evidence_reference,occurred_at
    ) values (
      new.organization_id,new.customer_id,new.created_by,new.created_by,'closing',
      'support','completed','pending',
      'Événement CRM automatique : commande '||new.number||' confirmée.',
      'order:'||new.id::text,coalesce(new.updated_at,new.created_at,now())
    ) on conflict do nothing;
  end if;
  return new;
end;
$evt$;

drop trigger if exists crm_capture_confirmed_order_insert on public.orders;
create trigger crm_capture_confirmed_order_insert
after insert on public.orders
for each row execute function public.capture_confirmed_order_contribution();

create or replace function public.capture_paid_invoice_contribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $evt$
begin
  if new.status='paid' and (tg_op='INSERT' or old.status is distinct from new.status)
     and new.created_by is not null
     and exists (select 1 from public.organization_members
       where organization_id=new.organization_id and user_id=new.created_by and status='active') then
    insert into public.prospect_interventions(
      organization_id,customer_id,contributor_user_id,created_by,intervention_type,
      contribution_role,stage_status,validation_status,description,evidence_reference,occurred_at
    ) values (
      new.organization_id,new.customer_id,new.created_by,new.created_by,'follow_up',
      'support','completed','pending',
      'Événement CRM automatique : facture '||new.number||' soldée.',
      'invoice:'||new.id::text,coalesce(new.updated_at,new.created_at,now())
    );
  end if;
  return new;
end;
$evt$;

drop trigger if exists crm_capture_paid_invoice_insert on public.invoices;
create trigger crm_capture_paid_invoice_insert
after insert on public.invoices
for each row execute function public.capture_paid_invoice_contribution();

create or replace function public.capture_confirmed_payment_contribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $evt$
begin
  if new.status='confirmed' and (tg_op='INSERT' or old.status is distinct from new.status)
     and new.created_by is not null
     and exists (select 1 from public.organization_members
       where organization_id=new.organization_id and user_id=new.created_by and status='active') then
    insert into public.prospect_interventions(
      organization_id,customer_id,contributor_user_id,created_by,intervention_type,
      contribution_role,stage_status,validation_status,description,evidence_reference,occurred_at
    ) values (
      new.organization_id,new.customer_id,new.created_by,new.created_by,'follow_up',
      'support','completed','pending',
      'Événement CRM automatique : paiement '||new.reference||' confirmé ('||new.amount::text||').',
      'payment:'||new.id::text,coalesce(new.created_at,now())
    ) on conflict do nothing;
  end if;
  return new;
end;
$evt$;

drop trigger if exists crm_capture_confirmed_payment_insert on public.payments;
create trigger crm_capture_confirmed_payment_insert
after insert on public.payments
for each row execute function public.capture_confirmed_payment_contribution();

drop trigger if exists crm_capture_confirmed_payment_update on public.payments;
create trigger crm_capture_confirmed_payment_update
after update of status on public.payments
for each row execute function public.capture_confirmed_payment_contribution();

revoke all on function public.capture_confirmed_payment_contribution() from public,anon,authenticated;
;

create or replace function public.capture_confirmed_order_contribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $evt$
begin
  if new.status='confirmed' and (tg_op='INSERT' or old.status is distinct from new.status)
     and new.created_by is not null
     and exists (select 1 from public.organization_members
       where organization_id=new.organization_id and user_id=new.created_by and status='active') then
    insert into public.prospect_interventions(
      organization_id,customer_id,contributor_user_id,created_by,intervention_type,
      contribution_role,stage_status,validation_status,description,evidence_reference,occurred_at
    ) values (
      new.organization_id,new.customer_id,new.created_by,new.created_by,'closing',
      'support','completed','pending',
      'Événement CRM automatique : commande '||new.number||' confirmée.',
      'order:'||new.id::text,coalesce(new.updated_at,new.created_at,now())
    );
  end if;
  return new;
end;
$evt$;

drop trigger if exists crm_capture_confirmed_order_insert on public.orders;
create trigger crm_capture_confirmed_order_insert
after insert on public.orders
for each row execute function public.capture_confirmed_order_contribution();

create or replace function public.capture_paid_invoice_contribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $evt$
begin
  if new.status='paid' and (tg_op='INSERT' or old.status is distinct from new.status)
     and new.created_by is not null
     and exists (select 1 from public.organization_members
       where organization_id=new.organization_id and user_id=new.created_by and status='active') then
    insert into public.prospect_interventions(
      organization_id,customer_id,contributor_user_id,created_by,intervention_type,
      contribution_role,stage_status,validation_status,description,evidence_reference,occurred_at
    ) values (
      new.organization_id,new.customer_id,new.created_by,new.created_by,'follow_up',
      'support','completed','pending',
      'Événement CRM automatique : facture '||new.number||' soldée.',
      'invoice:'||new.id::text,coalesce(new.updated_at,new.created_at,now())
    );
  end if;
  return new;
end;
$evt$;

drop trigger if exists crm_capture_paid_invoice_insert on public.invoices;
create trigger crm_capture_paid_invoice_insert
after insert on public.invoices
for each row execute function public.capture_paid_invoice_contribution();

create or replace function public.capture_confirmed_payment_contribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $evt$
begin
  if new.status='confirmed' and (tg_op='INSERT' or old.status is distinct from new.status)
     and new.created_by is not null
     and exists (select 1 from public.organization_members
       where organization_id=new.organization_id and user_id=new.created_by and status='active') then
    insert into public.prospect_interventions(
      organization_id,customer_id,contributor_user_id,created_by,intervention_type,
      contribution_role,stage_status,validation_status,description,evidence_reference,occurred_at
    ) values (
      new.organization_id,new.customer_id,new.created_by,new.created_by,'follow_up',
      'support','completed','pending',
      'Événement CRM automatique : paiement '||new.reference||' confirmé ('||new.amount::text||').',
      'payment:'||new.id::text,coalesce(new.created_at,now())
    );
  end if;
  return new;
end;
$evt$;

drop trigger if exists crm_capture_confirmed_payment_insert on public.payments;
create trigger crm_capture_confirmed_payment_insert
after insert on public.payments
for each row execute function public.capture_confirmed_payment_contribution();

drop trigger if exists crm_capture_confirmed_payment_update on public.payments;
create trigger crm_capture_confirmed_payment_update
after update of status on public.payments
for each row execute function public.capture_confirmed_payment_contribution();

revoke all on function public.capture_confirmed_payment_contribution() from public,anon,authenticated;
