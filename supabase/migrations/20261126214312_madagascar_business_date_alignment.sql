BEGIN;

-- Centralize business dates on Madagascar local time (PostgreSQL sessions default to UTC).
CREATE OR REPLACE FUNCTION public.magnisa_business_date()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT (pg_catalog.now() AT TIME ZONE 'Indian/Antananarivo')::date;
$function$;
REVOKE ALL ON FUNCTION public.magnisa_business_date() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.magnisa_business_date() TO authenticated, service_role;
COMMENT ON FUNCTION public.magnisa_business_date() IS
  'Returns the current MAGNISA business date in Indian/Antananarivo; use instead of PostgreSQL UTC current_date for Malagasy business workflows.';

-- Restore the historical internal-transfer table in the active replay path.
-- It existed in production but its original migration was archived during history reconciliation.
CREATE TABLE IF NOT EXISTS public.magnisa_internal_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  source_account_id uuid NOT NULL REFERENCES public.financial_accounts(id),
  destination_account_id uuid NOT NULL REFERENCES public.financial_accounts(id),
  request_key uuid NOT NULL,
  transfer_date date NOT NULL,
  received_date date,
  source_debit numeric(18,2) NOT NULL CHECK (source_debit > 0),
  destination_credit numeric(18,2) NOT NULL CHECK (destination_credit > 0),
  operator_fee numeric(18,2) NOT NULL CHECK (operator_fee >= 0),
  source_reference text NOT NULL,
  destination_reference text,
  status text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  magnisa_reference text,
  CONSTRAINT magnisa_transfer_unique_request UNIQUE (organization_id,request_key),
  CONSTRAINT magnisa_transfer_distinct_accounts CHECK (source_account_id <> destination_account_id),
  CONSTRAINT magnisa_transfer_balance CHECK (source_debit = destination_credit + operator_fee)
);
ALTER TABLE public.magnisa_internal_transfers
  ADD COLUMN IF NOT EXISTS magnisa_reference text;
CREATE UNIQUE INDEX IF NOT EXISTS magnisa_transfer_source_reference_unique
  ON public.magnisa_internal_transfers(organization_id,source_account_id,source_reference);
CREATE INDEX IF NOT EXISTS magnisa_transfer_org_date
  ON public.magnisa_internal_transfers(organization_id,transfer_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS magnisa_internal_transfers_magnisa_reference_unique
  ON public.magnisa_internal_transfers(organization_id,magnisa_reference)
  WHERE magnisa_reference IS NOT NULL;
ALTER TABLE public.magnisa_internal_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS magnisa_transfer_select_org ON public.magnisa_internal_transfers;
CREATE POLICY magnisa_transfer_select_org
  ON public.magnisa_internal_transfers
  FOR SELECT TO public
  USING (
    organization_id IN (
      SELECT o.id
      FROM public.organizations o
      WHERE o.id=magnisa_internal_transfers.organization_id
        AND EXISTS (
          SELECT 1 FROM public.organization_members m
          WHERE m.organization_id=o.id AND m.user_id=(SELECT auth.uid())
        )
    )
  );
REVOKE ALL ON public.magnisa_internal_transfers FROM anon,authenticated;
GRANT SELECT ON public.magnisa_internal_transfers TO authenticated;
DROP TRIGGER IF EXISTS magnisa_internal_transfers_magnisa_reference ON public.magnisa_internal_transfers;
CREATE TRIGGER magnisa_internal_transfers_magnisa_reference
  BEFORE INSERT OR UPDATE OF magnisa_reference
  ON public.magnisa_internal_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.magnisa_assign_module_reference('transfers','TRF');

-- Replace every business-date dependency found in the production schema with
-- the explicit Madagascar business date. Function ACLs are preserved by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION private.generate_all_due_recurring_invoice_drafts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_org uuid;
  v_total integer := 0;
begin
  for v_org in
    select distinct organization_id
    from public.recurring_service_contracts
    where status='active'
  loop
    v_total := v_total + private.process_due_recurring_invoice_drafts(v_org, null);
  end loop;
  return v_total;
end; $function$;

CREATE OR REPLACE FUNCTION public.analysis_metrics(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_budget public.budgets%rowtype;
  v_start date;
  v_end date;
begin
  perform public.assert_org_access(p_org);
  if not public.has_org_permission(p_org,'finance.view') then
    raise exception 'Action non autorisée pour ce rôle';
  end if;

  v_start:=date_trunc('month',public.magnisa_business_date())::date;
  v_end:=(date_trunc('month',public.magnisa_business_date())+interval '1 month - 1 day')::date;

  select * into v_budget
  from public.budgets
  where organization_id=p_org and period_start<=public.magnisa_business_date() and period_end>=public.magnisa_business_date() and scenario='normal'
  order by period_start desc limit 1;

  return jsonb_build_object(
    'revenue',coalesce((select sum(subtotal) from public.invoices where organization_id=p_org and status not in ('draft','cancelled') and issue_date between v_start and v_end),0),
    'budget_revenue',v_budget.revenue_budget,
    'expenses',coalesce((select sum(amount) from public.expenses where organization_id=p_org and status in ('validated','paid') and expense_date between v_start and v_end),0),
    'budget_expenses',v_budget.expense_budget,
    'receivables',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and status not in ('draft','cancelled','paid')),0),
    'overdue_receivables',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and balance_due>0 and due_date<public.magnisa_business_date() and status not in ('draft','cancelled','paid')),0),
    'cash_available',coalesce((select sum(balance) from public.financial_accounts where organization_id=p_org and is_active and type in ('bank','cash','mobile_money')),0),
    'expected_receipts_30d',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and balance_due>0 and due_date between public.magnisa_business_date() and public.magnisa_business_date()+30 and status not in ('draft','cancelled','paid')),0),
    'obligations_30d',
      coalesce((select sum(amount-paid_amount) from public.tax_obligations where organization_id=p_org and status not in ('paid','cancelled') and due_date<=public.magnisa_business_date()+30),0)
      +coalesce((select sum(amount-paid_amount) from public.social_obligations where organization_id=p_org and status not in ('paid','cancelled') and due_date<=public.magnisa_business_date()+30),0),
    'unbilled_completed_services', coalesce((
      select round(sum(
        greatest(
          ol.quantity - coalesce((
            select sum(il.quantity)
            from public.invoice_lines il
            join public.invoices inv
              on inv.id = il.invoice_id
             and inv.organization_id = il.organization_id
            where il.organization_id = p_org
              and il.source_order_line_id = ol.id
              and inv.status not in ('draft','cancelled')
          ), 0),
          0
        ) * ol.unit_price * (1 - coalesce(ol.discount_pct, 0) / 100)
      ), 2)
      from public.orders o
      join public.order_lines ol
        on ol.organization_id = o.organization_id
       and ol.order_id = o.id
      where o.organization_id = p_org
        and o.status = 'completed'
        and ol.line_kind = 'service'
    ), 0)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.archive_payroll_rule(p_org uuid, p_rule uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v public.payroll_rule_sets%rowtype;
  v_archive_end date;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  perform public.assert_org_access(p_org);
  if not public.has_org_permission(p_org, 'payroll.manage') then
    raise exception 'Archivage non autorisé : permission payroll.manage requise';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org::text), 1742);

  select * into v
    from public.payroll_rule_sets
   where id = p_rule and organization_id = p_org
   for update;

  if not found then
    raise exception 'Référentiel introuvable pour cette organisation';
  end if;

  if v.status <> 'validated' then
    raise exception 'Seul un référentiel validé peut être archivé';
  end if;

  -- Never interrupt the rule currently governing today's payroll.
  if v.effective_from <= public.magnisa_business_date()
     and (v.effective_to is null or v.effective_to >= public.magnisa_business_date()) then
    raise exception 'Ce référentiel couvre la date actuelle. Valide d’abord une version de remplacement avant de l’archiver.';
  end if;

  if v.effective_from > public.magnisa_business_date() then
    -- A future rule is withdrawn without leaving an open-ended active period.
    v_archive_end := v.effective_from;
  elsif v.effective_to is null then
    v_archive_end := public.magnisa_business_date() - 1;
  else
    v_archive_end := v.effective_to;
  end if;

  perform set_config('app.payroll_rule_activation', 'on', true);

  update public.payroll_rule_sets
     set status = 'archived',
         effective_to = v_archive_end,
         updated_at = now()
   where id = p_rule and organization_id = p_org;
end
$function$;

