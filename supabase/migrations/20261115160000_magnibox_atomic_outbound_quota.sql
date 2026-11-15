-- MAGNIBOX outbound quota reservation must be serialized with the pending row insert.
-- The lock is scoped to one organization + sender identity and held until transaction end.
create or replace function public.orbit_reserve_magnibox_outbound(
  p_organization_id uuid,
  p_identity_id uuid,
  p_from_email text,
  p_to_emails text[],
  p_subject text,
  p_body_text text,
  p_request_key uuid,
  p_created_by uuid,
  p_daily_limit integer
) returns uuid
language plpgsql
security definer
set search_path = ''
as $magnibox_quota$
declare
  v_message_id uuid;
  v_count bigint;
begin
  if p_organization_id is null or p_identity_id is null or p_created_by is null
    or p_request_key is null or p_daily_limit is null or p_daily_limit not between 1 and 20
    or p_from_email is null or p_to_emails is null
    or cardinality(p_to_emails) not between 1 and 10
    or p_subject is null or length(btrim(p_subject)) not between 1 and 180
    or p_body_text is null or length(btrim(p_body_text)) = 0
    or length(p_body_text) > 50000 then
    raise exception 'Invalid MAGNIBOX outbound reservation' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.orbit_public_identities i
    where i.id = p_identity_id
      and i.organization_id = p_organization_id
      and i.email_address = p_from_email
      and i.status = 'active'
      and i.provider = 'smtp'
  ) then
    raise exception 'MAGNIBOX sender identity is not active' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_identity_id::text, 0)
  );

  select count(*) into v_count
  from public.orbit_external_messages m
  where m.organization_id = p_organization_id
    and m.identity_id = p_identity_id
    and m.direction = 'outgoing'
    and m.created_at >= pg_catalog.now() - interval '24 hours';

  if v_count >= p_daily_limit then
    raise exception 'MAGNIBOX outbound quota exceeded' using errcode = 'P0001';
  end if;

  insert into public.orbit_external_messages (
    organization_id, identity_id, direction, status, from_email, to_emails,
    subject, body_text, request_key, created_by
  ) values (
    p_organization_id, p_identity_id, 'outgoing', 'sending', p_from_email,
    p_to_emails, p_subject, p_body_text, p_request_key, p_created_by
  ) returning id into v_message_id;

  return v_message_id;
end;
$magnibox_quota$;

revoke all on function public.orbit_reserve_magnibox_outbound(uuid,uuid,text,text[],text,text,uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.orbit_reserve_magnibox_outbound(uuid,uuid,text,text[],text,text,uuid,uuid,integer)
  to service_role;

comment on function public.orbit_reserve_magnibox_outbound(uuid,uuid,text,text[],text,text,uuid,uuid,integer) is
  'Atomically serializes per-identity 24-hour outbound quota checks and pending-message insertion; service-role only.';
