-- Periodic physical inventory subledger (inventaire intermittent) for PCG 2005.
-- Enforce tenant ownership of the referenced fiscal year.
CREATE UNIQUE INDEX IF NOT EXISTS accounting_fiscal_years_id_organization_uidx
  ON public.accounting_fiscal_years(id,organization_id);

-- A count is approved only at the fiscal year-end; approved records are immutable.
CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fiscal_year_id uuid NOT NULL REFERENCES public.accounting_fiscal_years(id) ON DELETE RESTRICT,
  count_date date NOT NULL,
  valuation_method text NOT NULL DEFAULT 'CUMP'
    CHECK (valuation_method IN ('CUMP','FIFO','specific_identification')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','reversed')),
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id),
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,organization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_one_approved_per_year
  ON public.inventory_counts(organization_id,fiscal_year_id)
  WHERE status='approved';

DO $inventory_state_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_counts'::regclass AND conname='inventory_counts_approved_metadata_check') THEN
    ALTER TABLE public.inventory_counts ADD CONSTRAINT inventory_counts_approved_metadata_check
      CHECK (status<>'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_counts'::regclass AND conname='inventory_counts_reversed_metadata_check') THEN
    ALTER TABLE public.inventory_counts ADD CONSTRAINT inventory_counts_reversed_metadata_check
      CHECK (status<>'reversed' OR (reversed_by IS NOT NULL AND reversed_at IS NOT NULL AND length(trim(COALESCE(reversal_reason,'')))>=10));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_counts'::regclass AND conname='inventory_counts_draft_metadata_check') THEN
    ALTER TABLE public.inventory_counts ADD CONSTRAINT inventory_counts_draft_metadata_check
      CHECK (status<>'draft' OR (approved_by IS NULL AND approved_at IS NULL AND reversed_by IS NULL AND reversed_at IS NULL));
  END IF;
END;
$inventory_state_checks$;

DO $inventory_year_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.inventory_counts'::regclass
      AND conname='inventory_counts_fiscal_year_org_fk'
  ) THEN
    ALTER TABLE public.inventory_counts
      ADD CONSTRAINT inventory_counts_fiscal_year_org_fk
      FOREIGN KEY (fiscal_year_id,organization_id)
      REFERENCES public.accounting_fiscal_years(id,organization_id)
      ON DELETE RESTRICT;
  END IF;
END;
$inventory_year_fk$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_one_draft_per_year
  ON public.inventory_counts(organization_id,fiscal_year_id)
  WHERE status='draft';

CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_one_active_per_year
  ON public.inventory_counts(organization_id,fiscal_year_id)
  WHERE status IN ('draft','approved');

CREATE TABLE IF NOT EXISTS public.inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  count_id uuid NOT NULL,
  item_reference text NOT NULL CHECK (length(trim(item_reference)) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 2 AND 240),
  unit text NOT NULL DEFAULT 'unité' CHECK (length(trim(unit)) BETWEEN 1 AND 24),
  account_code text NOT NULL REFERENCES public.pcg2005_accounts(code) ON DELETE RESTRICT,
  quantity numeric(20,6) NOT NULL CHECK (quantity>=0),
  unit_cost numeric(20,6) NOT NULL CHECK (unit_cost>=0),
  gross_value numeric(20,2) GENERATED ALWAYS AS (round(quantity*unit_cost,2)) STORED,
  impairment_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK (impairment_amount>=0),
  impairment_account_code text REFERENCES public.pcg2005_accounts(code) ON DELETE RESTRICT,
  net_value numeric(20,2) GENERATED ALWAYS AS (round(quantity*unit_cost,2)-impairment_amount) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_count_lines_count_org_fk
    FOREIGN KEY (count_id,organization_id)
    REFERENCES public.inventory_counts(id,organization_id) ON DELETE CASCADE,
  CONSTRAINT inventory_count_lines_stock_account_check
    CHECK (account_code ~ '^(31|32|33|34|35|36|37|38)'),
  CONSTRAINT inventory_count_lines_impairment_account_check
    CHECK (impairment_account_code IS NULL OR impairment_account_code ~ '^39(1|2|3|4|5|7|8)$'),
  CONSTRAINT inventory_count_lines_impairment_required_check
    CHECK (impairment_amount=0 OR impairment_account_code IS NOT NULL),
  CONSTRAINT inventory_count_lines_impairment_family_check
    CHECK (
      impairment_amount=0
      OR (account_code LIKE '31%' AND impairment_account_code='391')
      OR (account_code LIKE '32%' AND impairment_account_code='392')
      OR (account_code LIKE '33%' AND impairment_account_code='393')
      OR (account_code LIKE '34%' AND impairment_account_code='394')
      OR (account_code LIKE '35%' AND impairment_account_code='395')
      OR (account_code LIKE '37%' AND impairment_account_code='397')
      OR (account_code LIKE '38%' AND impairment_account_code='398')
    ),
  CONSTRAINT inventory_count_lines_impairment_limit_check
    CHECK (impairment_amount<=round(quantity*unit_cost,2)),
  UNIQUE (count_id,item_reference)
);

