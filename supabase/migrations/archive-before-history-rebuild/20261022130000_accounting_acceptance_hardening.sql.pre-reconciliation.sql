-- MAGNISA accounting acceptance hardening
-- Closed-period protection, immutable traceability, reversals and centralized customer-payment posting.

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'MGA',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rule_reference text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

ALTER TABLE public.journal_entry_lines
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id);

CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (status IN ('open','closed'))
);
CREATE INDEX IF NOT EXISTS accounting_periods_lookup_idx ON public.accounting_periods(organization_id,period_start,period_end,status);
ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_periods_select ON public.accounting_periods;
CREATE POLICY accounting_periods_select ON public.accounting_periods FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id=accounting_periods.organization_id AND m.user_id=auth.uid() AND m.status='active')
);

CREATE OR REPLACE FUNCTION public.magnisa_assert_accounting_period_open(p_org uuid,p_entry_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF EXISTS (
    SELECT 1 FROM public.accounting_periods p
    WHERE p.organization_id=p_org AND p.status='closed'
      AND p_entry_date BETWEEN p.period_start AND p.period_end
  ) THEN
    RAISE EXCEPTION 'La période comptable du % est clôturée',p_entry_date USING ERRCODE='55000';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.magnisa_close_accounting_period(p_org uuid,p_period_start date,p_period_end date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end<p_period_start THEN RAISE EXCEPTION 'Période invalide'; END IF;
  INSERT INTO public.accounting_periods(organization_id,period_start,period_end,status,closed_at,closed_by)
  VALUES(p_org,p_period_start,p_period_end,'closed',now(),auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_source_posted_uidx
  ON public.journal_entries(organization_id,source_type,source_id)
  WHERE status='posted' AND source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.magnisa_post_journal(p_org uuid,p_entry_date date,p_reference text,p_description text,p_source_type text,p_source_id uuid,p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_entry uuid; v_line jsonb; v_debit numeric:=0; v_credit numeric:=0; v_code text; v_label text; v_currency text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_entry_date);
  IF p_entry_date IS NULL OR nullif(btrim(p_reference),'') IS NULL THEN RAISE EXCEPTION 'Date et référence comptables obligatoires'; END IF;
  IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<2 THEN RAISE EXCEPTION 'Écriture comptable incomplète'; END IF;
  SELECT currency INTO v_currency FROM public.organizations WHERE id=p_org;
  SELECT id INTO v_entry FROM public.journal_entries WHERE organization_id=p_org AND source_type=p_source_type AND source_id=p_source_id AND status='posted' ORDER BY created_at LIMIT 1;
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
  INSERT INTO public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit,status,currency_code,exchange_rate,rule_reference,created_by)
  VALUES(p_org,p_entry_date,btrim(p_reference),p_description,p_source_type,p_source_id,0,0,'posted',coalesce(v_currency,'MGA'),1,p_source_type||':central',auth.uid()) RETURNING id INTO v_entry;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF v_line->>'account_kind'='treasury' THEN
      IF NOT EXISTS (SELECT 1 FROM public.financial_accounts WHERE id=(v_line->>'financial_account_id')::uuid AND organization_id=p_org AND is_active) THEN RAISE EXCEPTION 'Compte de trésorerie invalide'; END IF;
      v_label:=v_line->>'account_label';
    ELSE
      v_code:=NULLIF(v_line->>'pcg_code','');
      SELECT label INTO v_label FROM public.pcg2005_accounts WHERE code=v_code;
      IF v_label IS NULL THEN RAISE EXCEPTION 'Compte PCG invalide ou absent: %',v_code; END IF;
    END IF;
    IF COALESCE((v_line->>'debit')::numeric,0)<0 OR COALESCE((v_line->>'credit')::numeric,0)<0 THEN RAISE EXCEPTION 'Montant comptable négatif'; END IF;
    IF COALESCE((v_line->>'debit')::numeric,0)>0 AND COALESCE((v_line->>'credit')::numeric,0)>0 THEN RAISE EXCEPTION 'Une ligne ne peut pas être débit et crédit'; END IF;
    IF COALESCE((v_line->>'debit')::numeric,0)=0 AND COALESCE((v_line->>'credit')::numeric,0)=0 THEN RAISE EXCEPTION 'Une ligne comptable ne peut pas être nulle'; END IF;
    v_debit:=v_debit+COALESCE((v_line->>'debit')::numeric,0); v_credit:=v_credit+COALESCE((v_line->>'credit')::numeric,0);
    INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id,customer_id,supplier_id)
    VALUES(p_org,v_entry,CASE WHEN v_line->>'account_kind'='treasury' THEN 'TREASURY:'||(v_line->>'financial_account_id') ELSE 'PCG:'||v_code END,v_label,
      COALESCE((v_line->>'debit')::numeric,0),COALESCE((v_line->>'credit')::numeric,0),NULLIF(v_line->>'financial_account_id','')::uuid,NULLIF(v_line->>'customer_id','')::uuid,NULLIF(v_line->>'supplier_id','')::uuid);
  END LOOP;
  IF round(v_debit,2)<>round(v_credit,2) THEN RAISE EXCEPTION 'Écriture déséquilibrée: débit %, crédit %',v_debit,v_credit; END IF;
  UPDATE public.journal_entries SET total_debit=v_debit,total_credit=v_credit WHERE id=v_entry;
  PERFORM public.magnisa_assert_journal_balanced(v_entry);
  RETURN v_entry;
END; $$;

CREATE OR REPLACE FUNCTION public.magnisa_reverse_journal_entry(p_org uuid,p_entry uuid,p_date date,p_reason text,p_request_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_original public.journal_entries%rowtype; v_reversal uuid; v_ref text; v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_date);
  SELECT * INTO v_original FROM public.journal_entries WHERE id=p_entry AND organization_id=p_org AND status='posted' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Écriture validée introuvable'; END IF;
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'Clé de correction obligatoire'; END IF;
  SELECT id INTO v_reversal FROM public.journal_entries WHERE organization_id=p_org AND source_type='journal_reversal' AND source_id=p_entry AND reference=p_request_key::text LIMIT 1;
  IF v_reversal IS NOT NULL THEN RETURN v_reversal; END IF;
  v_ref:=coalesce(nullif(btrim(p_request_key::text),''),public.next_document_number(p_org,'reversal'));
  SELECT jsonb_agg(jsonb_build_object('account_kind',CASE WHEN jel.account_key LIKE 'TREASURY:%' THEN 'treasury' ELSE 'pcg' END,'pcg_code',CASE WHEN jel.account_key LIKE 'PCG:%' THEN substring(jel.account_key from 5) ELSE NULL END,'financial_account_id',CASE WHEN jel.account_key LIKE 'TREASURY:%' THEN substring(jel.account_key from 10) ELSE NULL END,'account_label',jel.account_label,'debit',jel.credit,'credit',jel.debit,'customer_id',jel.customer_id,'supplier_id',jel.supplier_id)) INTO v_lines
  FROM public.journal_entry_lines jel WHERE jel.journal_entry_id=p_entry;
  v_reversal:=public.magnisa_post_journal(p_org,p_date,v_ref,coalesce(p_reason,'Correction de l''écriture '||v_original.reference),'journal_reversal',p_entry,v_lines);
  RETURN v_reversal;
END; $$;

COMMENT ON TABLE public.accounting_periods IS 'Périodes comptables. Une période fermée interdit toute nouvelle écriture, correction comprise hors nouvelle période.';
COMMENT ON FUNCTION public.magnisa_reverse_journal_entry(uuid,uuid,date,text,uuid) IS 'Une écriture validée n''est jamais supprimée. Elle est contrepassée par une nouvelle écriture tracée.';
