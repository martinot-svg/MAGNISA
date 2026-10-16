-- MAGNISA TEST ONLY: read-only payroll reconciliation, under caller's row-level security.
create or replace view public.magnisa_payroll_reconciliation with (security_invoker=true) as
select ps.organization_id, ps.id payslip_id, ps.status, ps.net_pay, ps.paid_amount,
 coalesce(p.total,0)::numeric(20,2) payment_sum,
 (ps.paid_amount-coalesce(p.total,0))::numeric(20,2) payment_difference,
 case
   when ps.net_pay < 0 or ps.paid_amount < 0 or ps.paid_amount > ps.net_pay+0.01 then 'invalid_payroll_balance'
   when abs(ps.paid_amount-coalesce(p.total,0))>0.01 then 'payment_mismatch'
   else 'ok'
 end reconciliation_status
from public.payslips ps
left join lateral (
 select sum(pp.amount) total from public.payroll_payments pp
 where pp.organization_id=ps.organization_id and pp.payslip_id=ps.id
) p on true;
revoke all on public.magnisa_payroll_reconciliation from public,anon;
grant select on public.magnisa_payroll_reconciliation to authenticated;
