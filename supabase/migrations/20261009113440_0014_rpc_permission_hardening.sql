
create or replace function public.has_org_permission(p_org uuid, p_permission text)
returns boolean
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_role text;
  v_override boolean;
begin
  if auth.uid() is null then return false; end if;

  select role into v_role
  from public.organization_members
  where organization_id=p_org
    and user_id=auth.uid()
    and status='active'
  limit 1;

  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;

  select allowed into v_override
  from public.role_permissions
  where organization_id=p_org
    and role=v_role
    and permission_key=p_permission
  limit 1;

  if found then return coalesce(v_override,false); end if;

  return case v_role
    when 'admin' then p_permission = any(array[
      'customers.create','services.create','quotes.create','quotes.edit','quotes.accept',
      'orders.manage','invoices.create','invoices.issue','invoices.cancel','payments.record',
      'expenses.record','treasury.transfer','suppliers.manage','payroll.manage','payroll.pay',
      'accounting.manage','reports.export','settings.manage','users.manage','audit.view'
    ])
    when 'director' then p_permission = any(array[
      'customers.create','services.create','quotes.create','quotes.edit','quotes.accept',
      'orders.manage','invoices.create','invoices.issue','payments.record','expenses.record',
      'treasury.transfer','suppliers.manage','reports.export','audit.view'
    ])
    when 'finance_manager' then p_permission = any(array[
      'invoices.issue','invoices.cancel','payments.record','expenses.record','treasury.transfer',
      'suppliers.manage','payroll.pay','accounting.manage','reports.export','audit.view'
    ])
    when 'accountant' then p_permission = any(array[
      'invoices.issue','payments.record','expenses.record','suppliers.manage','payroll.manage',
      'accounting.manage','reports.export','audit.view'
    ])
    when 'sales' then p_permission = any(array[
      'customers.create','services.create','quotes.create','quotes.edit'
    ])
    when 'cashier' then p_permission = any(array['payments.record','expenses.record'])
    when 'hr' then p_permission = any(array['payroll.manage'])
    when 'auditor' then p_permission = any(array['reports.export','audit.view'])
    else false
  end;
end
$$;

create or replace function public.assert_org_permission(p_org uuid,p_permission text)
returns void
language plpgsql
security definer
set search_path='public'
as $$
begin
  if not public.has_org_permission(p_org,p_permission) then
    raise exception 'Action non autorisée pour ce rôle';
  end if;
end
$$;

revoke all on function public.has_org_permission(uuid,text) from public,anon,authenticated;
revoke all on function public.assert_org_permission(uuid,text) from public,anon,authenticated;

do $$
declare
  r record;
  v_def text;
  v_perm text;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as defn
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'accept_quote','add_invoice_line_from_service','add_quote_line_from_service',
        'cancel_invoice','convert_order_to_invoice','convert_quote_to_invoice',
        'convert_quote_to_order','create_direct_invoice_from_service',
        'create_quote_from_service','duplicate_quote','issue_invoice','record_expense',
        'record_invoice_payment','record_payroll_payment','record_supplier_payment','transfer_funds'
      )
  loop
    v_perm := case r.proname
      when 'accept_quote' then 'quotes.accept'
      when 'add_invoice_line_from_service' then 'invoices.create'
      when 'add_quote_line_from_service' then 'quotes.edit'
      when 'cancel_invoice' then 'invoices.cancel'
      when 'convert_order_to_invoice' then 'invoices.create'
      when 'convert_quote_to_invoice' then 'invoices.create'
      when 'convert_quote_to_order' then 'orders.manage'
      when 'create_direct_invoice_from_service' then 'invoices.create'
      when 'create_quote_from_service' then 'quotes.create'
      when 'duplicate_quote' then 'quotes.create'
      when 'issue_invoice' then 'invoices.issue'
      when 'record_expense' then 'expenses.record'
      when 'record_invoice_payment' then 'payments.record'
      when 'record_payroll_payment' then 'payroll.pay'
      when 'record_supplier_payment' then 'suppliers.manage'
      when 'transfer_funds' then 'treasury.transfer'
    end;

    if position('perform public.assert_org_permission(p_org' in lower(r.defn)) = 0 then
      v_def := replace(
        r.defn,
        'perform public.assert_org_access(p_org);',
        'perform public.assert_org_access(p_org);' || E'\n  ' ||
        'perform public.assert_org_permission(p_org,' || quote_literal(v_perm) || ');'
      );
      execute v_def;
    end if;
  end loop;
end
$$;

-- Reapply least-privilege execution after CREATE OR REPLACE.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on function public.has_org_permission(uuid,text) from authenticated;
revoke execute on function public.assert_org_permission(uuid,text) from authenticated;
