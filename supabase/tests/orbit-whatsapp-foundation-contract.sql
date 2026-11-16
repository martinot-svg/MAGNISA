-- Contract checks for the ORBIT WhatsApp company-account foundation.
do $$
declare
  v_table text;
  v_rls boolean;
  v_bucket_public boolean;
  v_token_select boolean;
begin
  foreach v_table in array array[
    'orbit_whatsapp_connections','orbit_whatsapp_contacts',
    'orbit_whatsapp_conversations','orbit_whatsapp_messages',
    'orbit_whatsapp_message_events','orbit_whatsapp_document_dispatches'
  ] loop
    select c.relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=v_table;
    if coalesce(v_rls,false) is not true then
      raise exception 'RLS is not enabled on %',v_table;
    end if;
  end loop;

  select public into v_bucket_public
  from storage.buckets where id='orbit-whatsapp-media';
  if coalesce(v_bucket_public,true) is not false then
    raise exception 'WhatsApp media bucket must be private';
  end if;

  select has_column_privilege(
    'authenticated','public.orbit_whatsapp_connections','access_token_ciphertext','select'
  ) into v_token_select;
  if coalesce(v_token_select,true) is not false then
    raise exception 'Authenticated role must not read encrypted access token material';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='orbit_whatsapp_provider_message_id_idx'
  ) then
    raise exception 'Provider message idempotency index is missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='orbit_whatsapp_client_request_idx'
  ) then
    raise exception 'Outbound request idempotency index is missing';
  end if;
end $$;
