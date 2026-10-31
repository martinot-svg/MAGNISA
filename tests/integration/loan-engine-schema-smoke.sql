-- Structural security smoke tests for the loan engine.
-- Runs only against the disposable local Supabase database in GitHub Actions.
-- These checks do not insert, update, or delete business data.

do $$
declare
  v_signature text;
  v_proc regprocedure;
  v_expected text[] := array[
    'public.create_loan_schedule(uuid,uuid,jsonb)',
    'public.create_loan_with_schedule(uuid,text,numeric,numeric,date,date,text,text,text,integer,integer,date,text,text,text,text,uuid,jsonb)',
    'public.record_loan_repayment(uuid,uuid,uuid,date,numeric,uuid,uuid,text,text)',
    'public.configure_existing_loan_schedule(uuid,uuid,text,integer,integer,date,date,text,text,text,text,jsonb)',
    'public.add_loan_installment_charges(uuid,uuid,uuid,numeric,numeric,text,uuid)'
  ];
begin
  if to_regclass('public.loan_installments') is null then
    raise exception 'Missing public.loan_installments';
  end if;
  if to_regclass('public.loan_repayments') is null then
    raise exception 'Missing public.loan_repayments';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.loan_installments'::regclass and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on loan_installments';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = 'public.loan_repayments'::regclass and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on loan_repayments';
  end if;

  if not has_table_privilege('authenticated','public.loan_installments','SELECT')
     or has_table_privilege('authenticated','public.loan_installments','INSERT')
     or has_table_privilege('authenticated','public.loan_installments','UPDATE')
     or has_table_privilege('authenticated','public.loan_installments','DELETE') then
    raise exception 'loan_installments must be SELECT-only for authenticated';
  end if;
  if not has_table_privilege('authenticated','public.loan_repayments','SELECT')
     or has_table_privilege('authenticated','public.loan_repayments','INSERT')
     or has_table_privilege('authenticated','public.loan_repayments','UPDATE')
     or has_table_privilege('authenticated','public.loan_repayments','DELETE') then
    raise exception 'loan_repayments must be SELECT-only for authenticated';
  end if;

  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.loan_installments'::regclass
      and polname = 'loan_installments_select'
      and polcmd = 'r'
  ) then
    raise exception 'Missing SELECT RLS policy for loan_installments';
  end if;
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.loan_repayments'::regclass
      and polname = 'loan_repayments_select'
      and polcmd = 'r'
  ) then
    raise exception 'Missing SELECT RLS policy for loan_repayments';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.loan_repayments'::regclass
      and conname = 'loan_repayments_request_key_unique'
      and contype = 'u'
  ) then
    raise exception 'Missing repayment idempotency uniqueness constraint';
  end if;

  foreach v_signature in array v_expected loop
    v_proc := to_regprocedure(v_signature);
    if v_proc is null then
      raise exception 'Missing loan engine RPC: %', v_signature;
    end if;
    if not (select prosecdef from pg_proc where oid = v_proc) then
      raise exception 'Expected SECURITY DEFINER RPC: %', v_signature;
    end if;
    if not has_function_privilege('authenticated', v_proc, 'EXECUTE') then
      raise exception 'authenticated cannot execute loan RPC: %', v_signature;
    end if;
    if has_function_privilege('anon', v_proc, 'EXECUTE') then
      raise exception 'anon can execute protected loan RPC: %', v_signature;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.loans'::regclass
      and conname = 'loans_liability_account_check'
  ) then
    raise exception 'Missing PCG liability-account constraint on loans';
  end if;
end
$$;

select 'loan engine schema and security smoke tests passed' as result;
