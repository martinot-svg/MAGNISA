-- Central, additive Magnibox catalogue. Never grants registration or public-mail activation.
create table if not exists public.magnibox_tld_catalog (
 id uuid primary key default gen_random_uuid(),
 suffix text not null unique check(suffix ~ '^\\.[a-z0-9-]+(\\.[a-z0-9-]+)*$'),
 suffix_type text not null check(suffix_type in ('tld','suffixe_compose')),
 category text not null,
 country_code text,
 description text not null default '',
 is_active boolean not null default true,
 eligibility text not null default 'Règles du registre à vérifier.',
 registration_status text not null default 'non_verifiee'
   check(registration_status in ('non_verifiee','restreinte','indisponible')),
 registry text,
 registrar_provider text,
 dns_requirements jsonb not null default '{"ownership":"TXT","mx":"required_for_receiving","spf":"recommended","dkim":"required_for_sending","dmarc":"recommended"}'::jsonb,
 mail_compatible boolean,
 verification_status text not null default 'non_verifie'
   check(verification_status in ('non_verifie','restreint','desactive')),
 source_url text not null,
 last_checked_at timestamptz,
 synced_at timestamptz not null default now(),
 constraint magnibox_tld_suffix_kind check (
   (suffix_type='tld' and suffix !~ '^\\.[^.]+\\.')
   or (suffix_type='suffixe_compose' and suffix ~ '^\\.[^.]+\\.')
 )
);
create index if not exists magnibox_tld_catalog_filters_idx
 on public.magnibox_tld_catalog(category,country_code,is_active);
alter table public.magnibox_tld_catalog enable row level security;
drop policy if exists magnibox_tld_catalog_authenticated_read on public.magnibox_tld_catalog;
create policy magnibox_tld_catalog_authenticated_read on public.magnibox_tld_catalog
 for select to authenticated using(true);
revoke all on public.magnibox_tld_catalog from public,anon,authenticated;
grant select on public.magnibox_tld_catalog to authenticated;
-- All writes are restricted to a server-side service role. No registrant can claim availability.
-- Do not grant UPDATE/INSERT/DELETE to authenticated, not even an organization administrator.
