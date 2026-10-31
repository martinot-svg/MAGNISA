
-- Preserve the exact pre-operation schedule state so a posted repayment can
-- be reversed without reconstructing or guessing contractual amounts.
create table if not exists public.loan_repayment_installment_snapshots (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  repayment_id uuid not null,
  installment_id uuid not null,
  opening_principal numeric(20,2) not null,
  principal_due numeric(20,2) not null,
  interest_due numeric(20,2) not null,
  fees_due numeric(20,2) not null,
  penalty_due numeric(20,2) not null,
  total_due numeric(20,2) not null,
  closing_principal numeric(20,2) not null,
  status text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, repayment_id, installment_id),
  foreign key (repayment_id)
    references public.loan_repayments(id) on delete restrict,
  foreign key (installment_id)
    references public.loan_installments(id) on delete restrict
);

alter table public.loan_repayment_installment_snapshots enable row level security;
revoke all on public.loan_repayment_installment_snapshots from public, anon, authenticated;

-- Atomic loan repayment posting: schedule allocation, treasury movement and balanced journal.
-- All writes run in one PostgreSQL transaction. Any failure rolls back every side effect.

create or replace function public.record_loan_repayment(
  p_organization_id uuid,
  p_loan_id uuid,
  p_installment_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_financial_account_id uuid,
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
  v_installment public.loan_installments%rowtype;
  v_account public.financial_accounts%rowtype;
  v_idempotency public.lot1_financial_idempotency%rowtype;
  v_repayment_id uuid;
  v_transaction_id uuid;
  v_journal_id uuid;
  v_reference text;
  v_digest text;
  v_paid_fees numeric(20,2) := 0;
  v_paid_penalty numeric(20,2) := 0;
  v_paid_interest numeric(20,2) := 0;
  v_paid_principal numeric(20,2) := 0;
  v_this_principal numeric(20,2) := 0;
  v_this_interest numeric(20,2) := 0;
  v_this_fees numeric(20,2) := 0;
  v_this_penalty numeric(20,2) := 0;
  v_total_paid numeric(20,2) := 0;
  v_remaining_fees numeric(20,2) := 0;
  v_remaining_penalty numeric(20,2) := 0;
  v_remaining_interest numeric(20,2) := 0;
  v_remaining_principal numeric(20,2) := 0;
  v_left numeric(20,2);
  v_new_balance numeric(20,2);
  v_lines jsonb := '[]'::jsonb;
  v_remaining_count integer := 0;
  v_periodic_rate numeric;
  v_regular_payment numeric;
  v_schedule_balance numeric(20,2);
  v_schedule_interest numeric(20,2);
  v_schedule_principal numeric(20,2);
  v_row record;
  v_next_date date;
  v_next_amount numeric(20,2);
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'treasury.transfer');

  if p_request_key is null then raise exception 'Clé de requête obligatoire'; end if;
  if p_payment_date is null or p_payment_date > current_date then raise exception 'La date de paiement doit être renseignée et ne peut pas être future'; end if;
  if p_amount is null or p_amount <= 0 or round(p_amount,2) <> p_amount then
    raise exception 'Le montant doit être positif et limité à deux décimales';
  end if;

  v_digest := md5(jsonb_build_array(
    p_organization_id, p_loan_id, p_installment_id, p_payment_date,
    p_amount, p_financial_account_id, p_payment_reference, p_notes
  )::text);

  insert into public.lot1_financial_idempotency(
    organization_id, request_key, operation_type, request_digest
  ) values (
    p_organization_id, p_request_key, 'loan_repayment', v_digest
  ) on conflict (organization_id, request_key) do nothing;

  select * into strict v_idempotency
  from public.lot1_financial_idempotency
  where organization_id = p_organization_id and request_key = p_request_key
  for update;

  if v_idempotency.operation_type <> 'loan_repayment'
     or v_idempotency.request_digest <> v_digest then
    raise exception 'Clé de requête déjà utilisée pour une autre opération';
  end if;
  if v_idempotency.result_id is not null then
    return v_idempotency.result_id;
  end if;

  select * into v_loan
  from public.loans
  where id = p_loan_id and organization_id = p_organization_id
  for update;

  if not found or v_loan.status <> 'active' then
    raise exception 'Emprunt introuvable ou non actif';
  end if;
  if p_payment_date < v_loan.start_date then raise exception 'La date de paiement précède la date de départ du contrat'; end if;
  if v_loan.liability_account_code is null or v_loan.liability_account_code not in ('164','168') then
    raise exception 'Le compte de dette PCG doit être configuré sur le contrat';
  end if;

  select * into v_account
  from public.financial_accounts
  where id = p_financial_account_id
    and organization_id = p_organization_id
    and is_active
  for update;

  if not found then raise exception 'Compte de trésorerie invalide ou inactif'; end if;

  if p_installment_id is not null then
    select * into v_installment
    from public.loan_installments
    where id = p_installment_id
      and loan_id = p_loan_id
      and organization_id = p_organization_id
    for update;

    if not found or v_installment.status in ('paid','cancelled') then
      raise exception 'Échéance introuvable ou déjà soldée';
    end if;
    if exists (
      select 1 from public.loan_installments earlier
      where earlier.loan_id = p_loan_id and earlier.organization_id = p_organization_id
        and earlier.installment_number < v_installment.installment_number
        and earlier.status in ('planned','partial','overdue')
    ) then raise exception 'Règle les échéances précédentes avant celle-ci'; end if;

    select
      coalesce(sum(fees_paid),0),
      coalesce(sum(penalty_paid),0),
      coalesce(sum(interest_paid),0),
      coalesce(sum(principal_paid),0)
    into v_paid_fees, v_paid_penalty, v_paid_interest, v_paid_principal
    from public.loan_repayments
    where installment_id = p_installment_id
      and organization_id = p_organization_id
      and status = 'posted';

    v_remaining_fees := greatest(v_installment.fees_due - v_paid_fees, 0);
    v_remaining_penalty := greatest(v_installment.penalty_due - v_paid_penalty, 0);
    v_remaining_interest := greatest(v_installment.interest_due - v_paid_interest, 0);
    v_remaining_principal := greatest(v_installment.principal_due - v_paid_principal, 0);

    if p_amount > v_remaining_fees + v_remaining_penalty + v_remaining_interest + v_remaining_principal then
      raise exception 'Le paiement dépasse le solde de cette échéance. Utilise un remboursement anticipé distinct pour le capital supplémentaire.';
    end if;

    -- Apply the allocation order explicitly stored on the signed loan contract.
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
    end if;

  else
    -- A principal prepayment is accepted only when all due/overdue installments
    -- have already been settled. This prevents silently bypassing accrued dues.
    if exists (
      select 1 from public.loan_installments
      where loan_id = p_loan_id and organization_id = p_organization_id
        and (status = 'overdue' or (due_date <= p_payment_date and status in ('planned','partial')))
    ) then
      raise exception 'Règle d’abord les échéances arrivées à terme avant le remboursement anticipé';
    end if;
    if exists (
      select 1
      from public.loan_repayments r
      where r.loan_id = p_loan_id
        and r.organization_id = p_organization_id
        and r.status = 'posted'
        and r.payment_date > p_payment_date
    ) then
      raise exception 'Un remboursement postérieur à la date choisie existe déjà ; régularise-le avant de recalculer l’échéancier';
    end if;
    if p_amount >= v_loan.outstanding_principal then
      raise exception 'Ce parcours accepte uniquement une réduction partielle du capital. La clôture totale doit intégrer les intérêts courus et indemnités éventuelles.';
    end if;
    v_paid_principal := round(p_amount,2);
  end if;

  if v_paid_fees > 0 and v_loan.fee_account_code is null then
    raise exception 'Configure le compte PCG des frais sur le contrat avant de les payer';
  end if;
  if v_paid_penalty > 0 and v_loan.penalty_account_code is null then
    raise exception 'Configure le compte PCG des pénalités sur le contrat avant de les payer';
  end if;
  v_this_principal := v_paid_principal;
  v_this_interest := v_paid_interest;
  v_this_fees := v_paid_fees;
  v_this_penalty := v_paid_penalty;

  v_reference := coalesce(nullif(btrim(p_payment_reference),''), public.next_document_number(p_organization_id,'payment'));

  insert into public.loan_repayments(
    organization_id, loan_id, installment_id, payment_date, amount,
    principal_paid, interest_paid, fees_paid, penalty_paid,
    financial_account_id, payment_reference, notes, status, request_key, created_by
  ) values (
    p_organization_id, p_loan_id, p_installment_id, p_payment_date, round(p_amount,2),
    v_paid_principal, v_paid_interest, v_paid_fees, v_paid_penalty,
    p_financial_account_id, v_reference, nullif(btrim(coalesce(p_notes,'')),''), 'posted', p_request_key, auth.uid()
  ) returning id into v_repayment_id;

  update public.financial_accounts
  set balance = balance - p_amount, updated_at = now()
  where id = p_financial_account_id and organization_id = p_organization_id;

  insert into public.financial_transactions(
    organization_id, financial_account_id, transaction_date, amount,
    kind, source_type, source_id, reference, description
  ) values (
    p_organization_id, p_financial_account_id, p_payment_date, -round(p_amount,2),
    'expense', 'loan_repayment', v_repayment_id, v_reference,
    case when p_installment_id is null then 'Remboursement anticipé d’emprunt' else 'Remboursement d’échéance d’emprunt' end
  ) returning id into v_transaction_id;

  if v_this_principal > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',v_loan.liability_account_code,
      'debit',v_this_principal,'credit',0
    ));
  end if;
  if v_this_interest > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code','661','debit',v_this_interest,'credit',0
    ));
  end if;
  if v_this_fees > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',v_loan.fee_account_code,
      'debit',v_this_fees,'credit',0
    ));
  end if;
  if v_this_penalty > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',v_loan.penalty_account_code,
      'debit',v_this_penalty,'credit',0
    ));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_kind','treasury','financial_account_id',v_account.id::text,
    'account_label',v_account.name,'debit',0,'credit',round(p_amount,2)
  ));

  v_journal_id := public.magnisa_post_journal(
    p_organization_id, p_payment_date, v_reference,
    case when p_installment_id is null then 'Remboursement anticipé d’emprunt' else 'Remboursement d’emprunt' end,
    'loan_repayment', v_repayment_id, v_lines
  );

  update public.loan_repayments
  set financial_transaction_id = v_transaction_id,
      journal_entry_id = v_journal_id,
      updated_at = now()
  where id = v_repayment_id and organization_id = p_organization_id;

  v_new_balance := round(v_loan.outstanding_principal - v_paid_principal,2);
  if v_new_balance < 0 then raise exception 'Le capital restant dû ne peut pas devenir négatif'; end if;

  if p_installment_id is not null then
    insert into public.loan_repayment_installment_snapshots(
      organization_id, repayment_id, installment_id,
      opening_principal, principal_due, interest_due, fees_due,
      penalty_due, total_due, closing_principal, status
    )
    select organization_id, v_repayment_id, id,
      opening_principal, principal_due, interest_due, fees_due,
      penalty_due, total_due, closing_principal, status
    from public.loan_installments
    where id = p_installment_id and organization_id = p_organization_id
    on conflict do nothing;

    select coalesce(sum(amount),0) into v_total_paid
    from public.loan_repayments
    where installment_id = p_installment_id
      and organization_id = p_organization_id
      and status = 'posted';

    update public.loan_installments
    set status = case
      when round(v_total_paid,2) >= total_due then 'paid'
      else 'partial'
    end,
    updated_at = now()
    where id = p_installment_id and organization_id = p_organization_id;
  else
    insert into public.loan_repayment_installment_snapshots(
      organization_id, repayment_id, installment_id,
      opening_principal, principal_due, interest_due, fees_due,
      penalty_due, total_due, closing_principal, status
    )
    select organization_id, v_repayment_id, id,
      opening_principal, principal_due, interest_due, fees_due,
      penalty_due, total_due, closing_principal, status
    from public.loan_installments
    where loan_id = p_loan_id and organization_id = p_organization_id
      and status = 'planned' and due_date > p_payment_date
    on conflict do nothing;

    v_schedule_balance := v_new_balance;
    select count(*) into v_remaining_count
    from public.loan_installments
    where loan_id = p_loan_id and organization_id = p_organization_id
      and status = 'planned' and due_date > p_payment_date;

    if v_schedule_balance = 0 then
      update public.loan_installments
      set status = 'cancelled', updated_at = now()
      where loan_id = p_loan_id and organization_id = p_organization_id
        and status = 'planned' and due_date > p_payment_date;
    else
      if v_remaining_count = 0 then
        raise exception 'Aucune échéance future disponible pour recalculer le capital restant dû';
      end if;

      v_periodic_rate := coalesce(v_loan.interest_rate,0) / 100 / v_loan.payment_frequency;
      v_regular_payment := case
        when v_periodic_rate = 0 then v_schedule_balance / v_remaining_count
        else v_schedule_balance * v_periodic_rate / (1 - power(1 + v_periodic_rate, -v_remaining_count))
      end;

      for v_row in
        select * from public.loan_installments
        where loan_id = p_loan_id and organization_id = p_organization_id
          and status = 'planned' and due_date > p_payment_date
        order by installment_number
        for update
      loop
        v_schedule_interest := round(v_schedule_balance * v_periodic_rate,2);
        if v_loan.repayment_method = 'bullet' then
          v_schedule_principal := case when v_row.installment_number = (
            select max(installment_number) from public.loan_installments
            where loan_id = p_loan_id and organization_id = p_organization_id
              and status = 'planned' and due_date > p_payment_date
          ) then v_schedule_balance else 0 end;
        elsif v_loan.repayment_method = 'equal_principal' then
          v_schedule_principal := case when v_row.installment_number = (
            select max(installment_number) from public.loan_installments
            where loan_id = p_loan_id and organization_id = p_organization_id
              and status = 'planned' and due_date > p_payment_date
          ) then v_schedule_balance else least(v_schedule_balance,round(v_new_balance / v_remaining_count,2)) end;
        else
          v_schedule_principal := case when v_row.installment_number = (
            select max(installment_number) from public.loan_installments
            where loan_id = p_loan_id and organization_id = p_organization_id
              and status = 'planned' and due_date > p_payment_date
          ) then v_schedule_balance else least(v_schedule_balance,round(v_regular_payment - v_schedule_interest,2)) end;
        end if;

        update public.loan_installments
        set opening_principal = v_schedule_balance,
            principal_due = v_schedule_principal,
            interest_due = v_schedule_interest,
            total_due = v_schedule_principal + v_schedule_interest + fees_due + penalty_due,
            closing_principal = v_schedule_balance - v_schedule_principal,
            updated_at = now()
        where id = v_row.id and organization_id = p_organization_id;

        v_schedule_balance := round(v_schedule_balance - v_schedule_principal,2);
      end loop;

      if v_schedule_balance <> 0 then
        raise exception 'Le nouvel échéancier ne solde pas le capital après remboursement anticipé';
      end if;
    end if;
  end if;

  update public.loans
  set outstanding_principal = v_new_balance,
      status = case when v_new_balance = 0 then 'paid' else 'active' end,
      updated_at = now()
  where id = p_loan_id and organization_id = p_organization_id;

  select i.due_date,
         greatest(i.total_due - coalesce(sum(r.amount),0),0)
  into v_next_date, v_next_amount
  from public.loan_installments i
  left join public.loan_repayments r
    on r.installment_id = i.id and r.organization_id = i.organization_id and r.status = 'posted'
  where i.loan_id = p_loan_id and i.organization_id = p_organization_id
    and i.status in ('planned','partial','overdue')
  group by i.id, i.due_date, i.total_due
  having greatest(i.total_due - coalesce(sum(r.amount),0),0) > 0
  order by i.due_date, i.id
  limit 1;

  update public.loans
  set next_due_date = v_next_date,
      next_due_amount = v_next_amount,
      updated_at = now()
  where id = p_loan_id and organization_id = p_organization_id;

  update public.loan_repayments
  set updated_at = now()
  where id = v_repayment_id and organization_id = p_organization_id;

  perform public.audit_event(
    p_organization_id, 'loan.repayment_posted', 'loan_repayment', v_repayment_id,
    null, jsonb_build_object(
      'loan_id',p_loan_id,'amount',p_amount,'principal_paid',v_this_principal,
      'interest_paid',v_this_interest,'fees_paid',v_this_fees,'penalty_paid',v_this_penalty,
      'journal_entry_id',v_journal_id,'financial_transaction_id',v_transaction_id
    )
  );

  update public.lot1_financial_idempotency
  set result_id = v_repayment_id
  where organization_id = p_organization_id and request_key = p_request_key;

  return v_repayment_id;