CREATE OR REPLACE FUNCTION public.calculate_prospect_commission(p_org uuid, p_prospect uuid, p_policy uuid, p_source_document_type text, p_source_document_id uuid, p_request_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_prospect public.prospects%rowtype;
  v_policy public.commission_policies%rowtype;
  v_org_currency text;
  v_basis numeric(18,2);
  v_total numeric(18,2);
  v_roles integer;
  v_rules integer;
  v_share_total numeric(9,4);
  v_calculation uuid;
  v_rule_snapshot jsonb;
  v_digest text;
  v_existing_digest text;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.calculate') then
    raise exception 'Action non autorisée.';
  end if;
  if p_request_key is null then raise exception 'Clé de demande obligatoire.'; end if;
  v_digest := md5(jsonb_build_array(p_org,p_prospect,p_policy,p_source_document_type,p_source_document_id)::text);

  select id,request_digest into v_calculation,v_existing_digest
  from public.commission_calculations
  where organization_id=p_org and request_key=p_request_key;
  if found then
    if v_existing_digest is distinct from v_digest then
      raise exception 'Clé de demande déjà utilisée pour un autre calcul.';
    end if;
    return v_calculation;
  end if;

  select * into v_prospect from public.prospects
  where id=p_prospect and organization_id=p_org for update;
  if not found or v_prospect.converted_customer_id is null or v_prospect.status <> 'won' then
    raise exception 'Le prospect doit être converti en client avant le calcul de la prime.';
  end if;

  select * into v_policy from public.commission_policies
  where id=p_policy and organization_id=p_org and is_active
    and effective_from <= public.magnisa_business_date() and (effective_until is null or effective_until >= public.magnisa_business_date());
  if not found then raise exception 'Aucune politique de prime active applicable.'; end if;

  select currency into v_org_currency from public.organizations where id=p_org;
  if not found or v_policy.currency is distinct from v_org_currency then
    raise exception 'La devise de la politique ne correspond pas à la devise de l''organisation.';
  end if;

  if v_policy.calculation_basis='fixed_amount' then
    if p_source_document_type is not null or p_source_document_id is not null then
      raise exception 'Une politique à montant fixe ne doit pas recevoir de pièce source.';
    end if;
    v_basis := v_policy.fixed_basis_amount;
  elsif v_policy.calculation_basis='order_total' then
    if p_source_document_type <> 'order' or p_source_document_id is null then raise exception 'Commande source obligatoire.'; end if;
    select case when v_policy.tax_basis='net' then subtotal else total end into v_basis
    from public.orders
    where id=p_source_document_id and organization_id=p_org and customer_id=v_prospect.converted_customer_id
      and status='confirmed';
  elsif v_policy.calculation_basis='invoice_paid_amount' then
    if p_source_document_type <> 'invoice' or p_source_document_id is null then raise exception 'Facture source obligatoire.'; end if;
    select case when v_policy.tax_basis='net'
        then greatest(subtotal-discount_total,0)
        else paid_amount
      end into v_basis
    from public.invoices
    where id=p_source_document_id and organization_id=p_org and customer_id=v_prospect.converted_customer_id
      and status='paid' and balance_due <= 0 and paid_amount > 0;
  end if;
  if coalesce(v_basis,0) <= 0 then raise exception 'La base financière vérifiée est nulle ou introuvable.'; end if;

  select id into v_calculation from public.commission_calculations
  where organization_id=p_org and prospect_id=p_prospect and policy_id=p_policy
    and source_document_type is not distinct from p_source_document_type
    and source_document_id is not distinct from p_source_document_id;
  if found then return v_calculation; end if;

  select count(distinct c.contribution_type), count(distinct r.contribution_type), coalesce(sum(r.share_percentage),0)
    into v_roles, v_rules, v_share_total
  from (select distinct contribution_type from public.prospect_contributors
        where organization_id=p_org and prospect_id=p_prospect) c
  left join public.commission_policy_rules r
    on r.policy_id=v_policy.id and r.organization_id=p_org and r.contribution_type=c.contribution_type;
  if v_roles=0 or v_rules<>v_roles or v_share_total<=0 then
    raise exception 'Chaque rôle contributeur doit être couvert par la politique avec un pourcentage positif.';
  end if;

  v_total := round(v_basis * v_policy.commission_rate / 100, 2);
  if v_total <= 0 then raise exception 'Le montant de prime calculé est nul.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('contribution_type',contribution_type,'share_percentage',share_percentage)
      order by contribution_type),'[]'::jsonb)
    into v_rule_snapshot from public.commission_policy_rules where policy_id=v_policy.id and organization_id=p_org;

  insert into public.commission_calculations(
    organization_id,prospect_id,customer_id,policy_id,source_document_type,source_document_id,
    basis_amount,commission_rate,commission_total,currency,policy_snapshot,calculated_by,request_key,request_digest
  ) values (
    p_org,p_prospect,v_prospect.converted_customer_id,v_policy.id,p_source_document_type,p_source_document_id,
    v_basis,v_policy.commission_rate,v_total,v_policy.currency,
    jsonb_build_object('policy_id',v_policy.id,'policy_name',v_policy.name,'calculation_basis',v_policy.calculation_basis,
      'commission_rate',v_policy.commission_rate,'fixed_basis_amount',v_policy.fixed_basis_amount,
      'tax_basis',v_policy.tax_basis,'expense_account_code',v_policy.expense_account_code,
      'effective_from',v_policy.effective_from,'effective_until',v_policy.effective_until,'rules',v_rule_snapshot),
    auth.uid(),p_request_key,v_digest
  ) returning id into v_calculation;

  with contributors as (
    select c.id,c.user_id,c.contribution_type,r.share_percentage,
      count(*) over(partition by c.contribution_type) as role_count,
      (v_total * r.share_percentage / v_share_total
        / count(*) over(partition by c.contribution_type)) as raw_amount
    from public.prospect_contributors c
    join public.commission_policy_rules r on r.policy_id=v_policy.id
      and r.organization_id=p_org and r.contribution_type=c.contribution_type
    where c.organization_id=p_org and c.prospect_id=p_prospect
  ), ranked as (
    select *,
      floor(raw_amount * 100) / 100 as floor_amount,
      row_number() over(
        order by (raw_amount * 100 - floor(raw_amount * 100)) desc,
          contribution_type,user_id,id
      ) as remainder_rank,
      (v_total * 100 - sum(floor(raw_amount * 100)) over())::integer as remaining_cents
    from contributors
  ), allocated as (
    select *,
      floor_amount + case when remainder_rank <= remaining_cents then 0.01 else 0 end as final_amount
    from ranked
  )
  insert into public.commission_allocations(
    organization_id,calculation_id,user_id,contribution_type,share_percentage,amount
  )
  select p_org,v_calculation,user_id,contribution_type,
    (share_percentage / v_share_total * 100 / role_count),final_amount
  from allocated where final_amount > 0;

  perform public.audit_event(p_org,'commission.calculated','commission_calculations',v_calculation,null,
    jsonb_build_object('prospect_id',p_prospect,'basis_amount',v_basis,'commission_total',v_total,'currency',v_policy.currency));
  return v_calculation;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_org uuid, p_invoice uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare i public.invoices%rowtype;v_entry uuid;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'invoices.cancel');
  if length(trim(p_reason))<3 then raise exception 'Motif obligatoire';end if;
  select * into i from public.invoices where id=p_invoice and organization_id=p_org for update;
  if not found then raise exception 'Facture introuvable';end if;
  if i.status='cancelled' then raise exception 'Facture déjà annulée';end if;
  if i.paid_amount>0 then raise exception 'Une facture déjà payée doit être corrigée par avoir/remboursement, pas annulée directement';end if;
  if i.status<>'draft' then
    insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
    values(p_org,public.magnisa_business_date(),'ANN-'||i.number,'Annulation facture '||i.number,'invoice_cancellation',i.id,i.total,i.total) returning id into v_entry;
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,customer_id) values
      (p_org,v_entry,'SALES_REVENUE','Annulation chiffre d''affaires',i.subtotal,0,i.customer_id),
      (p_org,v_entry,'AR','Annulation créance client',0,i.total,i.customer_id);
    if i.tax_total>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,customer_id)
      values(p_org,v_entry,'TAX_PAYABLE','Annulation taxe collectée',i.tax_total,0,i.customer_id);end if;
  end if;
  update public.invoices set status='cancelled',balance_due=0,cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now() where id=i.id;
  perform public.audit_event(p_org,'invoice.cancelled','invoice',i.id,jsonb_build_object('status',i.status),jsonb_build_object('status','cancelled','reason',p_reason));
end;$function$;

CREATE OR REPLACE FUNCTION public.close_loan_early(p_organization_id uuid, p_loan_id uuid, p_payment_date date, p_financial_account_id uuid, p_interest_amount numeric, p_fees_amount numeric, p_penalty_amount numeric, p_request_key uuid, p_payment_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if p_payment_date is null or p_payment_date > public.magnisa_business_date() then
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
      and (status in ('overdue','partial') or (due_date <= p_payment_date and status = 'planned'))
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

CREATE OR REPLACE FUNCTION public.convert_order_to_invoice(p_org uuid, p_order uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.orders%rowtype;v_invoice uuid;v_number text;v_days int;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'invoices.create');
  select * into o from public.orders where id=p_order and organization_id=p_org for update;
  if not found then raise exception 'Commande introuvable';end if;
  if o.status not in ('confirmed','in_progress','completed') then raise exception 'Statut de commande incompatible'; end if;
  if exists(select 1 from public.invoices where order_id=p_order and organization_id=p_org) then raise exception 'Cette commande possède déjà une facture'; end if;
  select default_payment_days into v_days from public.company_settings where organization_id=p_org;
  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,quote_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,notes,created_by)
  values(p_org,o.customer_id,o.quote_id,o.id,v_number,'draft',public.magnisa_business_date(),public.magnisa_business_date()+coalesce(v_days,30),o.subtotal,0,o.tax_total,o.total,0,o.total,o.notes,auth.uid()) returning id into v_invoice;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  select organization_id,v_invoice,service_id,description,quantity,unit,unit_price,0,0,round(quantity*unit_price,2),tax_rate,round((quantity*unit_price)*tax_rate/100,2),line_total,sort_order from public.order_lines where order_id=o.id;
  perform public.audit_event(p_org,'order.converted_to_invoice','order',o.id,null,jsonb_build_object('invoice_id',v_invoice));
  return v_invoice;
end;$function$;

CREATE OR REPLACE FUNCTION public.convert_quote_to_invoice(p_org uuid, p_quote uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q public.quotes%rowtype;v_invoice uuid;v_number text;v_days int;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'invoices.create');
  select * into q from public.quotes where id=p_quote and organization_id=p_org for update;
  if not found then raise exception 'Devis introuvable';end if;
  if q.status <> 'accepted' then raise exception 'Seul un devis accepté peut être converti';end if;
  if exists(select 1 from public.invoices where quote_id=p_quote and organization_id=p_org) then raise exception 'Ce devis possède déjà une facture';end if;
  select default_payment_days into v_days from public.company_settings where organization_id=p_org;
  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,quote_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,notes,created_by)
  values(p_org,q.customer_id,q.id,v_number,'draft',public.magnisa_business_date(),public.magnisa_business_date()+coalesce(v_days,30),q.subtotal,q.discount_total,q.tax_total,q.total,0,q.total,q.notes,auth.uid()) returning id into v_invoice;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  select organization_id,v_invoice,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order from public.quote_lines where quote_id=q.id;
  update public.quotes set status='converted',updated_at=now() where id=q.id;
  perform public.audit_event(p_org,'quote.converted','quote',q.id,jsonb_build_object('status','accepted'),jsonb_build_object('status','converted','invoice_id',v_invoice));
  return v_invoice;
end;$function$;

