-- Behavioral tests for fiscal-year opening, overlap protection, carry-forward and closing.
-- All fixtures and generated journal entries are rolled back.
begin;

do $test$
declare
  v_org uuid := gen_random_uuid();
  v_org_zero uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_year_2025 uuid;
  v_year_2026 uuid;
  v_opening_entry uuid;
  v_error text;
  v_status text;
  v_debit numeric;
  v_credit numeric;
  v_lines jsonb := '[
    {"account_kind":"pcg","pcg_code":"101","debit":0,"credit":100000},
    {"account_kind":"pcg","pcg_code":"512","debit":100000,"credit":0}
  ]'::jsonb;
begin
  insert into auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values (
    v_owner,'authenticated','authenticated',
    v_owner::text||'@fiscal-year.test','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
  );

  insert into public.organizations(id,name)
  values(v_org,'Fiscal year opening and closing test');

  insert into public.organization_members(organization_id,user_id,role,status)
  values(v_org,v_owner,'owner','active');

  insert into public.organizations(id,name) values(v_org_zero,'New entity without opening balances');
  insert into public.organization_members(organization_id,user_id,role,status)
  values(v_org_zero,v_owner,'owner','active');

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_owner,'role','authenticated')::text,
    true
  );

  -- A newly formed entity with no pre-period postings may open its first year without artificial opening entries.
  v_year_2025 := public.magnisa_create_fiscal_year(
    v_org_zero,date '2025-01-01',date '2025-12-31','FY 2025 - zero opening balances',null
  );
  if (select opening_entry_id from public.accounting_fiscal_years where id=v_year_2025) is not null then
    raise exception 'TEST FAILED: zero-opening first year unexpectedly created an opening journal';
  end if;

  -- Unbalanced opening entries must be rejected without creating an exercise.
  v_error := null;
  begin
    perform public.magnisa_create_fiscal_year(
      v_org,date '2025-01-01',date '2025-12-31','FY 2025 unbalanced',
      '[{"account_kind":"pcg","pcg_code":"101","debit":0,"credit":100000},
        {"account_kind":"pcg","pcg_code":"512","debit":90000,"credit":0}]'::jsonb
    );
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is null or v_error not like 'Les soldes initiaux doivent être équilibrés%' then
    raise exception 'TEST FAILED: unbalanced opening entries were not rejected: %',v_error;
  end if;

  -- A balanced first exercise creates one traceable opening journal.
  v_year_2025 := public.magnisa_create_fiscal_year(
    v_org,date '2025-01-01',date '2025-12-31','FY 2025',v_lines
  );
  select opening_entry_id into v_opening_entry
    from public.accounting_fiscal_years
   where id=v_year_2025 and organization_id=v_org;
  if v_opening_entry is null then
    raise exception 'TEST FAILED: first fiscal year has no opening journal';
  end if;

  select round(sum(debit),2),round(sum(credit),2)
    into v_debit,v_credit
    from public.journal_entry_lines
   where organization_id=v_org and journal_entry_id=v_opening_entry;
  if v_debit <> 100000 or v_credit <> 100000 then
    raise exception 'TEST FAILED: opening journal is not balanced: debit %, credit %',v_debit,v_credit;
  end if;

  -- Overlapping fiscal years are rejected.
  v_error := null;
  begin
    perform public.magnisa_create_fiscal_year(
      v_org,date '2025-06-01',date '2026-05-31','Overlapping FY',null
    );
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is null or v_error not like 'Cet exercice chevauche un exercice déjà enregistré%' then
    raise exception 'TEST FAILED: overlapping fiscal year was not rejected: %',v_error;
  end if;

  -- A following year cannot be opened before the previous year is closed.
  v_error := null;
  begin
    perform public.magnisa_create_fiscal_year(
      v_org,date '2026-01-01',date '2026-12-31','FY 2026',null
    );
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is null or v_error not like 'Clôture d’abord l’exercice précédent%' then
    raise exception 'TEST FAILED: next fiscal year opened before prior close: %',v_error;
  end if;

  -- Closing a completed year is allowed and locks its period.
  perform public.magnisa_close_fiscal_year(v_org,v_year_2025);
  select status into v_status from public.accounting_fiscal_years where id=v_year_2025;
  if v_status <> 'closed' then
    raise exception 'TEST FAILED: completed fiscal year was not closed';
  end if;
  if not exists (
    select 1 from public.accounting_periods
     where organization_id=v_org and period_start=date '2025-01-01'
       and period_end=date '2025-12-31' and status='closed'
  ) then
    raise exception 'TEST FAILED: closed fiscal year did not lock its accounting period';
  end if;

  -- The following year receives the balance-sheet balances automatically.
  v_year_2026 := public.magnisa_create_fiscal_year(
    v_org,date '2026-01-01',date '2026-12-31','FY 2026',null
  );
  select opening_entry_id into v_opening_entry
    from public.accounting_fiscal_years
   where id=v_year_2026 and organization_id=v_org;
  if v_opening_entry is null then
    raise exception 'TEST FAILED: following fiscal year did not receive carry-forward entries';
  end if;

  select round(sum(debit),2),round(sum(credit),2)
    into v_debit,v_credit
    from public.journal_entry_lines
   where organization_id=v_org and journal_entry_id=v_opening_entry;
  if v_debit <> 100000 or v_credit <> 100000 then
    raise exception 'TEST FAILED: carry-forward journal is not balanced: debit %, credit %',v_debit,v_credit;
  end if;

  -- Future periods cannot be closed early, even if the UI submits the action.
  v_error := null;
  begin
    perform public.magnisa_close_fiscal_year(v_org,v_year_2026);
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is null or v_error not like 'Clôture impossible avant la fin de l’exercice%' then
    raise exception 'TEST FAILED: future fiscal year was closed early: %',v_error;
  end if;
  select status into v_status from public.accounting_fiscal_years where id=v_year_2026;
  if v_status <> 'open' then
    raise exception 'TEST FAILED: rejected early close changed fiscal-year status';
  end if;
end
$test$;

rollback;
