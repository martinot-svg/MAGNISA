-- End-to-end transactional tests for the loan repayment engine.
-- Runs only against the ephemeral Supabase database created by CI.
-- Every fixture is enclosed in a transaction and rolled back at the end.

begin;

do $loan_test$
declare
  v_org uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_account uuid;
  v_loan uuid;
  v_second_loan uuid;
  v_installment_1 uuid;
  v_installment_2 uuid;
  v_second_installment uuid;
  v_create_key uuid := gen_random_uuid();
  v_first_key uuid := gen_random_uuid();
  v_second_key uuid := gen_random_uuid();
  v_third_key uuid := gen_random_uuid();
  v_failed_key uuid := gen_random_uuid();
  v_first_payment uuid;
  v_replayed_payment uuid;
  v_balance_before numeric(18,2);
  v_balance_after numeric(18,2);
  v_count integer;
  v_error text;
begin
  -- A synthetic authenticated owner is sufficient for the real SECURITY DEFINER RPCs.
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user, 'authenticated', 'authenticated',
    'loan-engine-' || replace(v_user::text, '-', '') || '@example.invalid',
    '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

  insert into public.organizations(id, name, currency)
  values (v_org, 'MAGNISA loan engine integration test', 'MGA');

  insert into public.organization_members(organization_id, user_id, role, status)
  values (v_org, v_user, 'owner', 'active');

  perform set_config('request.jwt.claim.sub', v_user::text, true);

  insert into public.financial_accounts(organization_id, name, type, balance, is_active)
  values (v_org, 'Compte bancaire de test', 'bank', 10000, true)
  returning id into v_account;

  -- Create a real two-installment loan and schedule through the production RPC.
  v_loan := public.create_loan_with_schedule(
    v_org,
    'Banque de test',
    1000,
    12,
    date '2026-10-01',
    date '2026-12-30',
    'Fixture transactionnelle',
    'LOAN-ENGINE-TEST-001',
    'equal_principal',
    12,
    2,
    date '2026-11-30',
    '164',
    null,
    null,
    'charges_first',
    v_create_key,
    jsonb_build_array(
      jsonb_build_object(
        'number', 1, 'dueDate', '2026-11-30',
        'openingPrincipal', 1000, 'principal', 500,
        'interest', 10, 'payment', 510, 'closingPrincipal', 500
      ),
      jsonb_build_object(
        'number', 2, 'dueDate', '2026-12-30',
        'openingPrincipal', 500, 'principal', 500,
        'interest', 5, 'payment', 505, 'closingPrincipal', 0
      )
    )
  );

  select id into strict v_installment_1
  from public.loan_installments
  where organization_id = v_org and loan_id = v_loan and installment_number = 1;

  select id into strict v_installment_2
  from public.loan_installments
  where organization_id = v_org and loan_id = v_loan and installment_number = 2;

  -- Partial payment: interest is allocated before principal under charges_first.
  v_first_payment := public.record_loan_repayment(
    v_org, v_loan, v_installment_1, current_date, 100,
    v_account, v_first_key, 'LOAN-TEST-PART-001', 'Premier versement partiel'
  );

  if not exists (
    select 1 from public.loan_repayments
    where id = v_first_payment and amount = 100
      and interest_paid = 10 and principal_paid = 90
      and fees_paid = 0 and penalty_paid = 0 and status = 'posted'
  ) then
    raise exception 'TEST FAILED: partial payment allocation is incorrect';
  end if;

  -- Idempotent replay must return the original repayment without duplicating movements.
  v_replayed_payment := public.record_loan_repayment(
    v_org, v_loan, v_installment_1, current_date, 100,
    v_account, v_first_key, 'LOAN-TEST-PART-001', 'Premier versement partiel'
  );

  if v_replayed_payment <> v_first_payment then
    raise exception 'TEST FAILED: idempotent replay returned a different repayment';
  end if;

  select count(*) into v_count
  from public.loan_repayments
  where organization_id = v_org and loan_id = v_loan;
  if v_count <> 1 then
    raise exception 'TEST FAILED: idempotent replay duplicated the repayment';
  end if;

  -- Reusing a key with a different payload must be rejected.
  begin
    perform public.record_loan_repayment(
      v_org, v_loan, v_installment_1, current_date, 101,
      v_account, v_first_key, 'LOAN-TEST-PART-001', 'Payload différent'
    );
    raise exception 'TEST FAILED: idempotency key accepted a different payload';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error like 'TEST FAILED:%' then raise; end if;
    if position('Clé de requête déjà utilisée' in v_error) = 0 then
      raise exception 'TEST FAILED: unexpected idempotency error: %', v_error;
    end if;
  end;

  -- An overpayment must fail without changing any financial state.
  select balance into v_balance_before
  from public.financial_accounts where id = v_account;

  begin
    perform public.record_loan_repayment(
      v_org, v_loan, v_installment_1, current_date, 411,
      v_account, v_second_key, 'LOAN-TEST-OVER-001', 'Tentative de dépassement'
    );
    raise exception 'TEST FAILED: installment overpayment was accepted';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error like 'TEST FAILED:%' then raise; end if;
    if position('dépasse le solde de cette échéance' in v_error) = 0 then
      raise exception 'TEST FAILED: unexpected overpayment error: %', v_error;
    end if;
  end;

  select balance into v_balance_after
  from public.financial_accounts where id = v_account;

  if v_balance_after <> v_balance_before then
    raise exception 'TEST FAILED: rejected overpayment changed treasury balance';
  end if;

  -- Settle the remaining balance of installment 1 and all of installment 2.
  perform public.record_loan_repayment(
    v_org, v_loan, v_installment_1, current_date, 410,
    v_account, v_second_key, 'LOAN-TEST-SETTLE-001', 'Solde de la première échéance'
  );

  perform public.record_loan_repayment(
    v_org, v_loan, v_installment_2, current_date, 505,
    v_account, v_third_key, 'LOAN-TEST-SETTLE-002', 'Règlement de la deuxième échéance'
  );

  if exists (
    select 1 from public.loan_installments
    where organization_id = v_org and loan_id = v_loan and status <> 'paid'
  ) then
    raise exception 'TEST FAILED: fully settled installments are not marked paid';
  end if;

  if not exists (
    select 1 from public.loans
    where id = v_loan and organization_id = v_org
      and outstanding_principal = 0 and status = 'paid'
  ) then
    raise exception 'TEST FAILED: loan principal/status was not fully settled';
  end if;

  select balance into v_balance_after
  from public.financial_accounts where id = v_account;
  if v_balance_after <> 8985 then
    raise exception 'TEST FAILED: treasury balance mismatch, expected 8985, got %', v_balance_after;
  end if;

  select count(*) into v_count
  from public.financial_transactions
  where organization_id = v_org and source_type = 'loan_repayment';
  if v_count <> 3 then
    raise exception 'TEST FAILED: expected 3 treasury transactions, got %', v_count;
  end if;

  select count(*) into v_count
  from public.journal_entries
  where organization_id = v_org and source_type = 'loan_repayment'
    and status = 'posted' and total_debit = total_credit;
  if v_count <> 3 then
    raise exception 'TEST FAILED: expected 3 balanced posted journal entries, got %', v_count;
  end if;

  if exists (
    select 1
    from public.journal_entries e
    left join public.journal_entry_lines l
      on l.journal_entry_id = e.id and l.organization_id = e.organization_id
    where e.organization_id = v_org and e.source_type = 'loan_repayment'
    group by e.id, e.total_debit, e.total_credit
    having coalesce(sum(l.debit), 0) <> e.total_debit
       or coalesce(sum(l.credit), 0) <> e.total_credit
  ) then
    raise exception 'TEST FAILED: journal lines do not reconcile with journal totals';
  end if;

  -- Force a journal posting failure after the repayment and cash writes have begun.
  -- PostgreSQL must roll back the repayment, cash movement, journal and idempotency row.
  v_second_loan := public.create_loan_with_schedule(
    v_org,
    'Banque de test rollback',
    1000,
    12,
    date '2026-10-01',
    date '2026-11-30',
    'Fixture de rollback',
    'LOAN-ENGINE-TEST-ROLLBACK',
    'annuity',
    12,
    1,
    date '2026-11-30',
    '164',
    null,
    null,
    'charges_first',
    v_failed_key,
    jsonb_build_array(
      jsonb_build_object(
        'number', 1, 'dueDate', '2026-11-30',
        'openingPrincipal', 1000, 'principal', 1000,
        'interest', 10, 'payment', 1010, 'closingPrincipal', 0
      )
    )
  );

  select id into strict v_second_installment
  from public.loan_installments
  where organization_id = v_org and loan_id = v_second_loan and installment_number = 1;

  select balance into v_balance_before
  from public.financial_accounts where id = v_account;

  begin
    delete from public.pcg2005_accounts where code = '661';

    perform public.record_loan_repayment(
      v_org, v_second_loan, v_second_installment, current_date, 1010,
      v_account, gen_random_uuid(), 'LOAN-TEST-ROLLBACK-001', 'Doit être annulé'
    );

    raise exception 'TEST FAILED: posting unexpectedly succeeded without PCG 661';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error like 'TEST FAILED:%' then raise; end if;
    if position('Compte PCG invalide ou absent: 661' in v_error) = 0 then
      raise exception 'TEST FAILED: unexpected forced posting error: %', v_error;
    end if;
  end;

  select balance into v_balance_after
  from public.financial_accounts where id = v_account;

  if v_balance_after <> v_balance_before then
    raise exception 'TEST FAILED: failed journal posting did not roll back treasury balance';
  end if;

  if exists (
    select 1 from public.loan_repayments
    where organization_id = v_org and loan_id = v_second_loan
  ) then
    raise exception 'TEST FAILED: failed journal posting left a repayment row';
  end if;

  if exists (
    select 1 from public.financial_transactions t
    join public.loan_repayments r
      on r.id = t.source_id and r.organization_id = t.organization_id
    where t.organization_id = v_org and t.source_type = 'loan_repayment'
      and r.loan_id = v_second_loan
  ) then
    raise exception 'TEST FAILED: failed journal posting left a treasury transaction';
  end if;

  select count(*) into v_count
  from public.journal_entries
  where organization_id = v_org and source_type = 'loan_repayment';
  if v_count <> 3 then
    raise exception 'TEST FAILED: failed journal posting left an extra journal entry';
  end if;

  if not exists (select 1 from public.pcg2005_accounts where code = '661') then
    raise exception 'TEST FAILED: rollback did not restore the PCG catalog fixture';
  end if;

  raise notice 'PASS: loan creation, partial/full repayment, allocation, idempotency, overpayment rejection, journal balancing and atomic rollback';
end;
$loan_test$;

rollback;