CREATE OR REPLACE FUNCTION public.convert_quote_to_order(p_org uuid, p_quote uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q public.quotes%rowtype;v_order uuid;v_number text;
begin
 perform public.assert_org_access(p_org);perform public.assert_org_permission(p_org,'orders.manage');
 select * into q from public.quotes where id=p_quote and organization_id=p_org for update;
 if not found then raise exception 'Devis introuvable';end if;
 if q.status<>'accepted' then raise exception 'Seul un devis accepté peut devenir une commande';end if;
 if exists(select 1 from public.orders where quote_id=p_quote and organization_id=p_org) then raise exception 'Ce devis possède déjà une commande';end if;
 v_number:=public.next_document_number(p_org,'order');
 insert into public.orders(organization_id,customer_id,quote_id,number,status,order_date,subtotal,tax_total,total,notes,created_by)
 values(p_org,q.customer_id,q.id,v_number,'confirmed',public.magnisa_business_date(),q.subtotal,q.tax_total,q.total,q.notes,auth.uid()) returning id into v_order;
 insert into public.order_lines(organization_id,order_id,service_id,description,quantity,unit,unit_price,tax_rate,line_total,sort_order,discount_pct,discount_amount,taxable_amount)
 select organization_id,v_order,service_id,description,quantity,unit,unit_price,tax_rate,line_total,sort_order,discount_pct,discount_amount,taxable_amount from public.quote_lines where quote_id=q.id and organization_id=p_org order by sort_order;
 update public.quotes set status='converted',updated_at=now() where id=q.id;
 perform public.audit_event(p_org,'quote.converted_to_order','quote',q.id,jsonb_build_object('status','accepted'),jsonb_build_object('status','converted','order_id',v_order));
 return v_order;
end;$function$;

CREATE OR REPLACE FUNCTION public.create_direct_invoice_from_service(p_org uuid, p_customer uuid, p_service uuid, p_quantity numeric, p_discount_pct numeric, p_due_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s public.services%rowtype;v_id uuid;v_number text;v_gross numeric;v_discount numeric;v_taxable numeric;v_tax numeric;v_total numeric;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'invoices.create');
  if p_quantity<=0 then raise exception 'Quantité invalide';end if;
  if p_discount_pct<0 or p_discount_pct>100 then raise exception 'Remise invalide';end if;
  if p_due_date<public.magnisa_business_date() then raise exception 'Échéance invalide';end if;
  if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then raise exception 'Client invalide';end if;
  select * into v_s from public.services where id=p_service and organization_id=p_org and is_active;
  if not found then raise exception 'Prestation invalide';end if;
  v_gross:=round(p_quantity*v_s.unit_price,2);v_discount:=round(v_gross*p_discount_pct/100,2);v_taxable:=v_gross-v_discount;v_tax:=round(v_taxable*v_s.tax_rate/100,2);v_total:=v_taxable+v_tax;
  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,created_by)
  values(p_org,p_customer,v_number,'draft',public.magnisa_business_date(),p_due_date,v_taxable,v_discount,v_tax,v_total,0,v_total,auth.uid()) returning id into v_id;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,v_id,v_s.id,v_s.name,p_quantity,v_s.unit,v_s.unit_price,p_discount_pct,v_discount,v_taxable,v_s.tax_rate,v_tax,v_total,1);
  perform public.audit_event(p_org,'invoice.created_direct','invoice',v_id,null,jsonb_build_object('number',v_number,'total',v_total));
  return v_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_draft(p_org uuid, p_customer uuid, p_due_date date, p_lines jsonb, p_order uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_invoice uuid;v_number text;r jsonb;s public.services%rowtype;ol public.order_lines%rowtype;
 v_order public.orders%rowtype;q numeric;d numeric;unit_price numeric;tax_rate numeric;
 v_description text;v_unit text;v_kind text;v_item uuid;v_order_line_id uuid;
 gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;
 v_sub numeric:=0;v_disc numeric:=0;v_tax numeric:=0;v_total numeric:=0;v_sort integer:=1;
 v_billed numeric;v_returned numeric;v_remaining numeric;v_seen_order_lines uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'invoices.create');
 IF p_due_date IS NULL OR p_due_date<public.magnisa_business_date() THEN RAISE EXCEPTION 'Échéance invalide'; END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<1 OR jsonb_array_length(p_lines)>100 THEN
  RAISE EXCEPTION 'La facture doit contenir entre 1 et 100 lignes';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND organization_id=p_org AND is_active) THEN
  RAISE EXCEPTION 'Client invalide';
 END IF;
 IF p_order IS NOT NULL THEN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_order.customer_id<>p_customer OR v_order.status NOT IN ('confirmed','in_progress','completed') THEN
   RAISE EXCEPTION 'Commande ou client invalide';
  END IF;
 END IF;

 -- Validate all lines and remaining quantities before creating the invoice header.
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_kind:=COALESCE(NULLIF(r->>'line_kind',''),'service');
  q:=COALESCE((r->>'quantity')::numeric,0);
  d:=COALESCE((r->>'discount_pct')::numeric,0);
  v_order_line_id:=NULLIF(r->>'order_line_id','')::uuid;
  IF q<=0 OR d<0 OR d>100 THEN RAISE EXCEPTION 'Ligne de facture invalide'; END IF;

  IF v_kind='service' THEN
   IF NULLIF(r->>'service_id','') IS NULL THEN RAISE EXCEPTION 'Prestation manquante'; END IF;
   SELECT * INTO s FROM public.services WHERE id=(r->>'service_id')::uuid AND organization_id=p_org AND is_active;
   IF NOT FOUND THEN RAISE EXCEPTION 'Prestation invalide'; END IF;
   unit_price:=COALESCE(NULLIF(r->>'unit_price','')::numeric,s.unit_price);
   IF unit_price<0 THEN RAISE EXCEPTION 'Prix unitaire invalide'; END IF;
   tax_rate:=s.tax_rate;v_description:=s.name;v_unit:=s.unit;v_item:=NULL;
   IF p_order IS NOT NULL THEN
    IF v_order_line_id IS NULL OR v_order_line_id=ANY(v_seen_order_lines) THEN RAISE EXCEPTION 'Chaque prestation d’une commande doit être rattachée une seule fois à sa ligne source'; END IF;
    SELECT * INTO ol FROM public.order_lines
     WHERE id=v_order_line_id AND organization_id=p_org AND order_id=p_order AND service_id=s.id AND line_kind='service' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de prestation source invalide'; END IF;
    SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
     FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
     WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND inv.status<>'cancelled';
    v_remaining:=ol.quantity-v_billed;
    IF q>v_remaining+0.00000001 THEN RAISE EXCEPTION 'La quantité facturée dépasse le reliquat de la prestation'; END IF;
    tax_rate:=ol.tax_rate;v_description:=ol.description;v_unit:=ol.unit;
    v_seen_order_lines:=array_append(v_seen_order_lines,ol.id);
   ELSIF v_order_line_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ligne source fournie sans commande';
   END IF;
  ELSIF v_kind='merchandise' THEN
   IF p_order IS NULL OR v_order_line_id IS NULL OR NULLIF(r->>'item_id','') IS NULL THEN
    RAISE EXCEPTION 'Une marchandise doit provenir d’une ligne de commande client';
   END IF;
   IF v_order_line_id=ANY(v_seen_order_lines) THEN RAISE EXCEPTION 'Une ligne de commande ne peut apparaître qu’une fois par facture'; END IF;
   SELECT * INTO ol FROM public.order_lines
    WHERE id=v_order_line_id AND organization_id=p_org AND order_id=p_order
      AND item_id=(r->>'item_id')::uuid AND line_kind='merchandise' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de marchandise source invalide'; END IF;
   SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
    FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
    WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND inv.status<>'cancelled';
   v_returned:=private.unbilled_customer_return_quantity(p_org,ol.id);
   v_remaining:=ol.delivered_quantity-v_billed-v_returned;
   IF v_remaining<=0 OR q>v_remaining+0.00000001 THEN RAISE EXCEPTION 'La quantité facturée dépasse les marchandises effectivement livrées et non encore facturées'; END IF;
   unit_price:=ol.unit_price;d:=ol.discount_pct;tax_rate:=ol.tax_rate;
   v_description:=ol.description;v_unit:=ol.unit;v_item:=ol.item_id;
   v_seen_order_lines:=array_append(v_seen_order_lines,ol.id);
  ELSE
   RAISE EXCEPTION 'Nature de ligne de facture non prise en charge';
  END IF;

  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;
  tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  v_sub:=v_sub+taxable;v_disc:=v_disc+disc;v_tax:=v_tax+tax;v_total:=v_total+total;
 END LOOP;

 v_number:=public.next_document_number(p_org,'invoice');
 INSERT INTO public.invoices(organization_id,customer_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,created_by)
 VALUES(p_org,p_customer,p_order,v_number,'draft',public.magnisa_business_date(),p_due_date,v_sub,v_disc,v_tax,v_total,0,v_total,auth.uid())
 RETURNING id INTO v_invoice;

 -- Rebuild the validated snapshot and persist the mixed invoice lines.
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_kind:=COALESCE(NULLIF(r->>'line_kind',''),'service');
  q:=(r->>'quantity')::numeric;v_order_line_id:=NULLIF(r->>'order_line_id','')::uuid;
  IF v_kind='service' THEN
   SELECT * INTO s FROM public.services WHERE id=(r->>'service_id')::uuid AND organization_id=p_org AND is_active;
   unit_price:=COALESCE(NULLIF(r->>'unit_price','')::numeric,s.unit_price);
   d:=COALESCE((r->>'discount_pct')::numeric,0);tax_rate:=s.tax_rate;
   v_description:=s.name;v_unit:=s.unit;v_item:=NULL;
   IF v_order_line_id IS NOT NULL THEN
    SELECT source_line.tax_rate,source_line.description,source_line.unit INTO tax_rate,v_description,v_unit FROM public.order_lines source_line
    WHERE source_line.id=v_order_line_id AND source_line.organization_id=p_org AND source_line.order_id=p_order AND source_line.service_id=s.id;
   END IF;
  ELSE
   SELECT source_line.unit_price,source_line.discount_pct,source_line.tax_rate,source_line.description,source_line.unit,source_line.item_id
    INTO unit_price,d,tax_rate,v_description,v_unit,v_item
   FROM public.order_lines source_line WHERE source_line.id=v_order_line_id AND source_line.organization_id=p_org AND source_line.order_id=p_order;
  END IF;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;
  tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  INSERT INTO public.invoice_lines(organization_id,invoice_id,service_id,item_id,line_kind,source_order_line_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  VALUES(p_org,v_invoice,CASE WHEN v_kind='service' THEN s.id ELSE NULL END,v_item,v_kind,v_order_line_id,
    v_description,q,v_unit,unit_price,d,disc,taxable,tax_rate,tax,total,v_sort);
  v_sort:=v_sort+1;
 END LOOP;
 PERFORM public.audit_event(p_org,'invoice.created_draft','invoice',v_invoice,NULL,
  jsonb_build_object('number',v_number,'order_id',p_order,'lines',jsonb_array_length(p_lines),'total',v_total));
 RETURN v_invoice;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_draft_from_order(p_org uuid, p_order uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.orders%rowtype; v_invoice uuid; v_number text; v_days integer;
  v_subtotal numeric(18,2); v_discount numeric(18,2); v_tax numeric(18,2); v_total numeric(18,2);
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'invoices.create');
  select * into o from public.orders
   where id=p_order and organization_id=p_org for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if o.status not in ('confirmed','in_progress','completed') then raise exception 'Statut de commande incompatible'; end if;
  if exists(select 1 from public.invoices where order_id=p_order and organization_id=p_org and status<>'cancelled') then
    raise exception 'Cette commande possède déjà une facture active';
  end if;

  select
    coalesce(sum(coalesce(ol.taxable_amount,round(ol.quantity*ol.unit_price-coalesce(ol.discount_amount,0),2))),0),
    coalesce(sum(coalesce(ol.discount_amount,0)),0),
    coalesce(sum(round(coalesce(ol.taxable_amount,round(ol.quantity*ol.unit_price-coalesce(ol.discount_amount,0),2))*ol.tax_rate/100,2)),0),
    coalesce(sum(ol.line_total),0)
  into v_subtotal,v_discount,v_tax,v_total
  from public.order_lines ol where ol.order_id=o.id and ol.organization_id=p_org;
  if not exists(select 1 from public.order_lines where order_id=o.id and organization_id=p_org) then
    raise exception 'La commande ne contient aucune ligne';
  end if;

  select default_payment_days into v_days from public.company_settings where organization_id=p_org;
  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,quote_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,notes,created_by)
  values(p_org,o.customer_id,o.quote_id,o.id,v_number,'draft',public.magnisa_business_date(),public.magnisa_business_date()+coalesce(v_days,30),v_subtotal,v_discount,v_tax,v_total,0,v_total,o.notes,auth.uid())
  returning id into v_invoice;

  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  select ol.organization_id,v_invoice,ol.service_id,ol.description,ol.quantity,ol.unit,ol.unit_price,
    coalesce(ol.discount_pct,0),coalesce(ol.discount_amount,0),
    coalesce(ol.taxable_amount,round(ol.quantity*ol.unit_price-coalesce(ol.discount_amount,0),2)),
    ol.tax_rate,
    round(coalesce(ol.taxable_amount,round(ol.quantity*ol.unit_price-coalesce(ol.discount_amount,0),2))*ol.tax_rate/100,2),
    ol.line_total,ol.sort_order
  from public.order_lines ol where ol.order_id=o.id and ol.organization_id=p_org order by ol.sort_order;

  perform public.audit_event(p_org,'invoice.created_from_order','invoice',v_invoice,null,
    jsonb_build_object('order_id',o.id,'number',v_number,'subtotal',v_subtotal,'discount_total',v_discount,'tax_total',v_tax,'total',v_total));
  return v_invoice;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_quote_draft(p_org uuid, p_customer uuid, p_valid_until date, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_quote uuid;v_number text;r jsonb;s public.services%rowtype;q numeric;d numeric;unit_price numeric;gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;v_sub numeric:=0;v_disc numeric:=0;v_tax numeric:=0;v_total numeric:=0;v_sort integer:=1;
begin
 perform public.assert_org_access(p_org);perform public.assert_org_permission(p_org,'quotes.create');
 if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then raise exception 'Client invalide';end if;
 if p_valid_until is null or p_valid_until<public.magnisa_business_date() then raise exception 'Date de validité invalide';end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Les lignes du devis doivent être un tableau';end if;
 if jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>100 then raise exception 'Le devis doit contenir entre 1 et 100 prestations';end if;
 for r in select value from jsonb_array_elements(p_lines) loop
  q:=coalesce((r->>'quantity')::numeric,0);d:=coalesce((r->>'discount_pct')::numeric,0);
  if q<=0 or d<0 or d>100 or not (r ? 'unit_price') then raise exception 'Ligne de devis invalide';end if;
  unit_price:=(r->>'unit_price')::numeric;if unit_price<0 then raise exception 'Prix unitaire invalide';end if;
  select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
  if not found then raise exception 'Prestation invalide';end if;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;tax:=round(taxable*s.tax_rate/100,2);total:=taxable+tax;
  v_sub:=v_sub+taxable;v_disc:=v_disc+disc;v_tax:=v_tax+tax;v_total:=v_total+total;
 end loop;
 v_number:=public.next_document_number(p_org,'quote');
 insert into public.quotes(organization_id,customer_id,number,valid_until,subtotal,discount_total,tax_total,total,created_by)
 values(p_org,p_customer,v_number,p_valid_until,v_sub,v_disc,v_tax,v_total,auth.uid()) returning id into v_quote;
 for r in select value from jsonb_array_elements(p_lines) loop
  q:=(r->>'quantity')::numeric;d:=coalesce((r->>'discount_pct')::numeric,0);unit_price:=(r->>'unit_price')::numeric;
  select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;tax:=round(taxable*s.tax_rate/100,2);total:=taxable+tax;
  insert into public.quote_lines(organization_id,quote_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,v_quote,s.id,s.name,q,s.unit,unit_price,d,disc,taxable,s.tax_rate,tax,total,v_sort);v_sort:=v_sort+1;
 end loop;
 perform public.audit_event(p_org,'quote.created','quote',v_quote,null,jsonb_build_object('number',v_number,'lines',jsonb_array_length(p_lines),'total',v_total));return v_quote;
end;$function$;

CREATE OR REPLACE FUNCTION public.create_quote_from_service(p_org uuid, p_customer uuid, p_service uuid, p_quantity numeric, p_discount_pct numeric, p_valid_until date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s public.services%rowtype;v_id uuid;v_number text;v_gross numeric;v_discount numeric;v_taxable numeric;v_tax numeric;v_total numeric;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'quotes.create');
  if p_quantity <= 0 then raise exception 'Quantité invalide'; end if;
  if p_discount_pct < 0 or p_discount_pct > 100 then raise exception 'Remise invalide'; end if;
  if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then raise exception 'Client invalide';end if;
  select * into v_s from public.services where id=p_service and organization_id=p_org and is_active;
  if not found then raise exception 'Prestation invalide';end if;
  if p_valid_until < public.magnisa_business_date() then raise exception 'Date de validité invalide';end if;
  v_gross:=round(p_quantity*v_s.unit_price,2);v_discount:=round(v_gross*p_discount_pct/100,2);v_taxable:=v_gross-v_discount;v_tax:=round(v_taxable*v_s.tax_rate/100,2);v_total:=v_taxable+v_tax;
  v_number:=public.next_document_number(p_org,'quote');
  insert into public.quotes(organization_id,customer_id,number,valid_until,subtotal,discount_total,tax_total,total,created_by)
  values(p_org,p_customer,v_number,p_valid_until,v_taxable,v_discount,v_tax,v_total,auth.uid()) returning id into v_id;
  insert into public.quote_lines(organization_id,quote_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,v_id,v_s.id,v_s.name,p_quantity,v_s.unit,v_s.unit_price,p_discount_pct,v_discount,v_taxable,v_s.tax_rate,v_tax,v_total,1);
  perform public.audit_event(p_org,'quote.created','quote',v_id,null,jsonb_build_object('number',v_number,'total',v_total));
  return v_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.dashboard_metrics(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_billing boolean;
  v_sales boolean;
  v_treasury boolean;
begin
  perform public.assert_org_access(p_org);

  v_billing := public.has_org_permission(p_org,'billing.view');
  v_sales := public.has_org_permission(p_org,'sales.view');
  v_treasury := public.has_org_permission(p_org,'treasury.view');

  return jsonb_build_object(
    'revenue',
      case when v_billing then coalesce((
        select sum(subtotal) from public.invoices
        where organization_id=p_org and status not in ('draft','cancelled')
      ),0) else 0 end,
    'receipts',
      case when v_treasury then coalesce((
        select sum(amount) from public.payments
        where organization_id=p_org and status in ('confirmed','reconciled')
      ),0) else 0 end,
    'expenses',
      case when v_treasury then coalesce((
        select sum(amount) from public.expenses
        where organization_id=p_org and status in ('validated','paid')
      ),0) else 0 end,
    'receivables',
      case when v_billing then coalesce((
        select sum(balance_due) from public.invoices
        where organization_id=p_org and status not in ('draft','cancelled','paid')
      ),0) else 0 end,
    'cash_available',
      case when v_treasury then coalesce((
        select sum(balance) from public.financial_accounts
        where organization_id=p_org and is_active and type in ('bank','cash','mobile_money')
      ),0) else 0 end,
    'invoice_count',
      case when v_billing then (
        select count(*) from public.invoices where organization_id=p_org
      ) else 0 end,
    'payment_count',
      case when v_treasury then (
        select count(*) from public.payments where organization_id=p_org
      ) else 0 end,
    'expense_count',
      case when v_treasury then (
        select count(*) from public.expenses where organization_id=p_org
      ) else 0 end,
    'overdue_invoice_count',
      case when v_billing then (
        select count(*) from public.invoices
        where organization_id=p_org
          and status not in ('draft','cancelled','paid')
          and balance_due>0
          and due_date<public.magnisa_business_date()
      ) else 0 end,
    'accepted_quote_count',
      case when v_sales then (
        select count(*) from public.quotes
        where organization_id=p_org and status in ('accepted','converted')
      ) else 0 end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.duplicate_quote(p_org uuid, p_quote uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q public.quotes%rowtype;v_new uuid;v_number text;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'quotes.create');
  select * into q from public.quotes where id=p_quote and organization_id=p_org;
  if not found then raise exception 'Devis introuvable';end if;
  v_number:=public.next_document_number(p_org,'quote');
  insert into public.quotes(organization_id,customer_id,number,version,status,issue_date,valid_until,subtotal,discount_total,tax_total,total,notes,created_by)
  values(p_org,q.customer_id,v_number,1,'draft',public.magnisa_business_date(),greatest(public.magnisa_business_date()+30,q.valid_until),q.subtotal,q.discount_total,q.tax_total,q.total,q.notes,auth.uid()) returning id into v_new;
  insert into public.quote_lines(organization_id,quote_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  select organization_id,v_new,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order from public.quote_lines where quote_id=q.id;
  perform public.audit_event(p_org,'quote.duplicated','quote',v_new,null,jsonb_build_object('source_quote_id',q.id,'number',v_number));
  return v_new;
end;$function$;

CREATE OR REPLACE FUNCTION public.issue_customer_credit_note(p_org uuid, p_invoice_id uuid, p_issue_date date, p_lines jsonb, p_reason text, p_request_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_invoice public.invoices%rowtype;
  v_line public.invoice_lines%rowtype;
  v_return public.stock_return_lines%rowtype;
  v_input jsonb;
  v_note uuid;
  v_journal uuid;
  v_number text;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_qty numeric(18,4);
  v_remaining_qty numeric(18,4);
  v_prev_subtotal numeric(18,2);
  v_prev_tax numeric(18,2);
  v_subtotal numeric(18,2);
  v_tax numeric(18,2);
  v_total numeric(18,2);
  v_note_subtotal numeric(18,2):=0;
  v_note_tax numeric(18,2):=0;
  v_note_total numeric(18,2):=0;
  v_applied numeric(18,2);
  v_refundable numeric(18,2);
  v_service numeric(18,2):=0;
  v_merchandise numeric(18,2):=0;
  v_tax_account text;
  v_ar_account text;
  v_lines jsonb;
  v_seen integer:=0;
  v_returned_qty numeric(18,4);
  v_credited_return_qty numeric(18,4);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org) THEN
    RAISE EXCEPTION 'Accès refusé.';
  END IF;
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'invoices.issue');
  IF p_issue_date IS NULL OR p_request_key IS NULL
     OR nullif(trim(coalesce(p_reason,'')),'') IS NULL
     OR jsonb_typeof(p_lines)<>'array'
     OR jsonb_array_length(p_lines)<1 OR jsonb_array_length(p_lines)>100 THEN
    RAISE EXCEPTION 'Données de l''avoir invalides.';
  END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_issue_date);
  v_fingerprint:=md5(p_invoice_id::text||':'||p_issue_date::text||':'||p_lines::text||':'||trim(p_reason));

  SELECT id,request_fingerprint INTO v_note,v_existing_fingerprint
  FROM public.credit_notes
  WHERE organization_id=p_org AND request_key=p_request_key;
  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Clé d''idempotence déjà utilisée avec un contenu différent.';
    END IF;
    RETURN v_note;
  END IF;

  SELECT * INTO v_invoice FROM public.invoices
  WHERE id=p_invoice_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'La facture doit être émise avant de créer un avoir.';
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(p_lines)) <>
     (SELECT count(DISTINCT value->>'invoice_line_id') FROM jsonb_array_elements(p_lines)) THEN
    RAISE EXCEPTION 'Une ligne de facture ne peut apparaître qu''une fois par avoir.';
  END IF;

  v_note:=gen_random_uuid();
  v_number:='AV-'||to_char(p_issue_date,'YYYYMMDD')||'-'||upper(substr(replace(v_note::text,'-',''),1,8));

  INSERT INTO public.credit_notes(
    id,organization_id,invoice_id,customer_id,number,issue_date,subtotal,tax_total,total,
    reason,status,created_by,request_key,request_fingerprint
  ) VALUES (
    v_note,p_org,v_invoice.id,v_invoice.customer_id,v_number,p_issue_date,0,0,0,
    trim(p_reason),'draft',auth.uid(),p_request_key,v_fingerprint
  );

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF nullif(v_input->>'invoice_line_id','') IS NULL
       OR nullif(v_input->>'quantity','') IS NULL THEN
      RAISE EXCEPTION 'Chaque ligne d''avoir doit référencer une ligne de facture et une quantité.';
    END IF;
    v_qty:=(v_input->>'quantity')::numeric;
    IF v_qty<=0 THEN RAISE EXCEPTION 'La quantité créditée doit être positive.'; END IF;

    SELECT * INTO v_line FROM public.invoice_lines
    WHERE id=(v_input->>'invoice_line_id')::uuid
      AND invoice_id=v_invoice.id AND organization_id=p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de facture introuvable.'; END IF;

    SELECT COALESCE(sum(cnl.quantity),0),COALESCE(sum(cnl.subtotal),0),COALESCE(sum(cnl.tax_total),0)
    INTO v_remaining_qty,v_prev_subtotal,v_prev_tax
    FROM public.credit_note_lines cnl
    JOIN public.credit_notes cn ON cn.id=cnl.credit_note_id
      AND cn.organization_id=cnl.organization_id
    WHERE cnl.organization_id=p_org AND cnl.source_invoice_line_id=v_line.id
      AND cn.status IN ('issued','applied');

    v_remaining_qty:=v_line.quantity-v_remaining_qty;
    IF v_qty>v_remaining_qty+0.00000001 THEN
      RAISE EXCEPTION 'La quantité créditée dépasse le reliquat de la ligne de facture.';
    END IF;

    IF v_qty=v_remaining_qty THEN
      v_subtotal:=round(v_line.taxable_amount-v_prev_subtotal,2);
      v_tax:=round(v_line.tax_amount-v_prev_tax,2);
    ELSE
      v_subtotal:=round((v_line.taxable_amount-v_prev_subtotal)*v_qty/v_remaining_qty,2);
      v_tax:=round((v_line.tax_amount-v_prev_tax)*v_qty/v_remaining_qty,2);
    END IF;
    v_total:=v_subtotal+v_tax;

    IF v_line.line_kind='merchandise' THEN
      IF nullif(v_input->>'stock_return_line_id','') IS NULL THEN
        RAISE EXCEPTION 'Un avoir de marchandise doit être lié à un retour physique validé.';
      END IF;
      SELECT * INTO v_return FROM public.stock_return_lines
      WHERE id=(v_input->>'stock_return_line_id')::uuid AND organization_id=p_org FOR UPDATE;
      IF NOT FOUND OR v_return.source_invoice_line_id<>v_line.id THEN
        RAISE EXCEPTION 'La ligne de retour ne correspond pas à la ligne facturée.';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.stock_returns sr
        WHERE sr.id=v_return.return_id AND sr.organization_id=p_org
          AND sr.return_type='customer' AND sr.status='posted') THEN
        RAISE EXCEPTION 'Le retour physique doit être validé avant l''avoir.';
      END IF;
      SELECT COALESCE(sum(quantity),0) INTO v_credited_return_qty
      FROM public.credit_note_lines
      WHERE organization_id=p_org AND stock_return_line_id=v_return.id;
      IF v_qty>v_return.quantity-v_credited_return_qty+0.00000001 THEN
        RAISE EXCEPTION 'La quantité créditée dépasse la quantité retournée et contrôlée.';
      END IF;
    ELSIF nullif(v_input->>'stock_return_line_id','') IS NOT NULL THEN
      RAISE EXCEPTION 'Une prestation ne peut pas référencer une ligne de retour de marchandise.';
    END IF;

    INSERT INTO public.credit_note_lines(
      organization_id,credit_note_id,source_invoice_line_id,stock_return_line_id,
      description,quantity,subtotal,tax_total,total
    ) VALUES (
      p_org,v_note,v_line.id,NULLIF(v_input->>'stock_return_line_id','')::uuid,
      v_line.description,v_qty,v_subtotal,v_tax,v_total
    );

    IF v_line.line_kind='merchandise' THEN
      v_merchandise:=v_merchandise+v_subtotal;
    ELSE
      v_service:=v_service+v_subtotal;
    END IF;
    v_note_subtotal:=v_note_subtotal+v_subtotal;
    v_note_tax:=v_note_tax+v_tax;
    v_note_total:=v_note_total+v_total;
    v_seen:=v_seen+1;
  END LOOP;

  IF v_seen=0 OR v_note_total<=0 THEN RAISE EXCEPTION 'L''avoir doit comporter un montant positif.'; END IF;
  IF v_note_total>v_invoice.total-v_invoice.credited_amount+0.01 THEN
    RAISE EXCEPTION 'Le cumul des avoirs dépasserait le montant TTC de la facture.';
  END IF;
  v_applied:=LEAST(v_note_total,GREATEST(0,v_invoice.balance_due));
  v_refundable:=v_note_total-v_applied;

  UPDATE public.credit_notes SET subtotal=v_note_subtotal,tax_total=v_note_tax,total=v_note_total,
    applied_amount=v_applied,refundable_amount=v_refundable,status='draft'
  WHERE id=v_note AND organization_id=p_org;

  v_lines:='[]'::jsonb;
  IF v_service>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'pcg_code',public.magnisa_resolve_pcg_account(p_org,'customer_credit_note','recognition','service_revenue','debit'),
      'debit',v_service,'credit',0));
  END IF;
  IF v_merchandise>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'pcg_code',public.magnisa_resolve_pcg_account(p_org,'customer_credit_note','recognition','merchandise_revenue','debit'),
      'debit',v_merchandise,'credit',0));
  END IF;
  IF v_note_tax>0 THEN
    v_tax_account:=public.magnisa_resolve_pcg_account(p_org,'customer_credit_note','recognition','tax_payable','debit');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('pcg_code',v_tax_account,'debit',v_note_tax,'credit',0));
  END IF;
  v_ar_account:=public.magnisa_resolve_pcg_account(p_org,'customer_credit_note','recognition','customer_receivable','credit');
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('pcg_code',v_ar_account,'debit',0,'credit',v_note_total));

  v_journal:=public.magnisa_post_journal(
    p_org,p_issue_date,v_number,'Avoir client lié à la facture '||v_invoice.number,
    'credit_note',v_note,v_lines
  );

  UPDATE public.credit_notes SET status=CASE WHEN v_refundable=0 THEN 'applied' ELSE 'issued' END,
    journal_entry_id=v_journal
  WHERE id=v_note AND organization_id=p_org;

  UPDATE public.invoices SET credited_amount=credited_amount+v_applied,
    balance_due=GREATEST(0,total-paid_amount-credited_amount-v_applied),
    status=CASE WHEN GREATEST(0,total-paid_amount-credited_amount-v_applied)=0 THEN 'paid'
      WHEN due_date IS NOT NULL AND due_date<public.magnisa_business_date() THEN 'overdue'
      WHEN paid_amount>0 THEN 'partially_paid' ELSE 'issued' END,
    updated_at=now()
  WHERE id=v_invoice.id AND organization_id=p_org;

  PERFORM public.audit_event(p_org,'credit_note.issued','credit_note',v_note,NULL,
    jsonb_build_object('invoice_id',v_invoice.id,'subtotal',v_note_subtotal,
      'tax_total',v_note_tax,'total',v_note_total,'applied_amount',v_applied,
      'refundable_amount',v_refundable,'journal_entry_id',v_journal));
  RETURN v_note;
