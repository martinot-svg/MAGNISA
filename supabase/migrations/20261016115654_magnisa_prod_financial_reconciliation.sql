-- Reconciliations TEST only, with invoker RLS; no source data mutations.
create or replace view public.magnisa_invoice_reconciliation with (security_invoker=true) as
select i.organization_id,i.id invoice_id,i.number,i.status,i.total,i.paid_amount,i.balance_due,
 coalesce(p.amount,0)::numeric(20,2) confirmed_payment_sum,
 (i.total-i.paid_amount-i.balance_due)::numeric(20,2) allocation_difference,
 (i.paid_amount-coalesce(p.amount,0))::numeric(20,2) payment_difference,
 case when abs(i.total-i.paid_amount-i.balance_due)>0.01 then 'allocation_mismatch'
 when abs(i.paid_amount-coalesce(p.amount,0))>0.01 then 'payment_mismatch' else 'ok' end reconciliation_status
from public.invoices i left join lateral
(select sum(amount) amount from public.payments where organization_id=i.organization_id and invoice_id=i.id and status in ('confirmed','reconciled')) p on true;
revoke all on public.magnisa_invoice_reconciliation from public,anon;
grant select on public.magnisa_invoice_reconciliation to authenticated;

create or replace view public.magnisa_supplier_reconciliation with (security_invoker=true) as
select si.organization_id,si.id supplier_invoice_id,si.supplier_number,si.status,si.total,si.paid_amount,si.balance_due,
 coalesce(p.amount,0)::numeric(20,2) payment_sum,
 (si.total-si.paid_amount-si.balance_due)::numeric(20,2) allocation_difference,
 (si.paid_amount-coalesce(p.amount,0))::numeric(20,2) payment_difference,
 case when abs(si.total-si.paid_amount-si.balance_due)>0.01 then 'allocation_mismatch'
 when abs(si.paid_amount-coalesce(p.amount,0))>0.01 then 'payment_mismatch' else 'ok' end reconciliation_status
from public.supplier_invoices si left join lateral
(select sum(amount) amount from public.supplier_payments where organization_id=si.organization_id and supplier_invoice_id=si.id) p on true;
revoke all on public.magnisa_supplier_reconciliation from public,anon;
grant select on public.magnisa_supplier_reconciliation to authenticated;

create or replace view public.magnisa_account_reconciliation with (security_invoker=true) as
select fa.organization_id,fa.id financial_account_id,fa.name,fa.type,fa.balance,
 coalesce(sum(ft.amount),0)::numeric(20,2) movements_sum,
 (fa.balance-coalesce(sum(ft.amount),0))::numeric(20,2) balance_difference,
 case when abs(fa.balance-coalesce(sum(ft.amount),0))>0.01 then 'opening_balance_or_movement_to_review' else 'ok' end reconciliation_status
from public.financial_accounts fa left join public.financial_transactions ft
 on ft.organization_id=fa.organization_id and ft.financial_account_id=fa.id
group by fa.organization_id,fa.id,fa.name,fa.type,fa.balance;
revoke all on public.magnisa_account_reconciliation from public,anon;
grant select on public.magnisa_account_reconciliation to authenticated;
