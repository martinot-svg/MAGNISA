-- Allow each immutable schedule version to restart installment numbering at 1.
-- Repayments remain linked to their exact historical installment UUID.
begin;

alter table public.loan_installments
  drop constraint if exists loan_installments_number_unique;

create unique index if not exists loan_installments_version_number_unique
  on public.loan_installments (organization_id, loan_id, schedule_version_id, installment_number);

commit;
