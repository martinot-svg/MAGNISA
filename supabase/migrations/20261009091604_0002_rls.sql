create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='active');
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
create policy org_select on public.organizations for select using(public.is_org_member(id));
create policy member_select on public.organization_members for select using(user_id=auth.uid() or public.is_org_member(organization_id));

do $$
declare t text;
begin
  foreach t in array array[
    'company_settings','number_sequences','customers','prospects','services','quotes','quote_lines','invoices','invoice_lines',
    'financial_accounts','payments','expenses','financial_transactions','journal_entries','journal_entry_lines','tax_obligations',
    'social_obligations','budgets','analysis_actions','document_templates','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I_select on public.%I for select using(public.is_org_member(organization_id))',t,t);
    execute format('create policy %I_insert on public.%I for insert with check(public.is_org_member(organization_id))',t,t);
    execute format('create policy %I_update on public.%I for update using(public.is_org_member(organization_id)) with check(public.is_org_member(organization_id))',t,t);
  end loop;
end $$;