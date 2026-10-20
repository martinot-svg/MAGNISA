-- Isolated CI database only. All identities and data here are technical fixtures.
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.organizations(id uuid primary key);
create table public.organization_members(organization_id uuid references public.organizations(id),user_id uuid references auth.users(id),status text not null,primary key(organization_id,user_id));
create or replace function public.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='active')$$;
create table public.document_templates(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 document_type text not null,
 name text not null,
 configuration jsonb not null default '{}'::jsonb,
 is_default boolean not null default false,
 updated_at timestamptz default now()
);
create role authenticated nologin;
grant usage on schema public to authenticated;
grant select on public.document_templates to authenticated;
