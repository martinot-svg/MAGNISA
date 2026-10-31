-- Total early closure of a loan.
-- This operation settles the outstanding principal plus explicitly supplied
-- accrued interest, fees/indemnities and penalties from the lender statement.
-- Future unaccrued interest is never estimated or charged automatically.
-- Any due/overdue installment must be settled first through record_loan_repayment.

drop function if exists public.close_loan_early(uuid,uuid,date,uuid,uuid,text,text);

create or replace function public.close_loan_early(
  p_organization_id uuid,
  p_loan_id uuid,
  p_payment_date date,
  p_financial_account_id uuid,
  p_interest_amount numeric,
  p_fees_amount numeric,
  p_penalty_amount numeric,
  p_request_key uuid,
  p_payment_reference text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_loan public.loans%rowtype;
  v_account public.financial_accounts%rowtype;
  v_idempotency public.lot1_financial_idempotency%rowtype;
  v_repayment_id uuid;
  v_transaction_id uuid;
  v_journal_id uuid;
  v_reference text;
  v_digest text;
  v_amount numeric(20,2);
  v_principal numeric(20,2);
  v_interest numeric(20,2);
  v_fees numeric(20,2);
  v_penalty numeric(20,2);
  v_lines jsonb := '[]'::jsonb;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'treasury.transfer');

  if p_request_key is null then
    raise exception 'Clé de requête obligatoire';
  end if;
  if p_payment_date is null or p_payment_date > current_date then
    raise exception 'La date de paiement doit être renseignée et ne peut pas être future';
  end if;
  if coalesce(p_interest_amount,0) < 0
     or coalesce(p_fees_amount,0) < 0
     or coalesce(p_penalty_amount,0) < 0
     or round(coalesce(p_interest_amount,0),2) <> coalesce(p_interest_amount,0)
     or round(coalesce(p_fees_amount,0),2) <> coalesce(p_fees_amount,0)
     or round(coalesce(p_penalty_amount,0),2) <> coalesce(p_penalty_amount,0) then
    raise exception 'Intérêts, frais et pénalités doivent être positifs ou nuls, à deux décimales maximum';
  end if;

  v_digest := md5(jsonb_build_array(
    p_organization_id, p_loan_id, p_payment_date, p_financial_account_id,
    p_interest_amount, p_fees_amount, p_penalty_amount, p_payment_reference, p_notes
  )::text);

  insert into public.lot1_financial_idempotency(
    organization_id, request_key, operation_type, request_digest
  ) values (
    p_organization_id, p_request_key, 'loan_early_closure', v_digest
  ) on conflict (organization_id, request_key) do nothing;

  select * into strict v_idempotency
  from public.lot1_financial_idempotency
  where organization_id = p_organization_id
    and request_key = p_request_key
  for update;

  if v_idempotency.operation_type <> 'loan_early_closure'
     or v_idempotency.request_digest <> v_digest then
    raise exception 'Clé de requête déjà utilisée pour une autre opération';
  end if;
  if v_idempotency.result_id is not null then
    return v_idempotency.result_id;
  end if;

  select * into v_loan
  from public.loans
  where id = p_loan_id
    and organization_id = p_organization_id
  for update;

  if not found or v_loan.status <> 'active' then
    raise exception 'Emprunt introuvable ou non actif';
  end if;
  if p_payment_date < v_loan.start_date then
    raise exception 'La date de clôture précède la date de départ du contrat';
  end if;
  if v_loan.liability_account_code is null
     or v_loan.liability_account_code not in ('164','168') then
    raise exception 'Le compte de dette PCG doit être configuré sur le contrat';
  end if;

  if exists (
    select 1
    from public.loan_installments
    where loan_id = p_loan_id
      and organization_id = p_organization_id
      and (status = 'overdue' or (due_date <= p_payment_date and status in ('planned','partial')))
  ) then
    raise exception 'Règle d’abord les échéances arrivées à terme avant la clôture anticipée';
  end if;

  if exists (
    select 1
    from public.loan_repayments r
    where r.loan_id = p_loan_id
      and r.organization_id = p_organization_id
      and r.status = 'posted'
      and r.payment_date > p_payment_date
  ) then
    raise exception 'Un remboursement postérieur à la date choisie existe déjà ; régularise-le avant la clôture anticipée';
  end if;

  v_principal := round(v_loan.outstanding_principal,2);
  v_interest := round(coalesce(p_interest_amount,0),2);
  v_fees := round(coalesce(p_fees_amount,0),2);
  v_penalty := round(coalesce(p_penalty_amount,0),2);
  v_amount := round(v_principal + v_interest + v_fees + v_penalty,2);
  if v_principal <= 0 then
    raise exception 'Le capital restant dû est déjà soldé';
  end if;
  if v_fees > 0 and v_loan.fee_account_code is null then
    raise exception 'Configure le compte PCG des frais ou indemnités sur le contrat';
  end if;
  if v_penalty > 0 and v_loan.penalty_account_code is null then
    raise exception 'Configure le compte PCG des pénalités sur le contrat';
  end if;
  if v_interest + v_fees + v_penalty > 0
     and length(btrim(coalesce(p_notes,''))) < 3 then
    raise exception 'Ajoute la référence du décompte prêteur justifiant les intérêts, frais ou pénalités';
  end if;

  select * into v_account
  from public.financial_accounts
  where id = p_financial_account_id
    and organization_id = p_organization_id
    and is_active
  for update;

  if not found then
    raise exception 'Compte de trésorerie invalide ou inactif';
  end if;

  v_reference := coalesce(
    nullif(btrim(p_payment_reference),''),
    public.next_document_number(p_organization_id,'payment')
  );

  insert into public.loan_repayments(
    organization_id, loan_id, installment_id, payment_date, amount,
    principal_paid, interest_paid, fees_paid, penalty_paid,
    financial_account_id, payment_reference, notes, status, request_key, created_by
  ) values (
    p_organization_id, p_loan_id, null, p_payment_date, v_amount,
    v_principal, v_interest, v_fees, v_penalty,
    p_financial_account_id, v_reference,
    nullif(btrim(coalesce(p_notes,'')),''), 'posted', p_request_key, auth.uid()
  ) returning id into v_repayment_id;

  update public.financial_accounts
  set balance = balance - v_amount,
      updated_at = now()
  where id = p_financial_account_id
    and organization_id = p_organization_id;

  insert into public.financial_transactions(
    organization_id, financial_account_id, transaction_date, amount,
    kind, source_type, source_id, reference, description
  ) values (
    p_organization_id, p_financial_account_id, p_payment_date, -v_amount,
    'expense', 'loan_repayment', v_repayment_id, v_reference,
    'Clôture anticipée d’emprunt'
  ) returning id into v_transaction_id;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_kind','pcg',
    'pcg_code',v_loan.liability_account_code,
    'debit',v_principal,
    'credit',0
  ));
  if v_interest > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code','661','debit',v_interest,'credit',0
    ));
  end if;
  if v_fees > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',v_loan.fee_account_code,'debit',v_fees,'credit',0
    ));
  end if;
  if v_penalty > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',v_loan.penalty_account_code,'debit',v_penalty,'credit',0
    ));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_kind','treasury',
    'financial_account_id',v_account.id::text,
    'account_label',v_account.name,
    'debit',0,
    'credit',v_amount
  ));

  v_journal_id := public.magnisa_post_journal(
    p_organization_id,
    p_payment_date,
    v_reference,
    'Clôture anticipée d’emprunt',
    'loan_repayment',
    v_repayment_id,
    v_lines
  );

  update public.loan_repayments
  set financial_transaction_id = v_transaction_id,
      journal_entry_id = v_journal_id,
      updated_at = now()
  where id = v_repayment_id
    and organization_id = p_organization_id;

  insert into public.loan_repayment_installment_snapshots(
    organization_id, repayment_id, installment_id,
    opening_principal, principal_due, interest_due, fees_due,
    penalty_due, total_due, closing_principal, status
  )
  select organization_id, v_repayment_id, id,
    opening_principal, principal_due, interest_due, fees_due,
    penalty_due, total_due, closing_principal, status
  from public.loan_installments
  where loan_id = p_loan_id
    and organization_id = p_organization_id
    and status in ('planned','partial')
    and due_date > p_payment_date
  on conflict do nothing;

  update public.loan_installments
  set status = 'cancelled',
      updated_at = now()
  where loan_id = p_loan_id
    and organization_id = p_organization_id
    and status in ('planned','partial')
    and due_date > p_payment_date;

  update public.loans
  set outstanding_principal = 0,
      status = 'paid',
      next_due_date = null,
      next_due_amount = 0,
      updated_at = now()
  where id = p_loan_id
    and organization_id = p_organization_id;

  update public.loan_repayments
  set updated_at = now()
  where id = v_repayment_id and organization_id = p_organization_id;

  perform public.audit_event(
    p_organization_id,
    'loan.early_closure_posted',
    'loan_repayment',
    v_repayment_id,
    null,
    jsonb_build_object(
      'loan_id', p_loan_id,
      'amount', v_amount,
      'principal_paid', v_principal,
      'interest_paid', v_interest,
      'fees_paid', v_fees,
      'penalty_paid', v_penalty,
      'journal_entry_id', v_journal_id,
      'financial_transaction_id', v_transaction_id,
      'future_interest_charged', 0
    )
  );

  update public.lot1_financial_idempotency
  set result_id = v_repayment_id
  where organization_id = p_organization_id
    and request_key = p_request_key;

  return v_repayment_id;
end;
$function$;

revoke all on function public.close_loan_early(uuid,uuid,date,uuid,numeric,numeric,numeric,uuid,text,text) from public, anon;
grant execute on function public.close_loan_early(uuid,uuid,date,uuid,numeric,numeric,numeric,uuid,text,text) to authenticated;
