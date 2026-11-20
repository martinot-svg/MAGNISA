-- MAGNIBOX platform-level request review.
-- Only explicitly enrolled MAGNISA platform owners with MFA AAL2 may review requests.
-- Company owners/admins cannot approve their own public domains or addresses.
create schema if not exists private;

create table if not exists private.magnibox_platform_mail_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  request_type text not null check (request_type in ('domain','address')),
  request_id uuid not null,
  previous_status text not null,
  new_status text not null,
  decision_note text not null,
  created_at timestamptz not null default now()
);
alter table private.magnibox_platform_mail_audit enable row level security;
revoke all on private.magnibox_platform_mail_audit from public,anon,authenticated;

create or replace function public.magnibox_platform_mail_requests()
returns table (
  request_type text,
  request_id uuid,
  organization_id uuid,
  domain_name text,
  email_address text,
  request_status text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path=''
as $magnibox$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from private.magnisa_platform_identity_owners o
    where o.user_id=(select auth.uid())
  ) then
    raise exception 'Accès réservé au propriétaire de MAGNISA' using errcode='42501';
  end if;
  if coalesce((select auth.jwt())->>'aal','') <> 'aal2' then
    raise exception 'Authentification multifacteur requise' using errcode='42501';
  end if;
  return query
    select 'domain'::text,d.id,d.organization_id,d.domain_name,null::text,d.status,d.created_at
    from public.magnibox_domain_requests d
    union all
    select 'address'::text,a.id,a.organization_id,a.domain_name,a.email_address,a.status,a.created_at
    from public.magnibox_public_address_requests a
    order by 7 desc;
end;
$magnibox$;
revoke all on function public.magnibox_platform_mail_requests() from public,anon;
grant execute on function public.magnibox_platform_mail_requests() to authenticated;

create or replace function public.magnibox_platform_review_mail_request(
  p_request_type text,
  p_request_id uuid,
  p_decision text,
  p_note text
) returns void
language plpgsql security definer set search_path=''
as $magnibox$
declare
  v_actor uuid := (select auth.uid());
  v_previous text;
  v_org uuid;
  v_domain uuid;
  v_mailbox uuid;
  v_local text;
begin
  if v_actor is null or not exists (
    select 1 from private.magnisa_platform_identity_owners o where o.user_id=v_actor
  ) then
    raise exception 'Accès réservé au propriétaire de MAGNISA' using errcode='42501';
  end if;
  if coalesce((select auth.jwt())->>'aal','') <> 'aal2' then
    raise exception 'Authentification multifacteur requise' using errcode='42501';
  end if;
  if p_decision not in ('reviewing','approved','rejected') then
    raise exception 'Décision invalide' using errcode='22023';
  end if;
  if length(btrim(coalesce(p_note,''))) not between 4 and 500 then
    raise exception 'Un motif de 4 à 500 caractères est obligatoire' using errcode='22023';
  end if;

  if p_request_type='domain' then
    if p_decision='approved' then
      raise exception 'Un domaine est vérifié uniquement par preuve DNS serveur, pas par approbation manuelle' using errcode='22023';
    end if;
    select d.status,d.organization_id into v_previous,v_org
      from public.magnibox_domain_requests d where d.id=p_request_id for update;
    if not found then raise exception 'Demande de domaine introuvable' using errcode='P0002'; end if;
    if v_previous='verified' and p_decision='reviewing' then
      raise exception 'Un domaine vérifié ne peut pas revenir en vérification manuelle' using errcode='22023';
    end if;
    update public.magnibox_domain_requests set status=p_decision,
      verified_at=case when p_decision='rejected' then null else verified_at end,
      proof_reference=case when p_decision='rejected' then null else proof_reference end
      where id=p_request_id;
  elsif p_request_type='address' then
    select a.status,a.organization_id,a.domain_request_id,a.mailbox_id,a.local_part
      into v_previous,v_org,v_domain,v_mailbox,v_local
      from public.magnibox_public_address_requests a where a.id=p_request_id for update;
    if not found then raise exception 'Demande d’adresse introuvable' using errcode='P0002'; end if;
    if p_decision='approved' and not exists (
      select 1 from public.magnibox_domain_requests d
      join public.magnibox_internal_mailboxes m
        on m.id=v_mailbox and m.organization_id=v_org and m.is_active
      where d.id=v_domain and d.organization_id=v_org and d.status='verified'
    ) then
      raise exception 'Approbation impossible : domaine non vérifié ou boîte inactive' using errcode='22023';
    end if;
    update public.magnibox_public_address_requests set status=p_decision where id=p_request_id;
  else
    raise exception 'Type de demande invalide' using errcode='22023';
  end if;

  insert into private.magnibox_platform_mail_audit
    (actor_user_id,request_type,request_id,previous_status,new_status,decision_note)
  values (v_actor,p_request_type,p_request_id,v_previous,p_decision,btrim(p_note));
end;
$magnibox$;
revoke all on function public.magnibox_platform_review_mail_request(text,uuid,text,text) from public,anon;
grant execute on function public.magnibox_platform_review_mail_request(text,uuid,text,text) to authenticated;

comment on function public.magnibox_platform_mail_requests() is
  'Platform-owner-only Magnibox request queue; requires MFA AAL2.';
comment on function public.magnibox_platform_review_mail_request(text,uuid,text,text) is
  'Audited platform review. Approval of an address requires verified domain and active internal mailbox; does not provision or activate SMTP identity.';