CREATE INDEX IF NOT EXISTS inventory_counts_org_year_date_idx
  ON public.inventory_counts(organization_id,fiscal_year_id,count_date DESC);
CREATE INDEX IF NOT EXISTS inventory_count_lines_count_idx
  ON public.inventory_count_lines(organization_id,count_id,account_code);

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_counts_select ON public.inventory_counts;
CREATE POLICY inventory_counts_select ON public.inventory_counts
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'accounting.view'));

DROP POLICY IF EXISTS inventory_counts_insert ON public.inventory_counts;
CREATE POLICY inventory_counts_insert ON public.inventory_counts
  FOR INSERT TO authenticated
  WITH CHECK (status='draft' AND created_by=auth.uid() AND public.has_org_permission(organization_id,'accounting.manage'));

DROP POLICY IF EXISTS inventory_counts_update ON public.inventory_counts;
CREATE POLICY inventory_counts_update ON public.inventory_counts
  FOR UPDATE TO authenticated
  USING (status='draft' AND public.has_org_permission(organization_id,'accounting.manage'))
  WITH CHECK (status='draft' AND public.has_org_permission(organization_id,'accounting.manage'));

DROP POLICY IF EXISTS inventory_counts_delete ON public.inventory_counts;
CREATE POLICY inventory_counts_delete ON public.inventory_counts
  FOR DELETE TO authenticated
  USING (status='draft' AND public.has_org_permission(organization_id,'accounting.manage'));

DROP POLICY IF EXISTS inventory_count_lines_select ON public.inventory_count_lines;
CREATE POLICY inventory_count_lines_select ON public.inventory_count_lines
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'accounting.view'));

DROP POLICY IF EXISTS inventory_count_lines_insert ON public.inventory_count_lines;
CREATE POLICY inventory_count_lines_insert ON public.inventory_count_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_org_permission(organization_id,'accounting.manage')
    AND EXISTS (
      SELECT 1 FROM public.inventory_counts c
      WHERE c.id=count_id AND c.organization_id=inventory_count_lines.organization_id AND c.status='draft'
    )
  );

DROP POLICY IF EXISTS inventory_count_lines_update ON public.inventory_count_lines;
CREATE POLICY inventory_count_lines_update ON public.inventory_count_lines
  FOR UPDATE TO authenticated
  USING (
    public.has_org_permission(organization_id,'accounting.manage')
    AND EXISTS (
      SELECT 1 FROM public.inventory_counts c
      WHERE c.id=count_id AND c.organization_id=inventory_count_lines.organization_id AND c.status='draft'
    )
  )
  WITH CHECK (
    public.has_org_permission(organization_id,'accounting.manage')
    AND EXISTS (
      SELECT 1 FROM public.inventory_counts c
      WHERE c.id=count_id AND c.organization_id=inventory_count_lines.organization_id AND c.status='draft'
    )
  );