END;
$function$;

CREATE OR REPLACE FUNCTION public.magnisa_close_fiscal_year(p_org uuid, p_year uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_year public.accounting_fiscal_years%rowtype;
  v_bad bigint;
  v_period uuid;
  v_lines jsonb;
  v_result numeric;
  v_closing_entry uuid;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  SELECT * INTO v_year FROM public.accounting_fiscal_years
  WHERE id=p_year AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_year.status <> 'open' THEN RAISE EXCEPTION 'Exercice introuvable ou déjà clôturé'; END IF;
  IF v_year.period_end > public.magnisa_business_date() THEN
    RAISE EXCEPTION 'Clôture impossible avant la fin de l’exercice';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.pcg2005_journal_integrity j
  WHERE j.organization_id=p_org AND j.entry_date BETWEEN v_year.period_start AND v_year.period_end
    AND j.integrity_status <> 'equilibree';
  IF v_bad > 0 THEN RAISE EXCEPTION 'Clôture refusée : % écriture(s) déséquilibrée(s)',v_bad; END IF;

  SELECT count(*) INTO v_bad
  FROM public.pcg2005_journal_lines l
  WHERE l.organization_id=p_org AND l.entry_date BETWEEN v_year.period_start AND v_year.period_end
    AND l.status='posted' AND l.mapping_status='a_mapper';
  IF v_bad > 0 THEN RAISE EXCEPTION 'Clôture refusée : % ligne(s) sans imputation PCG',v_bad; END IF;

  PERFORM public.magnisa_assert_accounting_invariants(p_org);

  SELECT coalesce(sum(CASE WHEN pcg_code LIKE '7%' THEN credit-debit ELSE 0 END),0)
       - coalesce(sum(CASE WHEN pcg_code LIKE '6%' THEN debit-credit ELSE 0 END),0)
  INTO v_result
  FROM public.pcg2005_journal_lines
  WHERE organization_id=p_org AND status='posted'
    AND entry_date BETWEEN v_year.period_start AND v_year.period_end
    AND (pcg_code LIKE '6%' OR pcg_code LIKE '7%');

  SELECT jsonb_agg(x.line ORDER BY x.sort_code) INTO v_lines
  FROM (
    SELECT pcg_code AS sort_code,
      jsonb_build_object('account_kind','pcg','pcg_code',pcg_code,
        'debit',greatest(-balance,0),'credit',greatest(balance,0)) AS line
    FROM (
      SELECT pcg_code,round(sum(debit-credit),2) AS balance
      FROM public.pcg2005_journal_lines
      WHERE organization_id=p_org AND status='posted'
        AND entry_date BETWEEN v_year.period_start AND v_year.period_end
        AND (pcg_code LIKE '6%' OR pcg_code LIKE '7%')
      GROUP BY pcg_code HAVING round(sum(debit-credit),2)<>0
    ) balances
    UNION ALL
    SELECT CASE WHEN v_result >= 0 THEN '120' ELSE '129' END,
      jsonb_build_object('account_kind','pcg','pcg_code',CASE WHEN v_result >= 0 THEN '120' ELSE '129' END,
        'debit',greatest(-v_result,0),'credit',greatest(v_result,0))
    WHERE round(v_result,2)<>0
  ) x;

  IF v_lines IS NOT NULL AND jsonb_array_length(v_lines)>0 THEN
    v_closing_entry:=public.magnisa_post_journal(
      p_org,v_year.period_end,'CL-'||to_char(v_year.period_end,'YYYYMMDD')||'-'||substr(v_year.id::text,1,8),
      'Centralisation des comptes de gestion - résultat '||v_year.label,
      'fiscal_year_closing',v_year.id,v_lines
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounting_periods p
    WHERE p.organization_id=p_org AND p.status='closed'
      AND daterange(p.period_start,p.period_end,'[]') && daterange(v_year.period_start,v_year.period_end,'[]')
  ) THEN RAISE EXCEPTION 'Une période de cet exercice est déjà clôturée'; END IF;

  INSERT INTO public.accounting_periods(organization_id,period_start,period_end,status,closed_at,closed_by)
  VALUES(p_org,v_year.period_start,v_year.period_end,'closed',now(),auth.uid())
  RETURNING id INTO v_period;
  UPDATE public.accounting_fiscal_years
  SET status='closed',closed_at=now(),closed_by=auth.uid()
  WHERE id=p_year AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'accounting.fiscal_year.closed','accounting_fiscal_year',p_year,NULL,
    jsonb_build_object('period_start',v_year.period_start,'period_end',v_year.period_end,
      'period_id',v_period,'closing_entry_id',v_closing_entry,'result',v_result));
  RETURN p_year;
