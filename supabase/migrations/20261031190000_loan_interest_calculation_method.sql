alter table public.loans
  add column if not exists interest_calculation_method text not null default 'outstanding_balance';

alter table public.loans
  drop constraint if exists loans_interest_calculation_method_check;

alter table public.loans
  add constraint loans_interest_calculation_method_check
  check (interest_calculation_method in ('outstanding_balance', 'original_principal'));

comment on column public.loans.interest_calculation_method is
  'Interest base used to generate the contractual loan schedule. Existing loans default to outstanding_balance; historical installments are not recalculated.';
