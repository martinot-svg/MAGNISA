-- Verify the legal-source archive remains private and service_role-only.
do $$
declare
  v_rls boolean;
begin
  select c.relrowsecurity into v_rls
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relname='payroll_legal_documents';

  if not coalesce(v_rls,false) then
    raise exception 'TEST FAILED: payroll_legal_documents must have RLS enabled';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname='public'
       and tablename='payroll_legal_documents'
  ) then
    raise exception 'TEST FAILED: private legal archive must not expose row policies';
  end if;

  if has_table_privilege('anon','public.payroll_legal_documents','SELECT')
     or has_table_privilege('anon','public.payroll_legal_documents','INSERT')
     or has_table_privilege('authenticated','public.payroll_legal_documents','SELECT')
     or has_table_privilege('authenticated','public.payroll_legal_documents','INSERT') then
    raise exception 'TEST FAILED: legal archive is accessible to anon or authenticated';
  end if;

  if not has_table_privilege('service_role','public.payroll_legal_documents','SELECT')
     or not has_table_privilege('service_role','public.payroll_legal_documents','INSERT')
     or not has_table_privilege('service_role','public.payroll_legal_documents','UPDATE')
     or not has_table_privilege('service_role','public.payroll_legal_documents','DELETE') then
    raise exception 'TEST FAILED: service_role must retain full access to the legal archive';
  end if;
end;
$$;
