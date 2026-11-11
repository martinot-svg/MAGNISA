-- Preserve the contractual forecast after validation.
-- Operational status and documented fee/penalty adjustments remain mutable.
create or replace function public.guard_loan_installment_contract_terms()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.installment_number is distinct from old.installment_number
     or new.due_date is distinct from old.due_date
     or new.opening_principal is distinct from old.opening_principal
     or new.principal_due is distinct from old.principal_due
     or new.interest_due is distinct from old.interest_due
     or new.closing_principal is distinct from old.closing_principal then
    raise exception 'Les conditions contractuelles de l’échéancier validé sont immuables. Crée une nouvelle version contractuelle pour les modifier.';
  end if;
  return new;
end;
$function$;

drop trigger if exists loan_installments_contract_terms_immutable on public.loan_installments;
create trigger loan_installments_contract_terms_immutable
before update on public.loan_installments
for each row execute function public.guard_loan_installment_contract_terms();

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  v_definition := pg_get_functiondef('public.record_loan_repayment(uuid,uuid,uuid,date,numeric,uuid,uuid,text,text)'::regprocedure);
  if position('v_schedule_balance := v_new_balance;' in v_definition) > 0 then
    v_updated := regexp_replace(
      v_definition,
      '    v_schedule_balance := v_new_balance;[\s\S]*?\n  end if;\n\n  update public.loans',
      $replacement$    -- A partial principal prepayment changes the actual outstanding liability only.
    -- The validated contractual forecast remains untouched. A lender-approved amendment
    -- must be represented by a separate schedule version, never an in-place rewrite.
  end if;

  update public.loans$replacement$
    );
    if v_updated = v_definition then
      raise exception 'Impossible de remplacer le recalcul anticipé de l’échéancier : motif introuvable';
    end if;
    execute v_updated;
  elsif position('A partial principal prepayment changes the actual outstanding liability only.' in v_definition) = 0 then
    raise exception 'Le moteur de remboursement ne correspond pas à une version connue';
  end if;

end;
$migration$;

comment on trigger loan_installments_contract_terms_immutable on public.loan_installments
is 'Protects validated contractual dates and principal/interest schedule amounts from in-place changes. Status and documented charges remain operational fields.';