END;
$function$;

CREATE OR REPLACE FUNCTION public.magnisa_confirm_transfer_credit(p_org uuid, p_transfer uuid, p_date date, p_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t public.magnisa_internal_transfers%rowtype;v_dest public.financial_accounts%rowtype;v_entry uuid;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'treasury.transfer');
 SELECT * INTO v_t FROM public.magnisa_internal_transfers WHERE id=p_transfer AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable'; END IF;
 IF v_t.status='completed' THEN
   IF v_t.destination_reference= btrim(p_reference) THEN RETURN v_t.id; END IF;
   RAISE EXCEPTION 'Transfert deja confirme avec une autre reference';
 END IF;
 IF p_date IS NULL OR p_date<v_t.transfer_date OR p_date>public.magnisa_business_date() OR nullif(btrim(p_reference),'') IS NULL
 THEN RAISE EXCEPTION 'Date ou reference de credit invalide'; END IF;
 SELECT * INTO v_dest FROM public.financial_accounts WHERE id=v_t.destination_account_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Compte destination introuvable'; END IF;
 UPDATE public.financial_accounts SET balance=balance+v_t.destination_credit,updated_at=now() WHERE id=v_t.destination_account_id AND organization_id=p_org;
 INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
 VALUES(p_org,v_t.destination_account_id,p_date,v_t.destination_credit,'transfer_in','internal_transfer',v_t.id,btrim(p_reference),'Credit du transfert interne confirme');
 INSERT INTO public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit,status)
 VALUES(p_org,p_date,btrim(p_reference),'Credit destinataire confirme - sortie du transit','internal_transfer_credit',v_t.id,v_t.destination_credit,v_t.destination_credit,'posted') RETURNING id INTO v_entry;
 INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id)
 VALUES(p_org,v_entry,'TREASURY:'||v_t.destination_account_id::text,v_dest.name,v_t.destination_credit,0,v_t.destination_account_id),
 (p_org,v_entry,'TRANSIT:'||v_t.id::text,'Fonds en transit',0,v_t.destination_credit,null);
 UPDATE public.magnisa_internal_transfers SET status='completed',received_date=p_date,destination_reference=btrim(p_reference),completed_at=now() WHERE id=v_t.id;
 RETURN v_t.id;
END;$function$;

