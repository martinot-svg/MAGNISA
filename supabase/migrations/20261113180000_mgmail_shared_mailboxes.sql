-- MGMail : boîtes de service partagées, permissions nominatives, état lu individuel.
-- Toujours un courrier interne MAGNISA ; aucun domaine Internet public fourni ici.

create unique index if not exists mgmail_internal_mailboxes_id_org_uidx
  on public.mgmail_internal_mailboxes(id,organization_id);

create table if not exists public.mgmail_internal_mailbox_grants (
  organization_id uuid not null references public.mgmail_internal_namespaces(organization_id) on delete cascade,
  mailbox_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_read boolean not null default false,
  can_send boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id,mailbox_id,user_id),
  constraint mgmail_grant_mailbox_in_org foreign key (mailbox_id,organization_id)
    references public.mgmail_internal_mailboxes(id,organization_id) on delete cascade
);
create index if not exists mgmail_grants_user_idx
  on public.mgmail_internal_mailbox_grants(organization_id,user_id) where is_active;
alter table public.mgmail_internal_mailbox_grants enable row level security;

create policy mgmail_grants_read
on public.mgmail_internal_mailbox_grants for select to authenticated
using (public.is_org_member(organization_id)
  and (user_id=(select auth.uid()) or public.has_org_permission(organization_id,'users.manage')));

create policy mgmail_grants_create
on public.mgmail_internal_mailbox_grants for insert to authenticated
with check (public.has_org_permission(organization_id,'users.manage')
  and exists (select 1 from public.organization_members m
    where m.organization_id=mgmail_internal_mailbox_grants.organization_id
      and m.user_id=mgmail_internal_mailbox_grants.user_id and m.status='active'));

create policy mgmail_grants_change
on public.mgmail_internal_mailbox_grants for update to authenticated
using (public.has_org_permission(organization_id,'users.manage'))
with check (public.has_org_permission(organization_id,'users.manage')
  and exists (select 1 from public.organization_members m
    where m.organization_id=mgmail_internal_mailbox_grants.organization_id
      and m.user_id=mgmail_internal_mailbox_grants.user_id and m.status='active'));

revoke all on public.mgmail_internal_mailbox_grants from anon,authenticated;
grant select,insert (organization_id,mailbox_id,user_id,can_read,can_send,is_active),
  update (can_read,can_send,is_active)
  on public.mgmail_internal_mailbox_grants to authenticated;

-- La fonction tourne avec le rôle appelant, sous RLS ; ne permet jamais de
-- lire l'annuaire privé des collaborateurs.
create or replace function public.mgmail_has_internal_access(
  p_org uuid,p_mailbox uuid,p_action text
) returns boolean
language sql stable security invoker
set search_path=pg_catalog,public
as $access$
  select
    p_action in ('read','send')
    and public.is_org_member(p_org)
    and exists (
      select 1 from public.mgmail_internal_mailboxes b
      where b.organization_id=p_org and b.id=p_mailbox and b.is_active
        and (
          (b.owner_user_id=(select auth.uid())
            and case when p_action='read' then b.can_read else b.can_send end)
          or exists (
            select 1 from public.mgmail_internal_mailbox_grants g
            where g.organization_id=b.organization_id
              and g.mailbox_id=b.id and g.user_id=(select auth.uid())
              and g.is_active
              and case when p_action='read' then g.can_read else g.can_send end
          )
        )
    );
$access$;
revoke all on function public.mgmail_has_internal_access(uuid,uuid,text) from public,anon;
grant execute on function public.mgmail_has_internal_access(uuid,uuid,text) to authenticated;

create or replace function public.mgmail_can_send_internal(
  p_organization_id uuid,p_sender_mailbox_id uuid,p_recipient_mailbox_id uuid
) returns boolean
language sql stable security invoker
set search_path=pg_catalog,public
as $send$
  select public.mgmail_has_internal_access(p_organization_id,p_sender_mailbox_id,'send')
    and exists (
      select 1 from public.mgmail_internal_mailboxes recipient
      where recipient.organization_id=p_organization_id
        and recipient.id=p_recipient_mailbox_id and recipient.is_active
    );
$send$;

drop policy if exists mgmail_messages_select on public.mgmail_internal_messages;
create policy mgmail_messages_select
  on public.mgmail_internal_messages for select to authenticated
  using (
    public.mgmail_has_internal_access(organization_id,sender_mailbox_id,'read')
    or public.mgmail_has_internal_access(organization_id,recipient_mailbox_id,'read')
  );

