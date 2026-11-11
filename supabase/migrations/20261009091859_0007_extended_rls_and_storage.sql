do $$
declare t text;
begin
  foreach t in array array[
    'organization_features','projects','orders','order_lines','suppliers','supplier_invoices','supplier_payments','credit_notes','cheques',
    'employees','payroll_runs','payslips','salary_advances','payroll_payments','fixed_assets','loans','partner_accounts','partner_account_movements'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_select',t);
    execute format('create policy %I on public.%I for select using(public.is_org_member(organization_id))',t||'_select',t);
    execute format('drop policy if exists %I on public.%I',t||'_insert',t);
    execute format('create policy %I on public.%I for insert with check(public.is_org_member(organization_id))',t||'_insert',t);
    execute format('drop policy if exists %I on public.%I',t||'_update',t);
    execute format('create policy %I on public.%I for update using(public.is_org_member(organization_id)) with check(public.is_org_member(organization_id))',t||'_update',t);
  end loop;
end $$;

drop policy if exists "org members read branding" on storage.objects;
create policy "org members read branding" on storage.objects for select to authenticated
using (bucket_id='organization-branding' and public.is_org_member((storage.foldername(name))[1]::uuid));

drop policy if exists "org members upload branding" on storage.objects;
create policy "org members upload branding" on storage.objects for insert to authenticated
with check (bucket_id='organization-branding' and public.is_org_member((storage.foldername(name))[1]::uuid));

drop policy if exists "org members update branding" on storage.objects;
create policy "org members update branding" on storage.objects for update to authenticated
using (bucket_id='organization-branding' and public.is_org_member((storage.foldername(name))[1]::uuid))
with check (bucket_id='organization-branding' and public.is_org_member((storage.foldername(name))[1]::uuid));