CREATE OR REPLACE FUNCTION public.magnisa_record_transfer_debit(p_org uuid, p_source uuid, p_destination uuid, p_date date, p_source_debit numeric, p_destination_credit numeric, p_fee numeric, p_reference text, p_request_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_source public.financial_accounts%rowtype;v_dest public.financial_accounts%rowtype;v_entry uuid;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'treasury.transfer');
 IF p_source=p_destination OR p_source IS NULL OR p_destination IS NULL THEN RAISE EXCEPTION 'Comptes source et destination distincts requis'; END IF;
 IF p_date IS NULL OR p_date>public.magnisa_business_date() THEN RAISE EXCEPTION 'Date de debit invalide'; END IF;
 IF p_source_debit IS NULL OR p_destination_credit IS NULL OR p_fee IS NULL
 OR p_source_debit<=0 OR p_destination_credit<=0 OR p_fee<0
 OR round(p_source_debit,2)<>p_source_debit OR round(p_destination_credit,2)<>p_destination_credit
 OR round(p_fee,2)<>p_fee OR p_source_debit<>p_destination_credit+p_fee
 THEN RAISE EXCEPTION 'Montants incoherents : debit = credit attendu + frais'; END IF;
 IF nullif(btrim(p_reference),'') IS NULL OR p_request_key IS NULL THEN RAISE EXCEPTION 'Reference reelle et identifiant requis'; END IF;
 SELECT id INTO v_id FROM public.magnisa_internal_transfers WHERE organization_id=p_org AND request_key=p_request_key;
 IF FOUND THEN
   IF NOT EXISTS (SELECT 1 FROM public.magnisa_internal_transfers WHERE id=v_id AND source_account_id=p_source AND destination_account_id=p_destination AND source_debit=p_source_debit AND destination_credit=p_destination_credit AND operator_fee=p_fee AND source_reference=btrim(p_reference)) THEN RAISE EXCEPTION 'Cle de repetition deja utilisee pour une autre transaction'; END IF;
   RETURN v_id;
 END IF;
 SELECT * INTO v_source FROM public.financial_accounts WHERE id=p_source AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR NOT v_source.is_active THEN RAISE EXCEPTION 'Compte source introuvable ou inactif'; END IF;
 SELECT * INTO v_dest FROM public.financial_accounts WHERE id=p_destination AND organization_id=p_org;
 IF NOT FOUND OR NOT v_dest.is_active THEN RAISE EXCEPTION 'Compte destinataire introuvable ou inactif'; END IF;
 IF v_source.balance<p_source_debit THEN RAISE EXCEPTION 'Solde insuffisant'; END IF;
 INSERT INTO public.magnisa_internal_transfers(organization_id,source_account_id,destination_account_id,request_key,transfer_date,source_debit,destination_credit,operator_fee,source_reference)
 VALUES (p_org,p_source,p_destination,p_request_key,p_date,p_source_debit,p_destination_credit,p_fee,btrim(p_reference))
 RETURNING id INTO v_id;
 UPDATE public.financial_accounts SET balance=balance-p_source_debit,updated_at=now() WHERE id=p_source AND organization_id=p_org;
 INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
 VALUES(p_org,p_source,p_date,-p_destination_credit,'transfer_out','internal_transfer',v_id,btrim(p_reference),'Transfert en transit vers '||v_dest.name);
 IF p_fee>0 THEN
  INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  VALUES(p_org,p_source,p_date,-p_fee,'expense','operator_fee',v_id,btrim(p_reference),'Frais reels de transfert vers '||v_dest.name);
 END IF;
 INSERT INTO public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit,status)
 VALUES(p_org,p_date,btrim(p_reference),'Debit source confirme - fonds en transit','internal_transfer_debit',v_id,p_source_debit,p_source_debit,'posted') RETURNING id INTO v_entry;
 INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id)
 VALUES (p_org,v_entry,'TRANSIT:'||v_id::text,'Fonds en transit',p_destination_credit,0,null),
 (p_org,v_entry,'TREASURY:'||p_source::text,v_source.name,0,p_source_debit,p_source);
 IF p_fee>0 THEN
  INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id)
  VALUES(p_org,v_entry,'TRANSFER_FEES','Frais de transfert reels',p_fee,0,null);
 END IF;
 RETURN v_id;
END;$function$;

CREATE OR REPLACE FUNCTION public.magnisa_resolve_pcg_account(p_org uuid, p_operation_type text, p_event_type text, p_operation_key text, p_role text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_code text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  SELECT CASE p_role WHEN 'debit' THEN r.debit_account_code WHEN 'credit' THEN r.credit_account_code WHEN 'fee' THEN r.fee_account_code END
  INTO v_code FROM public.accounting_posting_rules r
  WHERE r.operation_type=p_operation_type AND r.event_type=p_event_type AND r.operation_key=p_operation_key AND r.active
    AND r.valid_from<=public.magnisa_business_date() AND (r.valid_to IS NULL OR r.valid_to>=public.magnisa_business_date())
    AND (r.organization_id=p_org OR r.organization_id IS NULL)
  ORDER BY CASE WHEN r.organization_id=p_org THEN 0 ELSE 1 END,r.priority,r.valid_from DESC LIMIT 1;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Aucune règle comptable valide pour %, %, %',p_operation_type,p_event_type,p_operation_key; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_code) THEN RAISE EXCEPTION 'Compte PCG % absent du plan actif',v_code; END IF;
  RETURN v_code;
END; $function$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_org uuid, p_invoice uuid, p_account uuid, p_amount numeric, p_paid_at date, p_method text, p_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 i public.invoices%rowtype;
 a public.financial_accounts%rowtype;
 v_payment uuid;v_entry uuid;v_new_paid numeric;v_balance numeric;v_status text;
 v_number text;v_reference text;v_receipt_sequence bigint;v_year integer;v_reservation public.cash_receipt_reservations%rowtype;
begin
 perform public.assert_org_access(p_org);
 perform public.assert_org_permission(p_org,'payments.record');
 if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide'; end if;
 if p_paid_at is null then raise exception 'Date de paiement obligatoire'; end if;
 if p_method not in ('bank_transfer','cash','mobile_money','cheque','card','other') then
   raise exception 'Mode de paiement invalide';
 end if;
 select * into i from public.invoices where id=p_invoice and organization_id=p_org for update;
 if not found then raise exception 'Facture introuvable'; end if;
 if i.status in ('draft','cancelled') then raise exception 'Paiement impossible sur cette facture'; end if;
 if p_amount>i.balance_due then raise exception 'Le paiement dépasse le solde restant'; end if;
 select * into a from public.financial_accounts
 where id=p_account and organization_id=p_org and is_active for update;
 if not found then raise exception 'Compte financier invalide'; end if;
 if p_method='cheque' and a.type<>'cheque_clearing' then
   raise exception 'Un chèque reçu doit aller dans Chèques à encaisser';
 end if;
 if p_method='cash' and a.type<>'cash' then
   raise exception 'Un paiement en espèces doit aller dans un compte Caisse';
 end if;
 v_number:=public.next_document_number(p_org,'payment');
 if p_method='cash' then
   v_year:=extract(year from p_paid_at)::integer;
   if nullif(trim(p_reference),'') is not null then
     select * into v_reservation
     from public.cash_receipt_reservations
     where organization_id=p_org and reference=trim(p_reference)
       and receipt_year=v_year and reserved_by=auth.uid()
       and payment_id is null for update;
     if not found then raise exception 'Référence de caisse non réservée ou déjà utilisée'; end if;
     v_reference:=v_reservation.reference;
   else
     insert into public.cash_receipt_sequences(organization_id,receipt_year,next_value)
     values(p_org,v_year,2)
     on conflict(organization_id,receipt_year) do update
     set next_value=public.cash_receipt_sequences.next_value+1
     returning next_value-1 into v_receipt_sequence;
     v_reference:='REC-'||v_year::text||'-'||lpad(v_receipt_sequence::text,5,'0');
   end if;
 else
   v_reference:=coalesce(nullif(trim(p_reference),''),v_number);
 end if;
 insert into public.payments(organization_id,invoice_id,customer_id,financial_account_id,reference,amount,method,status,paid_at,created_by)
 values(p_org,i.id,i.customer_id,a.id,v_reference,p_amount,p_method,'confirmed',p_paid_at,auth.uid())
 returning id into v_payment;
 if p_method='cash' and v_reservation.id is not null then
    update public.cash_receipt_reservations
       set payment_id=v_payment
     where id=v_reservation.id and payment_id is null;
 end if;
 update public.financial_accounts set balance=balance+p_amount,updated_at=now() where id=a.id;
 insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
 values(p_org,a.id,p_paid_at,p_amount,'customer_payment','payment',v_payment,v_reference,'Paiement facture '||i.number);
 v_new_paid:=i.paid_amount+p_amount; v_balance:=i.total-v_new_paid;
 v_status:=case when v_balance=0 then 'paid'
 when i.due_date is not null and i.due_date<public.magnisa_business_date() then 'overdue'
 else 'partially_paid' end;
 update public.invoices set paid_amount=v_new_paid,balance_due=v_balance,status=v_status,updated_at=now()
 where id=i.id;
 insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
 values(p_org,p_paid_at,v_reference,'Encaissement '||i.number,'payment',v_payment,p_amount,p_amount)
 returning id into v_entry;
 insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id,customer_id)
 values
 (p_org,v_entry,'TREASURY:'||a.id::text,a.name,p_amount,0,a.id,i.customer_id),
 (p_org,v_entry,'AR','Créances clients',0,p_amount,null,i.customer_id);
 perform public.audit_event(p_org,'payment.recorded','payment',v_payment,null,
 jsonb_build_object('invoice_id',i.id,'amount',p_amount,'account_id',a.id,'reference',v_reference));
 return v_payment;
end;$function$;