end;
$function$;

revoke all on function public.record_loan_repayment(uuid,uuid,uuid,date,numeric,uuid,uuid,text,text) from public, anon;
grant execute on function public.record_loan_repayment(uuid,uuid,uuid,date,numeric,uuid,uuid,text,text) to authenticated;

-- Repayment and installment ledgers remain read-only to clients; all mutations go through the RPC.
revoke insert, update, delete on public.loan_installments, public.loan_repayments from anon, authenticated;
grant select on public.loan_installments, public.loan_repayments to authenticated;


-- Bring legacy loan records into the new schedule model only after a user
-- explicitly supplies the missing contractual and accounting terms.
create or replace function public.configure_existing_loan_schedule(
  p_organization_id uuid,
  p_loan_id uuid,
  p_repayment_method text,
  p_payment_frequency integer,
  p_total_installments integer,
  p_first_due_date date,
  p_end_date date,
  p_liability_account_code text,
  p_fee_account_code text,
  p_penalty_account_code text,
  p_repayment_allocation_order text,
  p_installments jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_loan public.loans%rowtype;
  v_end_date date;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'finance.view');
  perform public.assert_org_permission(p_organization_id, 'accounting.manage');

  select * into v_loan
  from public.loans
  where id = p_loan_id and organization_id = p_organization_id
  for update;

  if not found or v_loan.status <> 'active' then
    raise exception 'Emprunt historique introuvable ou non actif';
  end if;
  if exists (
    select 1 from public.loan_installments
    where loan_id = p_loan_id and organization_id = p_organization_id
  ) then
    raise exception 'Un échéancier existe déjà pour cet emprunt';
  end if;
  if p_repayment_method not in ('annuity','equal_principal','bullet') then raise exception 'Méthode de remboursement invalide'; end if;
  if p_payment_frequency not in (1,2,3,4,6,12) then raise exception 'Périodicité invalide'; end if;
  if p_total_installments is null or p_total_installments < 1 or p_total_installments > 1200 then raise exception 'Nombre d’échéances restantes invalide'; end if;
  if p_first_due_date is null or p_first_due_date < v_loan.start_date then raise exception 'Première échéance invalide'; end if;
  if p_liability_account_code is null or p_liability_account_code not in ('164','168') then raise exception 'Compte de dette invalide'; end if;
  if p_repayment_allocation_order not in ('charges_first','interest_first','principal_first') then raise exception 'Ordre d’imputation invalide'; end if;
  if p_fee_account_code is not null and not exists (select 1 from public.pcg2005_accounts where code=p_fee_account_code) then raise exception 'Compte de frais absent du plan comptable'; end if;
  if p_penalty_account_code is not null and not exists (select 1 from public.pcg2005_accounts where code=p_penalty_account_code) then raise exception 'Compte de pénalités absent du plan comptable'; end if;

  v_end_date := coalesce(p_end_date, v_loan.end_date);
  if v_end_date is not null and v_end_date < (p_first_due_date + make_interval(months => (p_total_installments - 1) * (12 / p_payment_frequency)))::date then
    raise exception 'La date de fin précède la dernière échéance calculée';
  end if;

  update public.loans
  set repayment_method = p_repayment_method,
      payment_frequency = p_payment_frequency,
      total_installments = p_total_installments,
      first_due_date = p_first_due_date,
      end_date = v_end_date,
      liability_account_code = p_liability_account_code,
      fee_account_code = p_fee_account_code,
      penalty_account_code = p_penalty_account_code,
      repayment_allocation_order = p_repayment_allocation_order,
      updated_at = now()
  where id = p_loan_id and organization_id = p_organization_id;

  return public.create_loan_schedule(p_organization_id, p_loan_id, p_installments);
