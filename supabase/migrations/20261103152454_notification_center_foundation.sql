create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('finance','loan','payment','treasury','social','tax','service','accounting','system')),
  priority text not null default 'info' check (priority in ('info','attention','urgent','critical')),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  body text not null default '' check (char_length(body) <= 1200),
  action_url text,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint notifications_org_recipient_dedupe_key unique (organization_id, recipient_user_id, dedupe_key)
);
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, organization_id, created_at desc)
  where read_at is null and archived_at is null;

create table if not exists public.notification_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  category_preferences jsonb not null default '{}'::jsonb,
  quiet_hours jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  device_label text,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_active_idx
  on public.push_subscriptions (organization_id, user_id) where is_active;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email','push')),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (notification_id, channel)
);
create index if not exists notification_deliveries_queue_idx
  on public.notification_deliveries (status, next_attempt_at) where status in ('pending','failed');

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_key text not null,
  category text not null,
  enabled boolean not null default true,
  reminder_offsets_days integer[] not null default array[]::integer[],
  channels jsonb not null default '{"in_app":true,"email":true,"push":true}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, rule_key)
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_key text not null,
  event_type text not null,
  source_table text,
  source_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, event_key)
);

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notification_events enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_user_id = (select auth.uid()) and public.is_org_member(organization_id));
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_user_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (recipient_user_id = (select auth.uid()) and public.is_org_member(organization_id));

drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));

drop policy if exists notification_rules_read_member on public.notification_rules;
create policy notification_rules_read_member on public.notification_rules
  for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists notification_rules_manage_admin on public.notification_rules;
create policy notification_rules_manage_admin on public.notification_rules
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner','admin','director']))
  with check (public.has_org_role(organization_id, array['owner','admin','director']));

revoke all on public.notification_deliveries from anon, authenticated;
revoke all on public.notification_events from anon, authenticated;
revoke insert, delete on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at, archived_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_rules to authenticated;
grant insert, update, delete on public.notification_rules to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.create_org_notification(
  p_organization_id uuid,
  p_category text,
  p_priority text,
  p_title text,
  p_body text,
  p_action_url text,
  p_entity_type text,
  p_entity_id uuid,
  p_dedupe_key text,
  p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member record;
  v_notification_id uuid;
begin
  if p_organization_id is null or p_dedupe_key is null then return; end if;
  for v_member in
    select user_id from public.organization_members
    where organization_id = p_organization_id and status = 'active'
  loop
    insert into public.notifications (
      organization_id, recipient_user_id, category, priority, title, body,
      action_url, entity_type, entity_id, metadata, dedupe_key
    ) values (
      p_organization_id, v_member.user_id, p_category, p_priority, p_title, p_body,
      p_action_url, p_entity_type, p_entity_id, coalesce(p_payload,'{}'::jsonb), p_dedupe_key
    )
    on conflict (organization_id, recipient_user_id, dedupe_key) do nothing
    returning id into v_notification_id;

    if v_notification_id is not null then
      insert into public.notification_deliveries (
        notification_id, organization_id, recipient_user_id, channel, status
      )
      select v_notification_id, p_organization_id, v_member.user_id, channel, 'pending'
      from (values ('email'),('push')) as c(channel)
      on conflict (notification_id, channel) do nothing;
    end if;
    v_notification_id := null;
  end loop;
end;
$$;

create or replace function private.notify_loan_repayment_posted()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_lender text;
  v_reference text;
begin
  if new.status = 'posted' and (tg_op = 'INSERT' or old.status is distinct from 'posted') then
    select lender_name, coalesce(contract_reference, magnisa_reference, id::text)
      into v_lender, v_reference
    from public.loans
    where id = new.loan_id and organization_id = new.organization_id;

    insert into public.notification_events (
      organization_id, event_key, event_type, source_table, source_id, payload
    ) values (
      new.organization_id,
      'loan-repayment-posted:' || new.id::text,
      'loan.repayment.posted',
      'loan_repayments',
      new.id,
      jsonb_build_object('loan_id', new.loan_id, 'amount', new.amount, 'payment_date', new.payment_date)
    ) on conflict (organization_id, event_key) do nothing;

    perform private.create_org_notification(
      new.organization_id,
      'loan',
      'info',
      'Remboursement d’emprunt enregistré',
      'Un remboursement de ' || to_char(new.amount, 'FM999G999G999G990D00') || ' MGA a été enregistré pour ' || coalesce(v_lender,'un prêteur') || '.',
      '/emprunts',
      'loan_repayment',
      new.id,
      'loan-repayment-posted:' || new.id::text,
      jsonb_build_object('loan_id', new.loan_id, 'reference', v_reference)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_loan_repayment_posted on public.loan_repayments;
create trigger trg_notify_loan_repayment_posted
after insert or update of status on public.loan_repayments
for each row execute function private.notify_loan_repayment_posted();

grant usage on schema public to authenticated;