DROP POLICY IF EXISTS inventory_count_lines_delete ON public.inventory_count_lines;
CREATE POLICY inventory_count_lines_delete ON public.inventory_count_lines
  FOR DELETE TO authenticated
  USING (
    public.has_org_permission(organization_id,'accounting.manage')
    AND EXISTS (
      SELECT 1 FROM public.inventory_counts c
      WHERE c.id=count_id AND c.organization_id=inventory_count_lines.organization_id AND c.status='draft'
    )
  );

GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_counts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_count_lines TO authenticated;
REVOKE ALL ON public.inventory_counts,public.inventory_count_lines FROM anon;

CREATE OR REPLACE FUNCTION public.guard_inventory_count_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $line_guard$
DECLARE
  v_count_id uuid;
  v_org uuid;
  v_status text;
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.count_id IS DISTINCT FROM OLD.count_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
  ) THEN
    RAISE EXCEPTION 'Une ligne ne peut pas être déplacée vers un autre inventaire';
  END IF;
  v_count_id:=CASE WHEN TG_OP='DELETE' THEN OLD.count_id ELSE NEW.count_id END;
  v_org:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  SELECT status INTO v_status
  FROM public.inventory_counts
  WHERE id=v_count_id AND organization_id=v_org
  FOR UPDATE;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Les lignes sont verrouillées dès l’approbation ou la contrepassation de l’inventaire';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$line_guard$;

DROP TRIGGER IF EXISTS guard_inventory_count_line_mutation ON public.inventory_count_lines;
CREATE TRIGGER guard_inventory_count_line_mutation
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_count_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_count_line_mutation();

CREATE OR REPLACE FUNCTION public.prevent_inventory_count_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $owner_guard$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Le créateur d’un inventaire ne peut pas être modifié';
  END IF;
  RETURN NEW;
END;
$owner_guard$;

DROP TRIGGER IF EXISTS prevent_inventory_count_owner_change ON public.inventory_counts;
CREATE TRIGGER prevent_inventory_count_owner_change
BEFORE UPDATE ON public.inventory_counts
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_count_owner_change();