CREATE OR REPLACE FUNCTION public.record_loan_repayment(p_organization_id uuid, p_loan_id uuid, p_installment_id uuid, p_payment_date date, p_amount numeric, p_financial_account_id uuid, p_request_key uuid, p_payment_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
  if p_payment_date is null or p_payment_date > public.magnisa_business_date() then raise exception 'La date de paiement doit être renseignée et ne peut pas être future'; end if;
  if p_amount is null or p_amount <= 0 or round(p_amount,2) <> p_amount then raise exception 'Le montant doit être positif et limité à deux décimales'; end if;

  v_digest := md5(jsonb_build_array(p_organization_id,p_loan_id,p_installment_id,p_payment_date,p_amount,p_financial_account_id,p_payment_reference,p_notes)::text);
  insert into public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest)
  values (p_organization_id,p_request_key,'loan_repayment',v_digest)
  on conflict (organization_id,request_key) do nothing;
  select * into strict v_idempotency from public.lot1_financial_idempotency where organization_id=p_organization_id and request_key=p_request_key for update;
  if v_idempotency.operation_type <> 'loan_repayment' or v_idempotency.request_digest <> v_digest then raise exception 'Clé de requête déjà utilisée pour une autre opération'; end if;
  if v_idempotency.result_id is not null then return v_idempotency.result_id; end if;

  select * into v_loan from public.loans where id=p_loan_id and organization_id=p_organization_id for update;
  if not found or v_loan.status <> 'active' then raise exception 'Emprunt introuvable ou non actif'; end if;
  if v_loan.active_schedule_version_id is null then raise exception 'Aucun échéancier actif n''est associé à cet emprunt'; end if;
  if p_payment_date < v_loan.start_date then raise exception 'La date de paiement précède la date de départ du contrat'; end if;
  if v_loan.liability_account_code is null or v_loan.liability_account_code not in ('164','168') then raise exception 'Le compte de dette PCG doit être configuré sur le contrat'; end if;

  if not exists (select 1 from public.loan_schedule_versions v where v.id=v_loan.active_schedule_version_id and v.loan_id=p_loan_id and v.organization_id=p_organization_id and v.status='active') then
    raise exception 'La version active de l''échéancier est invalide';
  end if;

  select * into v_account from public.financial_accounts where id=p_financial_account_id and organization_id=p_organization_id and is_active for update;
  if not found then raise exception 'Compte de trésorerie invalide ou inactif'; end if;

  if p_installment_id is not null then
    select * into v_installment from public.loan_installments where id=p_installment_id and loan_id=p_loan_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id for update;
    if not found or v_installment.status in ('paid','cancelled') then raise exception 'Échéance introuvable dans l''échéancier actif ou déjà soldée'; end if;
    if exists (select 1 from public.loan_installments earlier where earlier.loan_id=p_loan_id and earlier.organization_id=p_organization_id and earlier.schedule_version_id=v_loan.active_schedule_version_id and earlier.installment_number<v_installment.installment_number and earlier.status in ('planned','partial','overdue')) then raise exception 'Règle les échéances précédentes avant celle-ci'; end if;

    select coalesce(sum(fees_paid),0),coalesce(sum(penalty_paid),0),coalesce(sum(interest_paid),0),coalesce(sum(principal_paid),0)
    into v_paid_fees,v_paid_penalty,v_paid_interest,v_paid_principal
    from public.loan_repayments where installment_id=p_installment_id and organization_id=p_organization_id and status='posted';
    v_remaining_fees:=greatest(v_installment.fees_due-v_paid_fees,0);
    v_remaining_penalty:=greatest(v_installment.penalty_due-v_paid_penalty,0);
    v_remaining_interest:=greatest(v_installment.interest_due-v_paid_interest,0);
    v_remaining_principal:=greatest(v_installment.principal_due-v_paid_principal,0);
    if p_amount > v_remaining_fees+v_remaining_penalty+v_remaining_interest+v_remaining_principal then raise exception 'Le paiement dépasse le solde de cette échéance. Utilise un remboursement anticipé distinct pour le capital supplémentaire.'; end if;
    v_left:=p_amount;
    if v_loan.repayment_allocation_order='charges_first' then
      v_paid_fees:=least(v_left,v_remaining_fees); v_left:=v_left-v_paid_fees;
      v_paid_penalty:=least(v_left,v_remaining_penalty); v_left:=v_left-v_paid_penalty;
      v_paid_interest:=least(v_left,v_remaining_interest); v_left:=v_left-v_paid_interest;
      v_paid_principal:=least(v_left,v_remaining_principal);
    elsif v_loan.repayment_allocation_order='interest_first' then
      v_paid_interest:=least(v_left,v_remaining_interest); v_left:=v_left-v_paid_interest;
      v_paid_fees:=least(v_left,v_remaining_fees); v_left:=v_left-v_paid_fees;
      v_paid_penalty:=least(v_left,v_remaining_penalty); v_left:=v_left-v_paid_penalty;
      v_paid_principal:=least(v_left,v_remaining_principal);
    else
      v_paid_principal:=least(v_left,v_remaining_principal); v_left:=v_left-v_paid_principal;
      v_paid_interest:=least(v_left,v_remaining_interest); v_left:=v_left-v_paid_interest;
      v_paid_fees:=least(v_left,v_remaining_fees); v_left:=v_left-v_paid_fees;
      v_paid_penalty:=least(v_left,v_remaining_penalty);
    end if;
  else
    if exists (select 1 from public.loan_installments where loan_id=p_loan_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id and (status in ('overdue','partial') or (due_date<=p_payment_date and status='planned'))) then raise exception 'Règle d''abord les échéances arrivées à terme avant le remboursement anticipé'; end if;
    if exists (select 1 from public.loan_repayments r join public.loan_installments i on i.id=r.installment_id and i.organization_id=r.organization_id where r.loan_id=p_loan_id and r.organization_id=p_organization_id and r.status='posted' and r.payment_date>p_payment_date and i.schedule_version_id=v_loan.active_schedule_version_id) then raise exception 'Un remboursement postérieur à la date choisie existe déjà ; régularise-le avant le remboursement anticipé'; end if;
    if p_amount>=v_loan.outstanding_principal then raise exception 'Ce parcours accepte uniquement une réduction partielle du capital. La clôture totale doit intégrer les intérêts courus et indemnités éventuelles.'; end if;
    v_paid_principal:=round(p_amount,2);
  end if;

  if v_paid_fees>0 and v_loan.fee_account_code is null then raise exception 'Configure le compte PCG des frais sur le contrat avant de les payer'; end if;
  if v_paid_penalty>0 and v_loan.penalty_account_code is null then raise exception 'Configure le compte PCG des pénalités sur le contrat avant de les payer'; end if;
  v_this_principal:=v_paid_principal; v_this_interest:=v_paid_interest; v_this_fees:=v_paid_fees; v_this_penalty:=v_paid_penalty;
  v_reference:=coalesce(nullif(btrim(p_payment_reference),''),public.next_document_number(p_organization_id,'payment'));

  insert into public.loan_repayments(organization_id,loan_id,installment_id,payment_date,amount,principal_paid,interest_paid,fees_paid,penalty_paid,financial_account_id,payment_reference,notes,status,request_key,created_by)
  values (p_organization_id,p_loan_id,p_installment_id,p_payment_date,round(p_amount,2),v_paid_principal,v_paid_interest,v_paid_fees,v_paid_penalty,p_financial_account_id,v_reference,nullif(btrim(coalesce(p_notes,'')),''),'posted',p_request_key,auth.uid()) returning id into v_repayment_id;

  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=p_financial_account_id and organization_id=p_organization_id;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  values (p_organization_id,p_financial_account_id,p_payment_date,-round(p_amount,2),'expense','loan_repayment',v_repayment_id,v_reference,case when p_installment_id is null then 'Remboursement anticipé d’emprunt' else 'Remboursement d’emprunt' end) returning id into v_transaction_id;

  if v_this_principal>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',v_loan.liability_account_code,'debit',v_this_principal,'credit',0)); end if;
  if v_this_interest>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code','661','debit',v_this_interest,'credit',0)); end if;
  if v_this_fees>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',v_loan.fee_account_code,'debit',v_this_fees,'credit',0)); end if;
  if v_this_penalty>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',v_loan.penalty_account_code,'debit',v_this_penalty,'credit',0)); end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_kind','treasury','financial_account_id',v_account.id::text,'account_label',v_account.name,'debit',0,'credit',round(p_amount,2)));
  v_journal_id:=public.magnisa_post_journal(p_organization_id,p_payment_date,v_reference,case when p_installment_id is null then 'Remboursement anticipé d’emprunt' else 'Remboursement d’emprunt' end,'loan_repayment',v_repayment_id,v_lines);
  update public.loan_repayments set financial_transaction_id=v_transaction_id,journal_entry_id=v_journal_id,updated_at=now() where id=v_repayment_id and organization_id=p_organization_id;

  v_new_balance:=round(v_loan.outstanding_principal-v_paid_principal,2);
  if v_new_balance<0 then raise exception 'Le capital restant dû ne peut pas devenir négatif'; end if;

  if p_installment_id is not null then
    insert into public.loan_repayment_installment_snapshots(organization_id,repayment_id,installment_id,opening_principal,principal_due,interest_due,fees_due,penalty_due,total_due,closing_principal,status)
    select organization_id,v_repayment_id,id,opening_principal,principal_due,interest_due,fees_due,penalty_due,total_due,closing_principal,status from public.loan_installments where id=p_installment_id and organization_id=p_organization_id on conflict do nothing;
    select coalesce(sum(amount),0) into v_total_paid from public.loan_repayments where installment_id=p_installment_id and organization_id=p_organization_id and status='posted';
    update public.loan_installments set status=case when round(v_total_paid,2)>=total_due then 'paid' else 'partial' end,updated_at=now() where id=p_installment_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id;
  else
    insert into public.loan_repayment_installment_snapshots(organization_id,repayment_id,installment_id,opening_principal,principal_due,interest_due,fees_due,penalty_due,total_due,closing_principal,status)
    select organization_id,v_repayment_id,id,opening_principal,principal_due,interest_due,fees_due,penalty_due,total_due,closing_principal,status from public.loan_installments where loan_id=p_loan_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id and status='planned' and due_date>p_payment_date on conflict do nothing;

    v_schedule_balance:=v_new_balance;
    select count(*) into v_remaining_count from public.loan_installments where loan_id=p_loan_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id and status='planned' and due_date>p_payment_date;
    if v_schedule_balance=0 then
      update public.loan_installments set status='cancelled',updated_at=now() where loan_id=p_loan_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id and status='planned' and due_date>p_payment_date;
    else
      if v_remaining_count=0 then raise exception 'Aucune échéance future disponible pour recalculer le capital restant dû'; end if;
      v_periodic_rate:=coalesce(v_loan.interest_rate,0)/100/v_loan.payment_frequency;
      v_regular_payment:=case when v_periodic_rate=0 then v_schedule_balance/v_remaining_count else v_schedule_balance*v_periodic_rate/(1-power(1+v_periodic_rate,-v_remaining_count)) end;
      for v_row in select * from public.loan_installments where loan_id=p_loan_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id and status='planned' and due_date>p_payment_date order by installment_number for update loop
        v_schedule_interest:=round(v_schedule_balance*v_periodic_rate,2);
        if v_loan.repayment_method='bullet' then
          v_schedule_principal:=case when v_row.installment_number=(select max(installment_number) from public.loan_installments where loan_id=p_loan_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id and status='planned' and due_date>p_payment_date) then v_schedule_balance else 0 end;
        elsif v_loan.repayment_method='equal_principal' then
          v_schedule_principal:=case when v_row.installment_number=(select max(installment_number) from public.loan_installments where loan_id=p_loan_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id and status='planned' and due_date>p_payment_date) then v_schedule_balance else least(v_schedule_balance,round(v_new_balance/v_remaining_count,2)) end;
        else
          v_schedule_principal:=case when v_row.installment_number=(select max(installment_number) from public.loan_installments where loan_id=p_loan_id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id and status='planned' and due_date>p_payment_date) then v_schedule_balance else least(v_schedule_balance,round(v_regular_payment-v_schedule_interest,2)) end;
        end if;
        update public.loan_installments set opening_principal=v_schedule_balance,principal_due=v_schedule_principal,interest_due=v_schedule_interest,total_due=v_schedule_principal+v_schedule_interest+fees_due+penalty_due,closing_principal=v_schedule_balance-v_schedule_principal,updated_at=now() where id=v_row.id and organization_id=p_organization_id and schedule_version_id=v_loan.active_schedule_version_id;
        v_schedule_balance:=round(v_schedule_balance-v_schedule_principal,2);
      end loop;
      if v_schedule_balance<>0 then raise exception 'Le nouvel échéancier ne solde pas le capital après remboursement anticipé'; end if;
    end if;
  end if;

  update public.loans set outstanding_principal=v_new_balance,status=case when v_new_balance=0 then 'paid' else 'active' end,updated_at=now() where id=p_loan_id and organization_id=p_organization_id;
  select i.due_date,greatest(i.total_due-coalesce(sum(r.amount),0),0) into v_next_date,v_next_amount
  from public.loan_installments i left join public.loan_repayments r on r.installment_id=i.id and r.organization_id=i.organization_id and r.status='posted'
  where i.loan_id=p_loan_id and i.organization_id=p_organization_id and i.schedule_version_id=v_loan.active_schedule_version_id and i.status in ('planned','partial','overdue')
  group by i.id,i.due_date,i.total_due having greatest(i.total_due-coalesce(sum(r.amount),0),0)>0 order by i.due_date,i.id limit 1;
  update public.loans set next_due_date=v_next_date,next_due_amount=v_next_amount,updated_at=now() where id=p_loan_id and organization_id=p_organization_id;
  update public.loan_repayments set updated_at=now() where id=v_repayment_id and organization_id=p_organization_id;
  perform public.audit_event(p_organization_id,'loan.repayment_posted','loan_repayment',v_repayment_id,null,jsonb_build_object('loan_id',p_loan_id,'amount',p_amount,'principal_paid',v_paid_principal,'interest_paid',v_paid_interest,'fees_paid',v_paid_fees,'penalty_paid',v_paid_penalty,'payment_date',p_payment_date,'active_schedule_version_id',v_loan.active_schedule_version_id));
  update public.lot1_financial_idempotency set result_id=v_repayment_id,updated_at=now() where organization_id=p_organization_id and request_key=p_request_key;
  return v_repayment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_loan_repayment(p_organization_id uuid, p_repayment_id uuid, p_reversal_date date, p_request_key uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
  if p_reversal_date is null or p_reversal_date > public.magnisa_business_date() then
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

  IF v_repayment.installment_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.loan_installments i
    WHERE i.id = v_repayment.installment_id
      AND i.organization_id = p_organization_id
      AND i.schedule_version_id <> v_loan.active_schedule_version_id
  ) THEN
    RAISE EXCEPTION 'Contrepassation bloquée : le remboursement appartient à un échéancier historique. Une régularisation comptable dédiée est nécessaire.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.loan_repayment_installment_snapshots s
    JOIN public.loan_installments i ON i.id = s.installment_id
    WHERE s.organization_id = p_organization_id
      AND s.repayment_id = v_repayment.id
      AND i.schedule_version_id <> v_loan.active_schedule_version_id
  ) THEN
    RAISE EXCEPTION 'Contrepassation bloquée : le remboursement référence des échéances d’un échéancier historique.';
  END IF;

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
    'reimbursement', 'loan_repayment_reversal', v_repayment.id, v_reference,
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

  update public.journal_entries
  set status = 'reversed'
  where id = v_original_journal.id
    and organization_id = p_organization_id
    and status = 'posted';

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

