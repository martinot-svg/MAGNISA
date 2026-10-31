-- Reversal of a posted loan repayment is a compensating operation.
-- Original entries are retained; cash and accounting are reversed atomically.
alter table public.loan_repayments
  add column if not exists reversal_journal_entry_id uuid references public.journal_entries(id) on delete restrict,
  add column if not exists reversal_financial_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references auth.users(id) on delete set null;

create or replace function public.reverse_loan_repayment(
  p_organization_id uuid,
  p_repayment_id uuid,
  p_reversal_date date,
  p_request_key uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_repayment public.loan_repayments%rowtype;
  v_loan public.loans%rowtype;
  v_account public.financial_accounts%rowtype;
  v_idempotency public.lot1_financial_idempotency%rowtype;
  v_original_transaction public.financial_transactions%rowtype;
  v_original_journal public.journal_entries%rowtype;
  v_line record;
  v_lines jsonb := '[]'::jsonb;
  v_digest text;
  v_reference text;
  v_transaction_id uuid;
  v_journal_id uuid;
  v_next_date date;
  v_next_amount numeric(20,2);
  v_restored_balance numeric(20,2);
  v_snapshot_count integer := 0;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'treasury.transfer');

  if p_request_key is null then raise exception 'Clé de requête obligatoire'; end if;
  if p_reversal_date is null or p_reversal_date > current_date then
    raise exception 'La date de contrepassation est invalide';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 5 or length(btrim(p_reason)) > 500 then
    raise exception 'Le motif de contrepassation doit contenir entre 5 et 500 caractères';
  end if;

  v_digest := md5(jsonb_build_array(
    p_organization_id, p_repayment_id, p_reversal_date, btrim(p_reason)
  )::text);

  insert into public.lot1_financial_idempotency(
    organization_id, request_key, operation_type, request_digest
  ) values (
    p_organization_id, p_request_key, 'loan_repayment_reversal', v_digest
  ) on conflict (organization_id, request_key) do nothing;

  select * into strict v_idempotency
  from public.lot1_financial_idempotency
  where organization_id = p_organization_id and request_key = p_request_key
  for update;

  if v_idempotency.operation_type <> 'loan_repayment_reversal'
     or v_idempotency.request_digest <> v_digest then
    raise exception 'Clé de requête déjà utilisée pour une autre opération';
  end if;
  if v_idempotency.result_id is not null then
    return v_idempotency.result_id;
  end if;

  select * into v_repayment
  from public.loan_repayments
  where id = p_repayment_id and organization_id = p_organization_id
  for update;

  if not found or v_repayment.status <> 'posted' then
    raise exception 'Remboursement introuvable ou déjà contrepassé';
  end if;
  if v_repayment.payment_date > p_reversal_date then
    raise exception 'La date de contrepassation ne peut pas précéder le remboursement';
  end if;
  if v_repayment.financial_transaction_id is null
     or v_repayment.journal_entry_id is null
     or v_repayment.financial_account_id is null then
    raise exception 'Le remboursement ne possède pas toutes ses pièces comptables';
  end if;

  select * into v_loan
  from public.loans
  where id = v_repayment.loan_id and organization_id = p_organization_id
  for update;
  if not found or v_loan.status not in ('active','paid') then
    raise exception 'Contrat d’emprunt non disponible pour contrepassation';
  end if;

  if exists (
    select 1 from public.loan_repayments later
    where later.loan_id = v_repayment.loan_id
      and later.organization_id = p_organization_id
      and later.status = 'posted'
      and later.id <> v_repayment.id
      and later.created_at > v_repayment.created_at
  ) then
    raise exception 'Contrepassation bloquée : un remboursement ultérieur existe. Contrepasser d’abord les opérations dans l’ordre inverse.';
  end if;

  if exists (
    select 1
    from public.loan_repayment_installment_snapshots s
    join public.loan_installments i
      on i.id = s.installment_id
    where s.organization_id = p_organization_id
      and s.repayment_id = v_repayment.id
      and i.updated_at > v_repayment.updated_at
  ) then
    raise exception 'Contrepassation bloquée : une échéance liée a été modifiée depuis ce remboursement.';
  end if;

  select * into v_original_transaction
  from public.financial_transactions
  where id = v_repayment.financial_transaction_id
    and organization_id = p_organization_id;
  if not found then raise exception 'Mouvement de trésorerie d’origine introuvable'; end if;

  select * into v_original_journal
  from public.journal_entries
  where id = v_repayment.journal_entry_id
    and organization_id = p_organization_id
    and status = 'posted';
  if not found then raise exception 'Écriture comptable d’origine introuvable ou non validée'; end if;

  select * into v_account
  from public.financial_accounts
  where id = v_repayment.financial_account_id
    and organization_id = p_organization_id
  for update;
  if not found then raise exception 'Compte de trésorerie d’origine introuvable'; end if;

  for v_line in
    select account_key, account_label, debit, credit, financial_account_id
    from public.journal_entry_lines
    where organization_id = p_organization_id
      and journal_entry_id = v_original_journal.id
    order by id
  loop
    if v_line.account_key like 'TREASURY:%' then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_kind','treasury',
        'financial_account_id',v_line.financial_account_id::text,
        'account_label',v_line.account_label,
        'debit',v_line.credit,
        'credit',v_line.debit
      ));
    elsif v_line.account_key like 'PCG:%' then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_kind','pcg',
        'pcg_code',substring(v_line.account_key from 5),
        'debit',v_line.credit,
        'credit',v_line.debit
      ));
    else
      raise exception 'Type de ligne comptable non pris en charge pour la contrepassation: %', v_line.account_key;
    end if;
  end loop;

  if jsonb_array_length(v_lines) < 2 then
    raise exception 'L’écriture d’origine ne contient pas assez de lignes à contrepasser';
  end if;

  v_reference := public.next_document_number(p_organization_id,'payment');

  update public.financial_accounts
  set balance = balance + v_repayment.amount,
      updated_at = now()
  where id = v_account.id and organization_id = p_organization_id;

  insert into public.financial_transactions(
    organization_id, financial_account_id, transaction_date, amount,
    kind, source_type, source_id, reference, description
  ) values (
    p_organization_id, v_account.id, p_reversal_date, v_repayment.amount,
    'income', 'loan_repayment_reversal', v_repayment.id, v_reference,
    'Contrepassation du remboursement d’emprunt'
  ) returning id into v_transaction_id;

  v_journal_id := public.magnisa_post_journal(
    p_organization_id,
    p_reversal_date,
    v_reference,
    'Contrepassation du remboursement d’emprunt : ' || coalesce(v_repayment.payment_reference, v_repayment.id::text),
    'loan_repayment_reversal',
    v_repayment.id,
    v_lines
  );

  select count(*) into v_snapshot_count
  from public.loan_repayment_installment_snapshots
  where organization_id = p_organization_id and repayment_id = v_repayment.id;

  if v_repayment.installment_id is null
     and coalesce(v_original_transaction.description,'') <> 'Clôture anticipée d’emprunt'
     and v_snapshot_count = 0 then
    raise exception 'Aucun instantané de l’échéancier n’existe pour restaurer ce remboursement anticipé';
  end if;

  update public.loan_installments i
  set opening_principal = s.opening_principal,
      principal_due = s.principal_due,
      interest_due = s.interest_due,
      fees_due = s.fees_due,
      penalty_due = s.penalty_due,
      total_due = s.total_due,
      closing_principal = s.closing_principal,
      status = s.status,
      updated_at = now()
  from public.loan_repayment_installment_snapshots s
  where s.organization_id = p_organization_id
    and s.repayment_id = v_repayment.id
    and i.id = s.installment_id
    and i.organization_id = p_organization_id;

  update public.loan_repayments
  set status = 'reversed',
      reversal_journal_entry_id = v_journal_id,
      reversal_financial_transaction_id = v_transaction_id,
      reversed_at = now(),
      reversed_by = auth.uid(),
      updated_at = now()
  where id = v_repayment.id and organization_id = p_organization_id;

  v_restored_balance := round(v_loan.outstanding_principal + v_repayment.principal_paid,2);

  select i.due_date,
         greatest(i.total_due - coalesce(sum(r.amount),0),0)
  into v_next_date, v_next_amount
  from public.loan_installments i
  left join public.loan_repayments r
    on r.installment_id = i.id
   and r.organization_id = i.organization_id
   and r.status = 'posted'
  where i.loan_id = v_repayment.loan_id
    and i.organization_id = p_organization_id
    and i.status in ('planned','partial','overdue')
  group by i.id, i.due_date, i.total_due
  having greatest(i.total_due - coalesce(sum(r.amount),0),0) > 0
  order by i.due_date, i.id
  limit 1;

  update public.loans
  set outstanding_principal = v_restored_balance,
      status = case when v_restored_balance > 0 then 'active' else 'paid' end,
      next_due_date = v_next_date,
      next_due_amount = v_next_amount,
      updated_at = now()
  where id = v_repayment.loan_id and organization_id = p_organization_id;

  perform public.audit_event(
    p_organization_id,
    'loan.repayment_reversed',
    'loan_repayment',
    v_repayment.id,
    null,
    jsonb_build_object(
      'loan_id',v_repayment.loan_id,
      'amount',v_repayment.amount,
      'principal_restored',v_repayment.principal_paid,
      'reversal_journal_entry_id',v_journal_id,
      'reversal_financial_transaction_id',v_transaction_id,
      'reason',btrim(p_reason)
    )
  );

  update public.lot1_financial_idempotency
  set result_id = v_repayment.id
  where organization_id = p_organization_id and request_key = p_request_key;

  return v_repayment.id;
end;
$function$;

revoke all on function public.reverse_loan_repayment(uuid,uuid,date,uuid,text) from public, anon;
grant execute on function public.reverse_loan_repayment(uuid,uuid,date,uuid,text) to authenticated;
