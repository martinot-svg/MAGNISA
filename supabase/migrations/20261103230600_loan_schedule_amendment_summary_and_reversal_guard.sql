DO $migration$
DECLARE v_definition text; v_old text; v_new text;
BEGIN
  v_definition := pg_get_functiondef('public.create_loan_schedule_amendment(uuid,uuid,date,text,text,jsonb)'::regprocedure);
  v_old := 'UPDATE public.loans
  SET active_schedule_version_id = v_id, updated_at = now()
  WHERE id = p_loan_id AND organization_id = p_organization_id;';
  v_new := 'UPDATE public.loans
  SET active_schedule_version_id = v_id,
      total_installments = jsonb_array_length(p_installments),
      end_date = (SELECT max(due_date) FROM public.loan_installments WHERE schedule_version_id = v_id),
      next_due_date = (SELECT due_date FROM public.loan_installments WHERE schedule_version_id = v_id ORDER BY installment_number LIMIT 1),
      next_due_amount = (SELECT total_due FROM public.loan_installments WHERE schedule_version_id = v_id ORDER BY installment_number LIMIT 1),
      updated_at = now()
  WHERE id = p_loan_id AND organization_id = p_organization_id;';
  IF position(v_old in v_definition) = 0 THEN RAISE EXCEPTION 'Amendment function summary update block not found'; END IF;
  EXECUTE replace(v_definition, v_old, v_new);

  v_definition := pg_get_functiondef('public.reverse_loan_repayment(uuid,uuid,date,uuid,text)'::regprocedure);
  v_old := 'if not found or v_loan.status not in (''active'',''paid'') then
    raise exception ''Contrat d’emprunt non disponible pour contrepassation'';
  end if;';
  v_new := v_old || '

  IF v_repayment.installment_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.loan_installments i
    WHERE i.id = v_repayment.installment_id
      AND i.organization_id = p_organization_id
      AND i.schedule_version_id <> v_loan.active_schedule_version_id
  ) THEN
    RAISE EXCEPTION ''Contrepassation bloquée : le remboursement appartient à un échéancier historique. Une régularisation comptable dédiée est nécessaire.'';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.loan_repayment_installment_snapshots s
    JOIN public.loan_installments i ON i.id = s.installment_id
    WHERE s.organization_id = p_organization_id
      AND s.repayment_id = v_repayment.id
      AND i.schedule_version_id <> v_loan.active_schedule_version_id
  ) THEN
    RAISE EXCEPTION ''Contrepassation bloquée : le remboursement référence des échéances d’un échéancier historique.'';
  END IF;';
  IF position(v_old in v_definition) = 0 THEN RAISE EXCEPTION 'Reversal validation block not found'; END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END
$migration$;
