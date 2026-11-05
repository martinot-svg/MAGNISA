-- MAGNISA: exercices comptables, a-nouveaux et cloture controlee (PCG 2005 Madagascar).
-- Les ecritures sources restent immuables. Les a-nouveaux sont une nouvelle piece tracee.

CREATE TABLE IF NOT EXISTS public.accounting_fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_entry_id uuid REFERENCES public.journal_entries(id),
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CHECK (period_end >= period_start),
  UNIQUE (organization_id, period_start),
  UNIQUE (organization_id, label)
);
CREATE INDEX IF NOT EXISTS accounting_fiscal_years_period_idx
  ON public.accounting_fiscal_years(organization_id, period_start, period_end);
ALTER TABLE public.accounting_fiscal_years ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_fiscal_years FROM anon, authenticated;
GRANT SELECT ON public.accounting_fiscal_years TO authenticated;
DROP POLICY IF EXISTS accounting_fiscal_years_read ON public.accounting_fiscal_years;
CREATE POLICY accounting_fiscal_years_read ON public.accounting_fiscal_years
  FOR SELECT TO authenticated USING (
    public.has_org_permission(organization_id,'accounting.view')
  );

CREATE OR REPLACE FUNCTION public.magnisa_create_fiscal_year(
  p_org uuid, p_start date, p_end date, p_label text, p_opening_lines jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_year uuid;
  v_previous public.accounting_fiscal_years%rowtype;
  v_lines jsonb;
  v_entry uuid;
  v_debit numeric;
  v_credit numeric;
  v_count integer;
  v_currency text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR length(trim(coalesce(p_label,''))) < 2 THEN
    RAISE EXCEPTION 'Exercice comptable invalide';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.accounting_fiscal_years y
    WHERE y.organization_id=p_org AND daterange(y.period_start,y.period_end,'[]') && daterange(p_start,p_end,'[]')
  ) THEN RAISE EXCEPTION 'Cet exercice chevauche un exercice déjà enregistré'; END IF;

  SELECT * INTO v_previous FROM public.accounting_fiscal_years
  WHERE organization_id=p_org AND period_end < p_start
  ORDER BY period_end DESC LIMIT 1;

  IF v_previous.id IS NOT NULL THEN
    IF v_previous.status <> 'closed' THEN
      RAISE EXCEPTION 'Clôture d’abord l’exercice précédent avant de créer le suivant';
    END IF;
    SELECT jsonb_agg(jsonb_build_object(
      'account_kind','pcg','pcg_code',q.pcg_code,'debit',greatest(q.balance,0),
      'credit',greatest(-q.balance,0)
    ) ORDER BY q.pcg_code)
    INTO v_lines
    FROM (
      SELECT pcg_code, round(sum(debit-credit),2) AS balance
      FROM public.pcg2005_journal_lines
      WHERE organization_id=p_org AND entry_date <= v_previous.period_end
        AND pcg_code ~ '^[1-5]'
      GROUP BY pcg_code
      HAVING round(sum(debit-credit),2) <> 0
    ) q;
  ELSE
    v_lines := p_opening_lines;
    IF jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) < 2 THEN
      RAISE EXCEPTION 'Pour le premier exercice, saisis au moins deux lignes de soldes initiaux';
    END IF;
    SELECT coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0), count(*)
    INTO v_debit,v_credit,v_count FROM jsonb_array_elements(v_lines) x;
    IF v_count < 2 OR round(v_debit,2) <> round(v_credit,2) THEN
      RAISE EXCEPTION 'Les soldes initiaux doivent être équilibrés en débit et crédit';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_lines) x
      LEFT JOIN public.pcg2005_accounts a ON a.code=x->>'pcg_code'
      WHERE a.code IS NULL OR a.code !~ '^[1-5]'
        OR coalesce((x->>'debit')::numeric,0)<0 OR coalesce((x->>'credit')::numeric,0)<0
        OR (coalesce((x->>'debit')::numeric,0)>0 AND coalesce((x->>'credit')::numeric,0)>0)
    ) THEN RAISE EXCEPTION 'Soldes initiaux invalides : seuls les comptes de bilan PCG 1 à 5 sont admis'; END IF;
  END IF;

  IF v_lines IS NULL OR jsonb_array_length(v_lines) < 2 THEN
    RAISE EXCEPTION 'Aucun solde de bilan à reporter : vérifie les imputations PCG de l’exercice précédent';
  END IF;
  SELECT coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0)
  INTO v_debit,v_credit FROM jsonb_array_elements(v_lines) x;
  IF round(v_debit,2) <> round(v_credit,2) THEN
    RAISE EXCEPTION 'Les a-nouveaux ne sont pas équilibrés : débit %, crédit %',v_debit,v_credit;
  END IF;

  INSERT INTO public.accounting_fiscal_years(organization_id,label,period_start,period_end,created_by)
  VALUES(p_org,trim(p_label),p_start,p_end,auth.uid()) RETURNING id INTO v_year;
  SELECT currency INTO v_currency FROM public.organizations WHERE id=p_org;
  v_entry := public.magnisa_post_journal(
    p_org,p_start,'AN-'||to_char(p_start,'YYYYMMDD')||'-'||substr(v_year::text,1,8),
    'A-nouveaux de l’exercice '||trim(p_label),'fiscal_year_opening',v_year,v_lines
  );
  UPDATE public.accounting_fiscal_years SET opening_entry_id=v_entry WHERE id=v_year;
  RETURN v_year;