CREATE OR REPLACE FUNCTION public.run_loan_deadline_notifications(p_run_date date DEFAULT public.magnisa_business_date())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ declare v_installment record; v_paid numeric; v_remaining numeric; v_days integer; v_rule_key text; v_priority text; v_title text; v_body text; v_dedupe text; v_notification_id uuid; v_created integer := 0; v_skipped integer := 0; v_org_member record; v_pref record; begin for v_installment in select li.id,li.organization_id,li.loan_id,li.installment_number,li.due_date,li.total_due from public.loan_installments li join public.loans l on l.id=li.loan_id where li.due_date between p_run_date-1 and p_run_date+7 and coalesce(li.total_due,0)>0 and coalesce(l.status,'') not in ('closed','cancelled','canceled','settled') loop select coalesce(sum(lr.amount),0) into v_paid from public.loan_repayments lr where lr.installment_id=v_installment.id and lr.status='posted' and lr.reversed_at is null; v_remaining:=greatest(coalesce(v_installment.total_due,0)-v_paid,0); if v_remaining<=0 then v_skipped:=v_skipped+1; continue; end if; v_days:=p_run_date-v_installment.due_date; if v_days=-7 then v_rule_key:='loan_installment_due_7d';v_priority:='attention';v_title:='Échéance d’emprunt dans 7 jours';v_body:='Une échéance d’emprunt est prévue dans 7 jours. Consulte les dossiers auxquels tu as accès.'; elsif v_days=-3 then v_rule_key:='loan_installment_due_3d';v_priority:='attention';v_title:='Échéance d’emprunt dans 3 jours';v_body:='Une échéance d’emprunt est prévue dans 3 jours. Consulte les dossiers auxquels tu as accès.'; elsif v_days=-1 then v_rule_key:='loan_installment_due_1d';v_priority:='urgent';v_title:='Échéance d’emprunt demain';v_body:='Une échéance d’emprunt est prévue demain. Consulte les dossiers auxquels tu as accès.'; elsif v_days=0 then v_rule_key:='loan_installment_due_today';v_priority:='urgent';v_title:='Échéance d’emprunt aujourd’hui';v_body:='Une échéance d’emprunt arrive à échéance aujourd’hui. Consulte les dossiers auxquels tu as accès.'; elsif v_days=1 then v_rule_key:='loan_installment_overdue';v_priority:='critical';v_title:='Échéance d’emprunt en retard';v_body:='Une échéance d’emprunt n’a pas été soldée à la date prévue. Consulte les dossiers auxquels tu as accès.'; else continue; end if; if v_paid>0 then v_priority:=case when v_days>0 then 'critical' else 'urgent' end;v_title:=case when v_days>0 then 'Échéance d’emprunt partiellement réglée et en retard' else 'Échéance d’emprunt partiellement réglée' end;v_body:='Une échéance d’emprunt reste partiellement réglée. Consulte les dossiers auxquels tu as accès.'; end if; v_dedupe:=format('loan-installment:%s:%s',v_installment.id,v_rule_key); for v_org_member in select om.user_id from public.organization_members om where om.organization_id=v_installment.organization_id and om.status='active' loop if exists(select 1 from public.notifications n where n.recipient_user_id=v_org_member.user_id and n.organization_id=v_installment.organization_id and n.dedupe_key=v_dedupe) then v_skipped:=v_skipped+1;continue;end if; insert into public.notifications(organization_id,recipient_user_id,category,priority,title,body,action_url,entity_type,entity_id,metadata,dedupe_key,expires_at) values(v_installment.organization_id,v_org_member.user_id,'loan',v_priority,v_title,v_body,'/emprunts','loan_installment',v_installment.id,jsonb_build_object('loan_id',v_installment.loan_id,'installment_id',v_installment.id,'installment_number',v_installment.installment_number,'due_date',v_installment.due_date,'days_from_due',v_days),v_dedupe,now()+interval '30 days') returning id into v_notification_id; select * into v_pref from public.notification_preferences np where np.organization_id=v_installment.organization_id and np.user_id=v_org_member.user_id; if coalesce(v_pref.email_enabled,true) then insert into public.notification_deliveries(notification_id,organization_id,recipient_user_id,channel) values(v_notification_id,v_installment.organization_id,v_org_member.user_id,'email') on conflict do nothing; end if; if coalesce(v_pref.push_enabled,true) then insert into public.notification_deliveries(notification_id,organization_id,recipient_user_id,channel) values(v_notification_id,v_installment.organization_id,v_org_member.user_id,'push') on conflict do nothing; end if; v_created:=v_created+1; end loop; end loop; return jsonb_build_object('run_date',p_run_date,'created',v_created,'skipped',v_skipped); end; $function$;

CREATE OR REPLACE FUNCTION public.set_recurring_service_status(p_org uuid, p_contract uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  c public.recurring_service_contracts%rowtype;
  v_next_billing_date date;
  v_interval interval;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'orders.manage');
  if p_status not in ('active','suspended','cancelled') then
    raise exception 'Statut invalide';
  end if;
  if p_status in ('suspended','cancelled') and length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'Un motif d''au moins 3 caractères est obligatoire';
  end if;

  select * into c
    from public.recurring_service_contracts
   where id=p_contract and organization_id=p_org
   for update;
  if not found then raise exception 'Prestation récurrente introuvable'; end if;
  if c.status in ('cancelled','ended') then
    raise exception 'Cette prestation récurrente est clôturée';
  end if;

  v_next_billing_date := c.next_billing_date;
  v_interval := case c.frequency
    when 'daily' then interval '1 day'
    when 'weekly' then interval '1 week'
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months'
    when 'annual' then interval '1 year'
    when 'custom' then make_interval(days => coalesce(c.custom_interval_days,30))
  end;

  -- On resume, skip missed cycles without creating backdated invoices.
  -- This handles both arrears and advance schedules, including custom intervals.
  if p_status='active' and c.status='suspended' and v_next_billing_date < public.magnisa_business_date() then
    while v_next_billing_date < public.magnisa_business_date() loop
      v_next_billing_date := (v_next_billing_date + v_interval)::date;
    end loop;
  end if;

  update public.recurring_service_contracts set
    status=case
      when p_status='active' and end_date is not null
        and (case when billing_timing='arrears'
          then (v_next_billing_date - v_interval)::date
          else v_next_billing_date end) > end_date
      then 'ended' else p_status end,
    next_billing_date=v_next_billing_date,
    suspension_reason=case when p_status='suspended' then trim(p_reason) when p_status='active' then null else suspension_reason end,
    suspended_at=case when p_status='suspended' then now() when p_status='active' then null else suspended_at end,
    cancellation_reason=case when p_status='cancelled' then trim(p_reason) else cancellation_reason end,
    cancelled_at=case when p_status='cancelled' then now() else cancelled_at end,
    updated_at=now()
  where id=c.id;

  perform public.audit_event(p_org,'recurring_service.'||p_status,'recurring_service',c.id,
    jsonb_build_object('status',c.status),
    jsonb_build_object('status',p_status,'reason',nullif(trim(coalesce(p_reason,'')),'')));
end; $function$;

CREATE OR REPLACE FUNCTION public.validate_payslip(p_org uuid, p_payslip uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ps public.payslips%rowtype; v_entry uuid; v_employer_contrib numeric; v_total_cost numeric; v_regular_employer_contrib numeric;
begin
 perform public.assert_org_access(p_org); perform public.assert_org_permission(p_org,'payroll.manage');
 select * into ps from public.payslips where id=p_payslip and organization_id=p_org for update;
 if not found then raise exception 'Bulletin introuvable'; end if;
 if ps.status<>'calculated' then raise exception 'Seul un bulletin calculé peut être validé'; end if;
 v_employer_contrib:=coalesce(ps.employer_social,0)+coalesce(ps.employer_health,0)+coalesce(ps.employer_fmfp,0)+coalesce(ps.taxable_supplementary_pension,0);
 v_regular_employer_contrib:=coalesce(ps.employer_social,0)+coalesce(ps.employer_health,0);
 v_total_cost:=coalesce(ps.gross_pay,0)+v_employer_contrib;
 if v_total_cost<=0 then raise exception 'Bulletin sans montant à comptabiliser'; end if;
 update public.payslips set status='validated',updated_at=now() where id=ps.id;
 insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit) values(p_org,public.magnisa_business_date(),'PAIE-'||left(ps.id::text,8),'Validation bulletin de paie','payslip',ps.id,v_total_cost,v_total_cost) returning id into v_entry;
 if ps.gross_pay>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'PAYROLL_EXPENSE:GROSS','Salaires bruts',ps.gross_pay,0); end if;
 if v_regular_employer_contrib>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS','Charges patronales CNaPS et santé',v_regular_employer_contrib,0); end if;
 if ps.employer_fmfp>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'FMFP_PAYABLE','FMFP à payer',0,ps.employer_fmfp); end if;
 if ps.taxable_supplementary_pension>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'PAYROLL_EXPENSE:SUPPLEMENTARY_PENSION','Versement patronal de retraite complémentaire',ps.taxable_supplementary_pension,0); insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'SUPPLEMENTARY_PENSION_PAYABLE','Organisme de retraite complémentaire à payer',0,ps.taxable_supplementary_pension); end if;
 if ps.net_pay>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'PAYROLL_PAYABLE','Salaires nets à payer',0,ps.net_pay); end if;
 if ps.income_tax>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'TAX_PAYABLE:PAYROLL','Retenues fiscales sur salaires',0,ps.income_tax); end if;
 if ps.employee_social+ps.employer_social>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'SOCIAL_PAYABLE','Cotisations sociales à payer',0,ps.employee_social+ps.employer_social); end if;
 if ps.employee_health+ps.employer_health>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'HEALTH_PAYABLE','Cotisations santé à payer',0,ps.employee_health+ps.employer_health); end if;
 if coalesce(ps.employee_supplementary_pension,0)>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'EMPLOYEE_SUPPLEMENTARY_PENSION_PAYABLE','Cotisation salariale retraite complémentaire à reverser',0,ps.employee_supplementary_pension); end if;
 if ps.advances_recovered>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'EMPLOYEE_ADVANCE_RECEIVABLE','Avances au personnel récupérées',0,ps.advances_recovered); end if;
 if ps.other_deductions>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'OTHER_PAYROLL_PAYABLE','Autres retenues à reverser',0,ps.other_deductions); end if;
 perform public.audit_event(p_org,'payslip.validated','payslip',ps.id,jsonb_build_object('status','calculated'),jsonb_build_object('status','validated','net_pay',ps.net_pay,'total_cost',v_total_cost,'taxable_supplementary_pension',coalesce(ps.taxable_supplementary_pension,0),'employee_supplementary_pension',coalesce(ps.employee_supplementary_pension,0)));
end $function$;


-- The transfer RPCs are SECURITY DEFINER and must remain authenticated-only.
REVOKE ALL ON FUNCTION public.magnisa_record_transfer_debit(uuid,uuid,uuid,date,numeric,numeric,numeric,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.magnisa_confirm_transfer_credit(uuid,uuid,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.magnisa_record_transfer_debit(uuid,uuid,uuid,date,numeric,numeric,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_confirm_transfer_credit(uuid,uuid,date,text) TO authenticated;

COMMIT;
