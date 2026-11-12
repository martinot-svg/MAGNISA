-- Allow a first fiscal year with no brought-forward assets or liabilities.
-- This is the expected case for a newly incorporated entity with no pre-period activity.
CREATE OR REPLACE FUNCTION public.magnisa_create_fiscal_year(
  p_org uuid, p_start date, p_end date, p_label text, p_opening_lines jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_year uuid;
  v_previous public.accounting_fiscal_years%rowtype;
  v_lines jsonb;
  v_entry uuid;
  v_debit numeric;
  v_credit numeric;
  v_count integer;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  PERFORM pg_advisory_xact_lock(hashtext(p_org::text),1743);

  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR length(trim(coalesce(p_label,''))) < 2 THEN
    RAISE EXCEPTION 'Exercice comptable invalide';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.accounting_fiscal_years y
    WHERE y.organization_id=p_org
      AND daterange(y.period_start,y.period_end,'[]') && daterange(p_start,p_end,'[]')
  ) THEN
    RAISE EXCEPTION 'Cet exercice chevauche un exercice déjà enregistré';
  END IF;

  SELECT * INTO v_previous
  FROM public.accounting_fiscal_years
  WHERE organization_id=p_org AND period_end < p_start
  ORDER BY period_end DESC LIMIT 1;

  IF v_previous.id IS NOT NULL THEN
    IF v_previous.status <> 'closed' THEN
      RAISE EXCEPTION 'Clôture d’abord l’exercice précédent avant de créer le suivant';
    END IF;
    SELECT jsonb_agg(jsonb_build_object(
      'account_kind','pcg','pcg_code',q.pcg_code,
      'debit',greatest(q.balance,0),'credit',greatest(-q.balance,0)
    ) ORDER BY q.pcg_code)
    INTO v_lines
    FROM (
      SELECT pcg_code,round(sum(debit-credit),2) AS balance
      FROM public.pcg2005_journal_lines
      WHERE organization_id=p_org AND status='posted'
        AND entry_date BETWEEN v_previous.period_start AND v_previous.period_end
        AND pcg_code ~ '^[1-5]'
      GROUP BY pcg_code
      HAVING round(sum(debit-credit),2) <> 0
    ) q;
    IF v_lines IS NULL OR jsonb_array_length(v_lines)<2 THEN
      RAISE EXCEPTION 'Aucun solde de bilan à reporter : vérifie les imputations PCG de l’exercice précédent';
    END IF;
  ELSE
    -- A first exercise may legitimately start with zero opening balances.
    -- Never infer or manufacture an opening journal for a newly formed entity.
    IF p_opening_lines IS NULL OR p_opening_lines='[]'::jsonb THEN
      IF EXISTS (
        SELECT 1 FROM public.journal_entries je
        WHERE je.organization_id=p_org AND je.status='posted' AND je.entry_date < p_start
      ) THEN
        RAISE EXCEPTION 'Des écritures existent avant le début du premier exercice : les soldes initiaux doivent être documentés';
      END IF;
      v_lines := NULL;
    ELSE
      IF jsonb_typeof(p_opening_lines)<>'array' OR jsonb_array_length(p_opening_lines)<2 THEN
        RAISE EXCEPTION 'Les soldes initiaux doivent contenir au moins deux lignes PCG';
      END IF;
      v_lines := p_opening_lines;
      SELECT coalesce(sum((x->>'debit')::numeric),0),
             coalesce(sum((x->>'credit')::numeric),0),count(*)
      INTO v_debit,v_credit,v_count FROM jsonb_array_elements(v_lines) x;
      IF v_count<2 OR round(v_debit,2)<>round(v_credit,2) THEN
        RAISE EXCEPTION 'Les soldes initiaux doivent être équilibrés en débit et crédit';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_lines) x
        LEFT JOIN public.pcg2005_accounts a ON a.code=x->>'pcg_code'
        WHERE a.code IS NULL OR a.code !~ '^[1-5]'
          OR coalesce((x->>'debit')::numeric,0)<0
          OR coalesce((x->>'credit')::numeric,0)<0
          OR (coalesce((x->>'debit')::numeric,0)>0 AND coalesce((x->>'credit')::numeric,0)>0)
          OR (coalesce((x->>'debit')::numeric,0)=0 AND coalesce((x->>'credit')::numeric,0)=0)
      ) THEN
        RAISE EXCEPTION 'Soldes initiaux invalides : seuls les comptes de bilan PCG 1 à 5 sont admis';
      END IF;
    END IF;
  END IF;

  IF v_lines IS NOT NULL THEN
    SELECT coalesce(sum((x->>'debit')::numeric),0),
           coalesce(sum((x->>'credit')::numeric),0)
    INTO v_debit,v_credit FROM jsonb_array_elements(v_lines) x;
    IF round(v_debit,2)<>round(v_credit,2) THEN
      RAISE EXCEPTION 'Les à-nouveaux ne sont pas équilibrés : débit %, crédit %',v_debit,v_credit;
    END IF;
  END IF;

  INSERT INTO public.accounting_fiscal_years(organization_id,label,period_start,period_end,created_by)
  VALUES(p_org,trim(p_label),p_start,p_end,auth.uid()) RETURNING id INTO v_year;

  -- Only create an opening journal when actual opening balances exist.
  IF v_lines IS NOT NULL AND jsonb_array_length(v_lines)>0 THEN
    v_entry := public.magnisa_post_journal(
      p_org,p_start,'AN-'||to_char(p_start,'YYYYMMDD')||'-'||substr(v_year::text,1,8),
      'A-nouveaux de l’exercice '||trim(p_label),'fiscal_year_opening',v_year,v_lines
    );
    UPDATE public.accounting_fiscal_years SET opening_entry_id=v_entry WHERE id=v_year;
  END IF;

  RETURN v_year;
END;
$$;

REVOKE ALL ON FUNCTION public.magnisa_create_fiscal_year(uuid,date,date,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_create_fiscal_year(uuid,date,date,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.magnisa_create_fiscal_year(uuid,date,date,text,jsonb) IS
  'Crée un exercice. Le premier peut ne pas avoir de pièce d ouverture si aucun mouvement comptabilisé ne précède la période; les exercices suivants reprennent les soldes PCG 1 à 5 après clôture.';
