create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  account_status text not null default 'pending_verification'
    check (account_status in ('pending_verification','active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "User can read own profile" on public.profiles;
drop policy if exists "User can update own profile" on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated using (id = auth.uid());

revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create or replace function public.sync_auth_profile()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.profiles(id,email,account_status,created_at,updated_at)
  values(
    new.id,
    coalesce(new.email,''),
    case when new.email_confirmed_at is not null then 'active' else 'pending_verification' end,
    coalesce(new.created_at,now()),
    now()
  )
  on conflict(id) do update set
    email=excluded.email,
    account_status=case
      when public.profiles.account_status='suspended' then 'suspended'
      when new.email_confirmed_at is not null then 'active'
      else 'pending_verification'
    end,
    updated_at=now();
  return new;
end;
$$;

drop trigger if exists auth_user_profile_sync on auth.users;
create trigger auth_user_profile_sync
after insert or update of email,email_confirmed_at on auth.users
for each row execute function public.sync_auth_profile();

insert into public.profiles(id,email,account_status,created_at,updated_at)
select id,coalesce(email,''),case when email_confirmed_at is not null then 'active' else 'pending_verification' end,created_at,now()
from auth.users
on conflict(id) do nothing;

alter table if exists public.email_verifications enable row level security;
revoke all on table public.email_verifications from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'quotes','quote_lines','orders','order_lines','invoices','invoice_lines','credit_notes','payments',
    'supplier_invoices','supplier_payments','expenses','financial_transactions','journal_entries','journal_entry_lines',
    'tax_obligations','social_obligations','payroll_runs','payslips','payroll_payments','salary_advances',
    'loans','partner_account_movements','audit_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I',t||'_delete',t);
    execute format('revoke delete on table public.%I from authenticated',t);
  end loop;
end $$;