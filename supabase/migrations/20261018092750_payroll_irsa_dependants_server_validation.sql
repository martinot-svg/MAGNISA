CREATE OR REPLACE FUNCTION public.payroll_compute_fmfp_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_rule public.payroll_rule_sets%rowtype;
 v_period date;
 v_count integer;
 v_social numeric;
 v_health numeric;
 v_emp_social numeric;
 v_emp_health numeric;
 v_taxable numeric;
 v_tax numeric:=0;
 v_previous numeric:=0;
 v_upper numeric;
 v_rate numeric;
 v_b jsonb;
 v_dependants integer;
BEGIN
 SELECT period_end INTO v_period FROM public.payroll_runs WHERE id=NEW.payroll_run_id AND organization_id=NEW.organization_id;
 IF v_period IS NULL THEN RAISE EXCEPTION 'Période de paie introuvable';END IF;
 SELECT count(*) INTO v_count FROM public.payroll_rule_sets WHERE organization_id=NEW.organization_id AND status='validated' AND effective_from<=v_period AND (effective_to IS NULL OR effective_to>=v_period);
 IF v_count<>1 THEN RAISE EXCEPTION 'Référentiel réglementaire unique validé requis';END IF;
 SELECT * INTO v_rule FROM public.payroll_rule_sets WHERE organization_id=NEW.organization_id AND status='validated' AND effective_from<=v_period AND (effective_to IS NULL OR effective_to>=v_period);
 IF v_rule.cnaps_monthly_ceiling IS NULL OR v_rule.health_monthly_ceiling IS NULL OR v_rule.rounding_policy<>'floor_100' OR jsonb_typeof(v_rule.irsa_brackets)<>'array' OR jsonb_array_length(v_rule.irsa_brackets)=0 THEN
 RAISE EXCEPTION 'Référentiel fiscal ou social incomplet';
 END IF;
 v_social:=round(least(NEW.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.cnaps_employee_rate,2);
 v_health:=round(least(NEW.gross_pay,v_rule.health_monthly_ceiling)*v_rule.health_employee_rate,2);
 v_emp_social:=round(least(NEW.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.cnaps_employer_rate,2);
 v_emp_health:=round(least(NEW.gross_pay,v_rule.health_monthly_ceiling)*v_rule.health_employer_rate,2);
 v_taxable:=floor(greatest(0,NEW.gross_pay-v_social-v_health)/100)*100;
 FOR v_b IN SELECT value FROM jsonb_array_elements(v_rule.irsa_brackets) LOOP
  v_rate:=(v_b->>'rate')::numeric;
  v_upper:=CASE WHEN v_b->>'up_to' IS NULL THEN NULL ELSE (v_b->>'up_to')::numeric END;
  IF v_rate IS NULL OR v_rate<0 OR v_rate>1 OR (v_upper IS NOT NULL AND v_upper<=v_previous) THEN RAISE EXCEPTION 'Barème IRSA invalide';END IF;
  IF v_upper IS NULL THEN
    v_tax:=v_tax+greatest(0,v_taxable-v_previous)*v_rate;
    v_previous:=v_taxable;
    EXIT;
  END IF;
  v_tax:=v_tax+greatest(0,least(v_taxable,v_upper)-v_previous)*v_rate;
  v_previous:=v_upper;
  IF v_taxable<=v_upper THEN EXIT;END IF;
 END LOOP;
 IF v_previous<v_taxable THEN RAISE EXCEPTION 'Barème IRSA sans tranche couvrant le revenu imposable';END IF;
 v_tax:=greatest(coalesce(v_rule.irsa_minimum,0),round(v_tax,2));
 SELECT irsa_dependants INTO v_dependants FROM public.employees WHERE id=NEW.employee_id AND organization_id=NEW.organization_id;
 IF v_dependants IS NULL OR v_dependants<0 OR v_dependants>30 THEN RAISE EXCEPTION 'Nombre de personnes à charge IRSA invalide'; END IF;
 IF v_taxable>350000 AND v_dependants>0 THEN v_tax:=greatest(coalesce(v_rule.irsa_minimum,0),v_tax-2000*v_dependants); END IF;
 IF abs(NEW.employee_social-v_social)>.01 OR abs(NEW.employee_health-v_health)>.01 OR abs(NEW.employer_social-v_emp_social)>.01 OR abs(NEW.employer_health-v_emp_health)>.01 OR abs(NEW.income_tax-v_tax)>.01 THEN
 RAISE EXCEPTION 'Retenues et charges incohérentes avec le référentiel fiscal validé';
 END IF;
 NEW.employer_fmfp:=round(least(NEW.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.fmfp_employer_rate,2);
 RETURN NEW;
END $function$
