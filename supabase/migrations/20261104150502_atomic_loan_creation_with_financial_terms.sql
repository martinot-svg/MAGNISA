begin;

-- Create the loan, lender location and immutable initial financial snapshot in one transaction.
create or replace function public.create_loan_with_schedule_and_lender_atomic(
  p_organization_id uuid,
  p_lender_name text,
  p_lender_category text,
  p_financial_institution_id uuid,
  p_register_new_lender boolean,
  p_principal numeric,
  p_interest_rate numeric,
  p_start_date date,
  p_end_date date,
  p_notes text,
  p_contract_reference text,
  p_repayment_method text,
  p_payment_frequency integer,
  p_total_installments integer,
  p_first_due_date date,
  p_liability_account_code text,
  p_fee_account_code text,
  p_penalty_account_code text,
  p_repayment_allocation_order text,
  p_request_key uuid,
  p_installments jsonb,
  p_interest_type text,
  p_interest_calculation_method text,
  p_lender_location_id uuid,
  p_lender_city text,
  p_lender_region text,
  p_lender_branch_name text,
  p_lender_address text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_loan_id uuid;
  v_institution_id uuid;
  v_schedule_version_id uuid;
  v_financial_terms jsonb;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'finance.view');
  perform public.assert_org_permission(p_organization_id, 'treasury.transfer');

  if p_interest_type not in ('simple', 'compound') then
    raise exception 'Type dâ€™intÃ©rÃªt invalide';
  end if;
  if p_in¶»§q«^