end;
$function$;

revoke all on function public.configure_existing_loan_schedule(uuid,uuid,text,integer,integer,date,date,text,text,text,text,jsonb) from public, anon;
grant execute on function public.configure_existing_loan_schedule(uuid,uuid,text,integer,integer,date,date,text,text,text,text,jsonb) to authenticated;


-- Add contractually supported fees or penalties to an unpaid installment.
-- This is a receivable adjustment only; no cash or journal is created here.
create or replace function public.add_loan_installment_charges(
  p_organization_id uuid,
  p_loan_id uuid,
  p_installment_id uuid,
  p_fee_amount numeric,
  p_penalty_amount numeric,
  p_reason text,
  p_request_key uuid
) returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_loan public.loans%rowtype;
  v_installment public.loan_installments%rowtype;
  v_next_amount numeric(20,2);
  v_idempotency public.lot1_financial_idempotency%rowtype;
  v_digest text;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'accounting.manage');

  if p_request_key is null then raise exception 'Clé de requête obligatoire'; end if;
  v_digest := md5(jsonb_build_array(p_organization_id,p_loan_id,p_installment_id,p_fee_amount,p_penalty_amount,p_reason)::text);
  insert into public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest)
  values(p_organization_id,p_request_key,'loan_installment_charges',v_digest)
  on conflict (organization_id,request_key) do nothing;
  select * into strict v_idempotency
  from public.lot1_financial_idempotency
  where organization_id=p_organization_id and request_key=p_request_key
  for update;
  if v_idempotency.operation_type <> 'loan_installment_charges' or v_idempotency.request_digest <> v_digest then
    raise exception 'Clé de requête déjà utilisée pour une autre opération';
  end if;
  if v_idempotency.result_id is not null then return; end if;

  if coalesce(p_fee_amount,0) < 0 or coalesce(p_penalty_amount,0) < 0
     or round(coalesce(p_fee_amount,0),2) <> coalesce(p_fee_amount,0)
     or round(coalesce(p_penalty_amount,0),2) <> coalesce(p_penalty_amount,0)
     or coalesce(p_fee_amount,0) + coalesce(p_penalty_amount,0) <= 0 then
    raise exception 'Montants de frais ou pénalités invalides';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 or length(btrim(p_reason)) > 300 then
    raise exception 'Le motif des frais ou pénalités est obligatoire';
  end if;

  select * into v_loan
  from public.loans
  where id = p_loan_id and organization_id = p_organization_id
  for update;
  if not found or v_loan.status <> 'active' then raise exception 'Emprunt introuvable ou non actif'; end if;

  if p_fee_amount > 0 and v_loan.fee_account_code is null then
    raise exception 'Configure le compte PCG des frais sur le contrat';
  end if;
  if p_penalty_amount > 0 and v_loan.penalty_account_code is null then
    raise exception 'Configure le compte PCG des pénalités sur le contrat';
  end if;

  select * into v_installment
  from public.loan_installments
  where id = p_installment_id
    and loan_id = p_loan_id
    and organization_id = p_organization_id
  for update;
  if not found or v_installment.status in ('paid','cancelled') then
    raise exception 'Échéance introuvable ou déjà soldée';
  end if;

  update public.loan_installments
  set fees_due = fees_due + coalesce(p_fee_amount,0),
      penalty_due = penalty_due + coalesce(p_penalty_amount,0),
      total_due = total_due + coalesce(p_fee_amount,0) + coalesce(p_penalty_amount,0),
      updated_at = now()
  where id = p_installment_id and organization_id = p_organization_id;

  select greatest(i.total_due - coalesce(sum(r.amount),0),0)
  into v_next_amount
  from public.loan_installments i
  left join public.loan_repayments r
    on r.installment_id = i.id and r.organization_id = i.organization_id and r.status = 'posted'
  where i.loan_id = p_loan_id and i.organization_id = p_organization_id
    and i.status in ('planned','partial','overdue')
  group by i.id, i.due_date, i.total_due
  having greatest(i.total_due - coalesce(sum(r.amount),0),0) > 0
  order by i.due_date, i.id
  limit 1;

  update public.loans
  set next_due_amount = v_next_amount, updated_at = now()
  where id = p_loan_id and organization_id = p_organization_id;

  perform public.audit_event(
    p_organization_id, 'loan.installment_charges_added', 'loan_installment', p_installment_id,
    null, jsonb_build_object(
      'loan_id',p_loan_id,'fee_amount',coalesce(p_fee_amount,0),
      'penalty_amount',coalesce(p_penalty_amount,0),'reason',btrim(p_reason)
    )
  );
  update public.lot1_financial_idempotency
  set result_id = p_installment_id
  where organization_id = p_organization_id and request_key = p_request_key;
end;
$function$;

revoke all on function public.add_loan_installment_charges(uuid,uuid,uuid,numeric,numeric,text,uuid) from public, anon;
grant execute on function public.add_loan_installment_charges(uuid,uuid,uuid,numeric,numeric,text,uuid) to authenticated;
