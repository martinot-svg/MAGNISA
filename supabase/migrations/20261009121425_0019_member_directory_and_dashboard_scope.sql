
-- MAGNISA 0019: protect member directory and scope dashboard metrics by read permissions.

drop policy if exists member_select on public.organization_members;
create policy member_select on public.organization_members
for select to authenticated
using (
  user_id=auth.uid()
  or public.has_org_permission(organization_id,'users.manage')
);

create or replace function public.dashboard_metrics(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_billing boolean;
  v_sales boolean;
  v_treasury boolean;
begin
  perform public.assert_org_access(p_org);

  v_billing := public.has_org_permission(p_org,'billing.view');
  v_sales := public.has_org_permission(p_org,'sales.view');
  v_treasury := public.has_org_permission(p_org,'treasury.view');

  return jsonb_build_object(
    'revenue',
      case when v_billing then coalesce((
        select sum(subtotal) from public.invoices
        where organization_id=p_org and status not in ('draft','cancelled')
      ),0) else 0 end,
    'receipts',
      case when v_treasury then coalesce((
        select sum(amount) from public.payments
        where organization_id=p_org and status in ('confirmed','reconciled')
      ),0) else 0 end,
    'expenses',
      case when v_treasury then coalesce((
        select sum(amount) from public.expenses
        where organization_id=p_org and status in ('validated','paid')
      ),0) else 0 end,
    'receivables',
      case when v_billing then coalesce((
        select sum(balance_due) from public.invoices
        where organization_id=p_org and status not in ('draft','cancelled','paid')
      ),0) else 0 end,
    'cash_available',
      case when v_treasury then coalesce((
        select sum(balance) from public.financial_accounts
        where organization_id=p_org and is_active and type in ('bank','cash','mobile_money')
      ),0) else 0 end,
    'invoice_count',
      case when v_billing then (
        select count(*) from public.invoices where organization_id=p_org
      ) else 0 end,
    'payment_count',
      case when v_treasury then (
        select count(*) from public.payments where organization_id=p_org
      ) else 0 end,
    'expense_count',
      case when v_treasury then (
        select count(*) from public.expenses where organization_id=p_org
      ) else 0 end,
    'overdue_invoice_count',
      case when v_billing then (
        select count(*) from public.invoices
        where organization_id=p_org
          and status not in ('draft','cancelled','paid')
          and balance_due>0
          and due_date<current_date
      ) else 0 end,
    'accepted_quote_count',
      case when v_sales then (
        select count(*) from public.quotes
        where organization_id=p_org and status in ('accepted','converted')
      ) else 0 end
  );
end;
$$;
