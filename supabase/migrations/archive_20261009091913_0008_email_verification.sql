alter table public.email_verifications enable row level security;
create index if not exists email_verifications_user_created_idx on public.email_verifications(user_id,created_at desc);
create index if not exists email_verifications_email_created_idx on public.email_verifications(lower(email),created_at desc);
revoke all on table public.email_verifications from anon, authenticated;