drop policy if exists mgmail_messages_mark_read on public.mgmail_internal_messages;
create policy mgmail_messages_mark_read
  on public.mgmail_internal_messages for update to authenticated
  using (public.mgmail_has_internal_access(organization_id,recipient_mailbox_id,'read'))
  with check (public.mgmail_has_internal_access(organization_id,recipient_mailbox_id,'read'));

-- L'état de lecture est propre à chaque collaborateur, même pour une boîte partagée.
create table if not exists public.mgmail_internal_message_reads (
  organization_id uuid not null references public.mgmail_internal_namespaces(organization_id) on delete cascade,
  message_id uuid not null references public.mgmail_internal_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id,user_id)
);
alter table public.mgmail_internal_message_reads enable row level security;
create policy mgmail_reads_own
  on public.mgmail_internal_message_reads for select to authenticated
  using (user_id=(select auth.uid()) and public.is_org_member(organization_id));
create policy mgmail_reads_insert_own
  on public.mgmail_internal_message_reads for insert to authenticated
  with check (
    user_id=(select auth.uid())
    and public.is_org_member(organization_id)
    and exists (
      select 1 from public.mgmail_internal_messages m
      where m.id=mgmail_internal_message_reads.message_id
        and m.organization_id=mgmail_internal_message_reads.organization_id
        and public.mgmail_has_internal_access(
          m.organization_id,m.recipient_mailbox_id,'read'
        )
    )
  );
revoke all on public.mgmail_internal_message_reads from anon,authenticated;
grant select,insert (organization_id,message_id,user_id)
  on public.mgmail_internal_message_reads to authenticated;

-- Révocation immédiate des délégations à la suspension du collaborateur.
create or replace function private.mgmail_suspend_shared_grants()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $suspend$
begin
  if tg_op='DELETE' then
    update public.mgmail_internal_mailbox_grants set is_active=false
      where organization_id=old.organization_id and user_id=old.user_id;
    return old;
  end if;
  if new.status is distinct from 'active' then
    update public.mgmail_internal_mailbox_grants set is_active=false
      where organization_id=new.organization_id and user_id=new.user_id;
  end if;
  return new;
end;
$suspend$;
revoke all on function private.mgmail_suspend_shared_grants() from public,anon,authenticated;
drop trigger if exists trg_mgmail_suspend_shared_grants on public.organization_members;
create trigger trg_mgmail_suspend_shared_grants
  after update of status or delete on public.organization_members
  for each row execute function private.mgmail_suspend_shared_grants();

-- Un message crée des notifications uniquement pour les lecteurs actifs
-- (propriétaire autorisé et collaborateurs explicitement habilités).
create or replace function private.mgmail_notify_internal_message()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $notify$
declare
  v_recipient uuid;
begin
  for v_recipient in
    select u.user_id from (
      select b.owner_user_id as user_id
      from public.mgmail_internal_mailboxes b
      where b.id=new.recipient_mailbox_id and b.organization_id=new.organization_id
        and b.is_active and b.can_read and b.owner_user_id is not null
      union
      select g.user_id
      from public.mgmail_internal_mailbox_grants g
      join public.mgmail_internal_mailboxes b
        on b.id=g.mailbox_id and b.organization_id=g.organization_id
      where g.mailbox_id=new.recipient_mailbox_id
        and g.organization_id=new.organization_id
        and g.is_active and g.can_read and b.is_active
    ) u
    join public.organization_members m
      on m.organization_id=new.organization_id and m.user_id=u.user_id and m.status='active'
  loop
    insert into public.notifications (
      organization_id,recipient_user_id,category,priority,title,body,action_url,
      entity_type,entity_id,metadata,dedupe_key
    ) values (
      new.organization_id,v_recipient,'service','info',
      'Nouveau message dans MGMail',
      'Un nouveau message interne vous attend dans MAGNISA.',
      '/magnimail/interne','mgmail_internal_message',new.id,
      jsonb_build_object('channel','internal','message_id',new.id),
      'mgmail-internal-message:' || new.id::text
    ) on conflict (organization_id,recipient_user_id,dedupe_key) do nothing;
  end loop;
  return new;
end;
$notify$;
revoke all on function private.mgmail_notify_internal_message() from public,anon,authenticated;
