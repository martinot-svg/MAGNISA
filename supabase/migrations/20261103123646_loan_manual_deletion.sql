-- Controlled permanent deletion of a loan and its generated schedule.
-- Posted financial activity is deliberately protected: it must be reversed,
-- not erased, so treasury balances and accounting history remain consistent.

create or replace function public.delete_loan_with_dependencies(
  p_organization_id uuid,
  p_loan_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_loan public.loans%rowtype;
  v_installment_count integer;
  v_repayment_count integer;
  v_snapshot jsonb;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'finance.view');
  perform public.assert_org_permission(p_organization_id, 'accounting.manage');

  select *
  into v_loan
  from public.loans
  where id = p_loan_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Emprunt introuvable ou déjà supprimé';
  end if;

  select count(*)::integer
  into v_installment_count
  from public.loan_installments
  where loan_id = p_loan_id
    and organization_id = p_organization_id;

  select count(*)::integer
  into v_repayment_count
  from public.loan_repayments
  where loan_id = p_loan_id
    and organization_id = p_organization_id;

  if v_repayment_count > 0 then
    raise exception 'Suppression bloquée : cet emprunt possède % remboursement(s). Contrepasser les opérations réelles avant toute suppression.', v_repayment_count;
  end if;

  if exists (
    select 1
    from public.financial_transactions
    where organization_id = p_organization_id
      and source_id = p_loan_id
  ) or exists (
    select 1
    from public.journal_entries
    where organization_id = p_organization_id
      and source_id = p_loan_id
  ) then
    raise exception 'Suppression bloquée : des opérations de trésorerie ou des écritures comptables sont encore liées à cet emprunt.';
  end if;

  v_snapshot := to_jsonb(v_loan);

  perform public.audit_event(
    p_organization_id,
    'loan.deleted',
    'loan',
    p_loan_id,
    v_snapshot,
    jsonb_build_object(
      'deleted_installments', v_installment_count,
      'deleted_repayments', v_repayment_count,
      'deletion_type', 'permanent'
    )
  );

  delete from public.lot1_financial_idempotency
  where organization_id = p_organization_id
    and operation_type = 'loan_installment_charges'
    and result_id in (
      select id
      from public.loan_installments
      where loan_id = p_loan_id
        and organization_id = p_organization_id
    );

  delete from public.loans
  where id = p_loan_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'La suppression de l’emprunt a échoué';
  end if;

  return jsonb_build_object(
    'loan_id', p_loan_id,
    'deleted_installments', v_installment_count,
    'deleted_repayments', v_repayment_count,
    'deleted', true
  );
end;
$function$;

revoke all on function public.delete_loan_with_dependencies(uuid,uuid) from public, anon;
grant execute on function public.delete_loan_with_dependencies(uuid,uuid) to authenticated;
