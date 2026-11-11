-- Centralized supplier payment posting with idempotent references.
-- This migration mirrors the tested database function so clean CI replays reconstruct the same behavior.

create or replace function public.record_supplier_payment_v2(
  p_org uuid,
  p_supplier_invoice uuid,
  p_account uuid,
  p_amount numeric,
  p_method text,
  p_date date,
  p_reference text,
  p_fee_amount numeric,
  p_fee_company_amount numeric,
  p_fee_client_amount numeric,
  p_fee_bearer text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  si public.supplier_invoices%rowtype;
  a public.financial_accounts%rowtype;
  existing public.supplier_payments%rowtype;
  v_id uuid;
  v_ref text;
  v_ap text;
  v_fee text;
  v_lines jsonb;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'suppliers.manage');

  if p_amount <= 0
     or p_fee_amount < 0
     or p_fee_company_amount < 0
     or p_fee_client_amount < 0
     or round(p_fee_company_amount + p_fee_client_amount, 2) <> round(p_fee_amount, 2) then
    raise exception 'Montants incohérents';
  end if;

  if p_fee_bearer not in ('company','client','shared','none') then
    raise exception 'Frais invalides';
  end if;

  v_ref := coalesce(nullif(trim(p_reference), ''), public.next_document_number(p_org, 'payment'));

  -- A reference is the idempotency key for a supplier payment inside an organization.
  select * into existing
  from public.supplier_payments
  where organization_id = p_org
    and reference = v_ref
  order by created_at desc
  limit 1
  for update;

  if found then
    if existing.supplier_invoice_id = p_supplier_invoice
       and existing.amount = p_amount
       and existing.financial_account_id = p_account
       and existing.method = p_method
       and existing.payment_date = p_date
       and existing.fee_amount = p_fee_amount
       and existing.fee_company_amount = p_fee_company_amount
       and existing.fee_client_amount = p_fee_client_amount
       and existing.fee_bearer = p_fee_bearer then
      return existing.id;
    end if;
    raise exception 'Référence de règlement déjà utilisée';
  end if;

  select * into si
  from public.supplier_invoices
  where id = p_supplier_invoice
    and organization_id = p_org
  for update;

  if not found or si.status = 'cancelled' or p_amount > si.balance_due then
    raise exception 'Facture fournisseur ou montant invalide';
  end if;

  select * into a
  from public.financial_accounts
  where id = p_account
    and organization_id = p_org
    and is_active
  for update;

  if not found then
    raise exception 'Compte financier invalide';
  end if;

  insert into public.supplier_payments(
    organization_id, supplier_invoice_id, supplier_id, financial_account_id,
    amount, payment_date, reference, method, created_by,
    fee_amount, fee_company_amount, fee_client_amount, fee_bearer
  ) values (
    p_org, si.id, si.supplier_id, a.id,
    p_amount, p_date, v_ref, p_method, auth.uid(),
    p_fee_amount, p_fee_company_amount, p_fee_client_amount, p_fee_bearer
  ) returning id into v_id;

  update public.supplier_invoices
  set paid_amount = si.paid_amount + p_amount,
      balance_due = greatest(si.total - si.paid_amount - p_amount, 0),
      status = case when greatest(si.total - si.paid_amount - p_amount, 0) = 0
                    then 'paid' else 'partially_paid' end,
      updated_at = now()
  where id = si.id;

  update public.financial_accounts
  set balance = balance - p_amount - p_fee_company_amount,
      updated_at = now()
  where id = a.id;

  insert into public.financial_transactions(
    organization_id, financial_account_id, transaction_date, amount,
    kind, source_type, source_id, reference, description
  ) values (
    p_org, a.id, p_date, -p_amount,
    'expense', 'supplier_payment', v_id, v_ref, 'Règlement fournisseur'
  );

  if p_fee_company_amount > 0 then
    insert into public.financial_transactions(
      organization_id, financial_account_id, transaction_date, amount,
      kind, source_type, source_id, reference, description
    ) values (
      p_org, a.id, p_date, -p_fee_company_amount,
      'expense', 'supplier_payment_fee', v_id, v_ref, 'Frais entreprise'
    );
  end if;

  v_ap := public.magnisa_resolve_pcg_account(
    p_org, 'supplier_payment', 'settlement', 'supplier_payable', 'debit'
  );

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_kind','pcg','pcg_code',v_ap,'debit',p_amount,'credit',0
    ),
    jsonb_build_object(
      'account_kind','treasury','financial_account_id',a.id::text,
      'account_label',a.name,'debit',0,'credit',p_amount
    )
  );

  if p_fee_company_amount > 0 then
    v_fee := public.magnisa_resolve_pcg_account(
      p_org, 'transaction_fee', 'fee',
      case when a.type = 'mobile_money' then 'mobile_money'
           when a.type = 'bank' then 'bank'
           else 'cash_withdrawal' end,
      'fee'
    );

    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_kind','pcg','pcg_code',v_fee,
        'debit',p_fee_company_amount,'credit',0
      ),
      jsonb_build_object(
        'account_kind','treasury','financial_account_id',a.id::text,
        'account_label',a.name,'debit',0,'credit',p_fee_company_amount
      )
    );
  end if;

  perform public.magnisa_post_journal(
    p_org, p_date, v_ref, 'Règlement fournisseur',
    'supplier_payment', v_id, v_lines
  );

  return v_id;
end;
$$;

revoke all on function public.record_supplier_payment_v2(uuid, uuid, uuid, numeric, text, date, text, numeric, numeric, numeric, text) from public;
grant execute on function public.record_supplier_payment_v2(uuid, uuid, uuid, numeric, text, date, text, numeric, numeric, numeric, text) to authenticated;