END;
$$;

CREATE OR REPLACE FUNCTION public.magnisa_close_fiscal_year(p_org uuid,p_year uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_year public.accounting_fiscal_years%rowtype;
  v_bad bigint;
  v_period uuid;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  SELECT * INTO v_year FROM public.accounting_fiscal_years
  WHERE id=p_year AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_year.status <> 'open' THEN RAISE EXCEPTION 'Exercice introuvable ou déjà clôturé'; END IF;

  SELECT count(*) INTO v_bad
  FROM public.pcg2005_journal_integrity j
  WHERE j.organization_id=p_org AND j.entry_date BETWEEN v_year.period_start AND v_year.period_end
    AND j.integrity_status <> 'equilibree';
  IF v_bad > 0 THEN RAISE EXCEPTION 'Clôture refusée : % écriture(s) déséquilibrée(s)',v_bad; END IF;

  SELECT count(*) INTO v_bad
  FROM public.pcg2005_journal_lines l
  WHERE l.organization_id=p_org AND l.entry_date BETWEEN v_year.period_start AND v_year.period_end
    AND l.mapping_status='a_mapper';
  IF v_bad > 0 THEN RAISE EXCEPTION 'Clôture refusée : % ligne(s) sans imputation PCG',v_bad; END IF;

  PERFORM public.magnisa_assert_accounting_invariants(p_org);

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
    jsonb_build_object('period_start',v_year.period_start,'period_end',v_year.period_end,'period_id',v_period));
  RETURN p_year;
END;
$$;

REVOKE ALL ON FUNCTION public.magnisa_create_fiscal_year(uuid,date,date,text,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_close_fiscal_year(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_create_fiscal_year(uuid,date,date,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_close_fiscal_year(uuid,uuid) TO authenticated;

COMMENT ON TABLE public.accounting_fiscal_years IS
  'Exercices comptables MAGNISA. Le premier exercice reçoit des soldes initiaux équilibrés; les suivants reprennent automatiquement les comptes PCG 1 à 5 du dernier exercice clôturé.';
COMMENT ON FUNCTION public.magnisa_close_fiscal_year(uuid,uuid) IS
  'Clôture contrôlée après contrôle de la partie double et des imputations. Les pièces sources ne sont jamais supprimées.';