CREATE OR REPLACE FUNCTION public.approve_inventory_count(p_count_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $approve_inventory$
DECLARE
  v_org uuid;
  v_year uuid;
  v_date date;
  v_status text;
  v_period_end date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE='42501';
  END IF;
  SELECT c.organization_id,c.fiscal_year_id,c.count_date,c.status,fy.period_end
    INTO v_org,v_year,v_date,v_status,v_period_end
  FROM public.inventory_counts c
  JOIN public.accounting_fiscal_years fy
    ON fy.id=c.fiscal_year_id AND fy.organization_id=c.organization_id
  WHERE c.id=p_count_id
  FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventaire introuvable'; END IF;
  IF NOT public.has_org_permission(v_org,'accounting.manage') THEN
    RAISE EXCEPTION 'Permission accounting.manage requise' USING ERRCODE='42501';
  END IF;
  IF v_status<>'draft' THEN RAISE EXCEPTION 'Seul un inventaire brouillon peut être approuvé'; END IF;
  IF v_date<>v_period_end THEN
    RAISE EXCEPTION 'La date de comptage doit correspondre à la date de clôture de l’exercice';
  END IF;
  UPDATE public.inventory_counts
  SET status='approved',approved_by=auth.uid(),approved_at=now()
  WHERE id=p_count_id;
END;
$approve_inventory$;

CREATE OR REPLACE FUNCTION public.reverse_inventory_count(p_count_id uuid,p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $reverse_inventory$
DECLARE
  v_org uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE='42501'; END IF;
  SELECT organization_id,status INTO v_org,v_status
  FROM public.inventory_counts WHERE id=p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventaire introuvable'; END IF;
  IF NOT public.has_org_permission(v_org,'accounting.manage') THEN
    RAISE EXCEPTION 'Permission accounting.manage requise' USING ERRCODE='42501';
  END IF;
  IF v_status<>'approved' THEN RAISE EXCEPTION 'Seul un inventaire approuvé peut être contrepassé'; END IF;
  IF length(trim(COALESCE(p_reason,'')))<10 THEN
    RAISE EXCEPTION 'La justification de contrepassation doit contenir au moins 10 caractères';
  END IF;
  UPDATE public.inventory_counts
  SET status='reversed',reversed_by=auth.uid(),reversed_at=now(),reversal_reason=trim(p_reason)
  WHERE id=p_count_id;
END;
$reverse_inventory$;

CREATE OR REPLACE FUNCTION public.get_accounting_inventory_valuation(
  p_organization_id uuid,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $inventory_valuation$
DECLARE
  v_count_id uuid;
  v_count_date date;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_org_permission(p_organization_id,'accounting.view') THEN
    RAISE EXCEPTION 'Permission accounting.view requise pour consulter l’inventaire'
      USING ERRCODE='42501';
  END IF;

  SELECT id,count_date INTO v_count_id,v_count_date
  FROM public.inventory_counts
  WHERE organization_id=p_organization_id
    AND count_date=p_period_end
    AND status='approved'
  ORDER BY approved_at DESC
  LIMIT 1;

  IF v_count_id IS NULL THEN
    RETURN jsonb_build_object(
      'count_available',false,'count_id',NULL,'count_date',NULL,'valuation_method',NULL,
      'lines','[]'::jsonb,'gross_ledger_gap',0,'impairment_ledger_gap',0,
      'gross_gaps','[]'::jsonb,'impairment_gaps','[]'::jsonb
    );
  END IF;

  WITH count_header AS (
    SELECT valuation_method FROM public.inventory_counts WHERE id=v_count_id
  ),
  count_lines AS (
    SELECT l.* FROM public.inventory_count_lines l WHERE l.count_id=v_count_id AND l.organization_id=p_organization_id
  ),
  count_gross AS (
    SELECT account_code,COALESCE(sum(gross_value),0)::numeric AS amount
    FROM count_lines GROUP BY account_code
  ),
  ledger_gross AS (
    SELECT pcg_code AS account_code,COALESCE(sum(debit-credit),0)::numeric AS amount
    FROM public.pcg2005_journal_lines
    WHERE organization_id=p_organization_id AND status='posted'
      AND entry_date<=p_period_end AND pcg_code ~ '^(31|32|33|34|35|36|37|38)'
    GROUP BY pcg_code
  ),
  gross_gaps AS (
    SELECT COALESCE(c.account_code,l.account_code) AS account_code,
      COALESCE(c.amount,0)::numeric AS count_amount,
      COALESCE(l.amount,0)::numeric AS ledger_amount,
      (COALESCE(c.amount,0)-COALESCE(l.amount,0))::numeric AS difference
    FROM count_gross c FULL OUTER JOIN ledger_gross l USING(account_code)
  ),
  count_impairment AS (
    SELECT impairment_account_code AS account_code,COALESCE(sum(impairment_amount),0)::numeric AS amount
    FROM count_lines WHERE impairment_amount>0 GROUP BY impairment_account_code
  ),
  ledger_impairment AS (
    SELECT pcg_code AS account_code,COALESCE(sum(debit-credit),0)::numeric AS amount
    FROM public.pcg2005_journal_lines
    WHERE organization_id=p_organization_id AND status='posted'
      AND entry_date<=p_period_end AND pcg_code ~ '^39(1|2|3|4|5|7|8)$'
    GROUP BY pcg_code
  ),
  impairment_gaps AS (
    SELECT COALESCE(c.account_code,l.account_code) AS account_code,
      COALESCE(c.amount,0)::numeric AS count_amount,
      COALESCE(-l.amount,0)::numeric AS ledger_amount,
      (COALESCE(c.amount,0)+COALESCE(l.amount,0))::numeric AS difference
    FROM count_impairment c FULL OUTER JOIN ledger_impairment l USING(account_code)
  )
  SELECT jsonb_build_object(
    'count_available',true,'count_id',v_count_id,'count_date',v_count_date,
    'valuation_method',(SELECT valuation_method FROM count_header),
    'lines',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'item_reference',l.item_reference,'description',l.description,'unit',l.unit,
        'account_code',l.account_code,'quantity',l.quantity,'unit_cost',l.unit_cost,
        'gross_value',l.gross_value,'impairment_amount',l.impairment_amount,
        'impairment_account_code',l.impairment_account_code,'net_value',l.net_value
      ) ORDER BY l.item_reference) FROM count_lines l
    ),'[]'::jsonb),
    'gross_gaps',COALESCE((
      SELECT jsonb_agg(to_jsonb(g)) FROM gross_gaps g WHERE abs(g.difference)>=0.01
    ),'[]'::jsonb),
    'impairment_gaps',COALESCE((
      SELECT jsonb_agg(to_jsonb(g)) FROM impairment_gaps g WHERE abs(g.difference)>=0.01
    ),'[]'::jsonb),
    'gross_ledger_gap',(SELECT COALESCE(sum(abs(difference)),0) FROM gross_gaps),
    'impairment_ledger_gap',(SELECT COALESCE(sum(abs(difference)),0) FROM impairment_gaps)
  )
  INTO v_result;

  RETURN COALESCE(v_result,'{}'::jsonb);
