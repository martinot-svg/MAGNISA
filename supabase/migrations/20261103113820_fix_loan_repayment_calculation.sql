-- Align partial early repayment recalculation with the contract's interest basis.
-- The approved allocation order is fees, penalties, interest, then principal.

create or replace function public.loan_period_interest(
  p_interest_calculation_method text,
  p_original_principal numeric,
  p_opening_principal numeric,
  p_periodic_rate numeric
) returns numeric
language plpgsql
immutable
set search_path = public
as $function$
begin
  if p_interest_calculation_method not in ('outstanding_balance', 'original_principal') then
    raise exception 'Méthode de calcul des intérêts invalide';
  end if;
  if p_original_principal < 0 or p_opening_principal < 0 or p_periodic_rate < 0 then
    raise exception 'Base ou taux d’intérêt invalide';
  end if;

  return round(
    case
      when p_interest_calculation_method = 'original_principal' then p_original_principal
      else p_opening_principal
    end * p_periodic_rate,
    2
  );
end;
$function$;

create or replace function public.loan_allocate_repayment(
  p_amount numeric,
  p_fees_due numeric,
  p_penalty_due numeric,
  p_interest_due numeric,
  p_principal_due numeric
) returns table (
  fees_paid numeric,
  penalty_paid numeric,
  interest_paid numeric,
  principal_paid numeric
)
language plpgsql
immutable
set search_path = public
as $function$
declare
  v_left numeric(20,2);
begin
  if p_amount is null or p_amount <= 0
     or p_fees_due < 0 or p_penalty_due < 0
     or p_interest_due < 0 or p_principal_due < 0 then
    raise exception 'Montant ou composantes du remboursement invalides';
  end if;
  if p_amount > p_fees_due + p_penalty_due + p_interest_due + p_principal_due then
    raise exception 'Le paiement dépasse le solde de l’échéance';
  end if;

  v_left := round(p_amount, 2);
  fees_paid := least(v_left, round(p_fees_due, 2));
  v_left := v_left - fees_paid;
  penalty_paid := least(v_left, round(p_penalty_due, 2));
  v_left := v_left - penalty_paid;
  interest_paid := least(v_left, round(p_interest_due, 2));
  v_left := v_left - interest_paid;
  principal_paid := least(v_left, round(p_principal_due, 2));
  return next;
end;
$function$;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef(
    'public.record_loan_repayment(uuid,uuid,uuid,date,numeric,uuid,uuid,text,text)'::regprocedure
  );

  v_old := $old$      v_schedule_interest := round(v_schedule_balance * v_periodic_rate,2);$old$;
  v_new := $new$      v_schedule_interest := public.loan_period_interest(
          coalesce(v_loan.interest_calculation_method, 'outstanding_balance'),
          v_loan.principal,
          v_schedule_balance,
          v_periodic_rate
        );$new$;
  if position(v_old in v_definition) = 0 then
    raise exception 'Impossible de localiser le calcul des intérêts dans record_loan_repayment';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$        elsif v_loan.repayment_method = 'equal_principal' then$old$;
  v_new := $new$        elsif v_loan.repayment_method = 'equal_principal'
           or v_loan.interest_calculation_method = 'original_principal' then$new$;
  if position(v_old in v_definition) = 0 then
    raise exception 'Impossible de localiser la règle de remboursement du capital';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$    -- Apply the allocation order explicitly stored on the signed loan contract.
    v_left := p_amount;
    if v_loan.repayment_allocation_order = 'charges_first' then
      v_paid_fees := least(v_left, v_remaining_fees); v_left := v_left - v_paid_fees;
      v_paid_penalty := least(v_left, v_remaining_penalty); v_left := v_left - v_paid_penalty;
      v_paid_interest := least(v_left, v_remaining_interest); v_left := v_left - v_paid_interest;
      v_paid_principal := least(v_left, v_remaining_principal); v_left := v_left - v_paid_principal;
    elsif v_loan.repayment_allocation_order = 'interest_first' then
      v_paid_interest := least(v_left, v_remaining_interest); v_left := v_left - v_paid_interest;
      v_paid_fees := least(v_left, v_remaining_fees); v_left := v_left - v_paid_fees;
      v_paid_penalty := least(v_left, v_remaining_penalty); v_left := v_left - v_paid_penalty;
      v_paid_principal := least(v_left, v_remaining_principal); v_left := v_left - v_paid_principal;
    else
      v_paid_principal := least(v_left, v_remaining_principal); v_left := v_left - v_paid_principal;
      v_paid_interest := least(v_left, v_remaining_interest); v_left := v_left - v_paid_interest;
      v_paid_fees := least(v_left, v_remaining_fees); v_left := v_left - v_paid_fees;
      v_paid_penalty := least(v_left, v_remaining_penalty); v_left := v_left - v_paid_penalty;
    end if;$old$;
  v_new := $new$    -- Use the shared, tested allocation rule: fees, penalties, interest, principal.
    select a.fees_paid, a.penalty_paid, a.interest_paid, a.principal_paid
    into v_paid_fees, v_paid_penalty, v_paid_interest, v_paid_principal
    from public.loan_allocate_repayment(
      p_amount,
      v_remaining_fees,
      v_remaining_penalty,
      v_remaining_interest,
      v_remaining_principal
    ) a;$new$;
  if position(v_old in v_definition) = 0 then
    raise exception 'Impossible de localiser l’ordre d’imputation des remboursements';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end;
$migration$;

-- Existing production records were checked: all currently use charges_first.
-- Restrict future contracts to the approved allocation policy at database level.
alter table public.loans
  drop constraint if exists loans_repayment_allocation_order_check;

alter table public.loans
  add constraint loans_repayment_allocation_order_check
  check (repayment_allocation_order = 'charges_first');

-- Guard the two financial calculation bases with deterministic database assertions.
do $tests$
begin
  if public.loan_period_interest('original_principal', 1000000, 850000, 0.01) <> 10000 then
    raise exception 'Échec du test : intérêt sur capital initial';
  end if;
  if public.loan_period_interest('outstanding_balance', 1000000, 850000, 0.01) <> 8500 then
    raise exception 'Échec du test : intérêt sur capital restant dû';
  end if;

  if not exists (
    select 1
    from public.loan_allocate_repayment(50000, 5000, 10000, 10000, 85000) a
    where a.fees_paid = 5000
      and a.penalty_paid = 10000
      and a.interest_paid = 10000
      and a.principal_paid = 25000
  ) then
    raise exception 'Échec du test : ordre d’imputation frais, pénalités, intérêts, capital';
  end if;
end;
$tests$;

revoke all on function public.loan_period_interest(text,numeric,numeric,numeric) from public, anon;
grant execute on function public.loan_period_interest(text,numeric,numeric,numeric) to authenticated;
revoke all on function public.loan_allocate_repayment(numeric,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.loan_allocate_repayment(numeric,numeric,numeric,numeric,numeric) to authenticated;
