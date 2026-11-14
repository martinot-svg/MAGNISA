-- MGMail : planification conservatrice, préavis facturation et anti-doublons.
-- Aucune émission depuis cette migration : seule une tâche serveur explicitement
-- activée peut prendre en charge les messages programmés.
alter table public.mgmail_external_messages
  add column if not exists scheduled_at timestamptz,
  add column if not exists source_kind text not null default 'manual'
    check(source_kind in ('manual','scheduled','billing_preavis')),
  add column if not exists recurring_contract_id uuid
    references public.recurring_service_contracts(id) on delete restrict,
  add column if not exists preavis_billing_date date,
  add column if not exists preavis_days_before integer
    check (preavis_days_before between 1 and 3650);

alter table public.mgmail_external_messages
  add constraint mgmail_external_schedule_source_consistency
  check(
    (source_kind='billing_preavis'
      and recurring_contract_id is not null
      and preavis_billing_date is not null
      and preavis_days_before is not null
      and direction='outgoing')
    or
    (source_kind <> 'billing_preavis'
      and recurring_contract_id is null
      and preavis_billing_date is null
      and preavis_days_before is null)
  );

-- Un courrier annulé ne doit pas apparaître comme un échec technique.
alter table public.mgmail_external_messages
  drop constraint if exists mgmail_external_messages_status_check;
alter table public.mgmail_external_messages
  add constraint mgmail_external_messages_status_check
  check (status in ('queued','sending','accepted','delivered','failed',
                   'bounced','uncertain','received','cancelled'));

alter table public.mgmail_external_messages
  add constraint mgmail_scheduled_date_required
  check (source_kind='manual' or scheduled_at is not null);

-- L'échéance est dédupliquée pour toute sa durée de vie, y compris en cas
-- d'échec ou d'arrêt du cron, afin d'éviter toute relance involontaire.
create unique index if not exists mgmail_billing_preavis_once_per_due_date
  on public.mgmail_external_messages(
    organization_id,recurring_contract_id,preavis_billing_date,preavis_days_before
  ) where source_kind='billing_preavis';

create index if not exists mgmail_outgoing_schedule_due_idx
  on public.mgmail_external_messages(scheduled_at,id)
  where direction='outgoing' and status='queued' and scheduled_at is not null;

-- Un contrat doit appartenir à la même organisation que son option d'envoi.
create unique index if not exists mgmail_recurring_contract_org_ref
  on public.recurring_service_contracts(id,organization_id);

alter table public.mgmail_external_messages
  add constraint mgmail_external_billing_contract_in_org
  foreign key(recurring_contract_id,organization_id)
  references public.recurring_service_contracts(id,organization_id)
  on delete restrict;

create table if not exists public.mgmail_preavis_delivery_configs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recurring_contract_id uuid not null,
  identity_id uuid not null,
  enabled boolean not null default false,
  recipient_confirmed boolean not null default false,
  configured_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,recurring_contract_id),
  constraint mgmail_delivery_contract_in_org
    foreign key (recurring_contract_id,organization_id)
      references public.recurring_service_contracts(id,organization_id) on delete cascade,
  constraint mgmail_delivery_sender_in_org
    foreign key (identity_id,organization_id)
      references public.mgmail_external_identities(id,organization_id)
      on delete restrict
);
create index if not exists mgmail_preavis_delivery_enabled
  on public.mgmail_preavis_delivery_configs(organization_id)
  where enabled and recipient_confirmed;

alter table public.mgmail_preavis_delivery_configs enable row level security;
create policy mgmail_preavis_delivery_read
  on public.mgmail_preavis_delivery_configs for select to authenticated
  using (public.has_org_permission(organization_id,'sales.view'));
create policy mgmail_preavis_delivery_create
  on public.mgmail_preavis_delivery_configs for insert to authenticated
  with check (
    public.has_org_permission(organization_id,'orders.manage')
    and public.has_org_permission(organization_id,'users.manage')
    and configured_by=(select auth.uid())
    and (not enabled or exists (
      select 1 from public.mgmail_external_identities identity
      where identity.id=mgmail_preavis_delivery_configs.identity_id
        and identity.organization_id=mgmail_preavis_delivery_configs.organization_id
        and identity.status='active'
        and identity.receive_enabled
        and public.mgmail_can_external_access(
          identity.organization_id,identity.mailbox_id,'send')
    ))
  );
create policy mgmail_preavis_delivery_update
  on public.mgmail_preavis_delivery_configs for update to authenticated
  using (
    public.has_org_permission(organization_id,'orders.manage')
    and public.has_org_permission(organization_id,'users.manage')
  )
  with check (
    public.has_org_permission(organization_id,'orders.manage')
    and public.has_org_permission(organization_id,'users.manage')
    and configured_by=(select auth.uid())
    and (not enabled or exists (
      select 1 from public.mgmail_external_identities identity
      where identity.id=mgmail_preavis_delivery_configs.identity_id
        and identity.organization_id=mgmail_preavis_delivery_configs.organization_id
        and identity.status='active'
        and identity.receive_enabled
        and public.mgmail_can_external_access(
          identity.organization_id,identity.mailbox_id,'send')
    ))
  );
revoke all on public.mgmail_preavis_delivery_configs from anon,authenticated;
grant select, insert(organization_id,recurring_contract_id,identity_id,
  enabled,recipient_confirmed,configured_by,updated_at), update(identity_id,enabled,
  recipient_confirmed,configured_by,updated_at)
  on public.mgmail_preavis_delivery_configs to authenticated;

-- Ce lot ne confère pas de droit d'écriture navigateur sur le courrier externe ;
-- les messages programmés sont insérés/modifiés exclusivement côté serveur
-- après vérification de l'utilisateur et de ses droits MGMail.