END;
$inventory_valuation$;

REVOKE ALL ON FUNCTION public.approve_inventory_count(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reverse_inventory_count(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_accounting_inventory_valuation(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_inventory_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_inventory_count(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_accounting_inventory_valuation(uuid,date) TO authenticated;

DO $inventory_assert$
DECLARE
  v_count_oid oid;
  v_line_oid oid;
  v_approve_oid oid;
  v_reverse_oid oid;
  v_value_oid oid;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.inventory_counts'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.inventory_count_lines'::regclass) THEN
    RAISE EXCEPTION 'Inventory count tables must have RLS enabled';
  END IF;
  v_approve_oid:=to_regprocedure('public.approve_inventory_count(uuid)');
  v_reverse_oid:=to_regprocedure('public.reverse_inventory_count(uuid,text)');
  v_value_oid:=to_regprocedure('public.get_accounting_inventory_valuation(uuid,date)');
  SELECT p.oid INTO v_count_oid FROM pg_proc p WHERE p.oid=v_approve_oid AND p.prosecdef;
  SELECT p.oid INTO v_line_oid FROM pg_proc p WHERE p.oid=v_value_oid AND p.prosecdef;
  IF v_count_oid IS NULL OR v_line_oid IS NULL OR v_reverse_oid IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=v_reverse_oid AND p.prosecdef)
     OR has_function_privilege('anon',v_approve_oid,'EXECUTE')
     OR has_function_privilege('anon',v_reverse_oid,'EXECUTE')
     OR has_function_privilege('anon',v_value_oid,'EXECUTE')
     OR NOT has_function_privilege('authenticated',v_approve_oid,'EXECUTE')
     OR NOT has_function_privilege('authenticated',v_reverse_oid,'EXECUTE')
     OR NOT has_function_privilege('authenticated',v_value_oid,'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='inventory_counts_one_active_per_year')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.inventory_count_lines'::regclass AND tgname='guard_inventory_count_line_mutation' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Inventory RPC security, grants or immutability controls are invalid';
  END IF;
END;
$inventory_assert$;

COMMENT ON TABLE public.inventory_counts IS
  'Periodic physical inventory counts for PCG 2005 year-end valuation. Approved counts are immutable and must match the fiscal-year closing date.';
COMMENT ON TABLE public.inventory_count_lines IS
  'Item-level physical inventory, unit cost, gross value and impairment. Gross and net values are database-generated.';
