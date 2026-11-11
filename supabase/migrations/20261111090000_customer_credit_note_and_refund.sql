-- Customer credit notes: line-level traceability, invoice balance application and cash refund.
-- The credit note journal reverses the original revenue/tax and clears receivables.
-- Only the excess beyond the open invoice balance can be refunded in cash.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS credited_amount numeric(18,2) NOT NULL DEFAULT 0;
DO $invoice_credit_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoices'::regclass AND conname='invoices_credited_amount_check') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_credited_amount_check
      CHECK (credited_amount >= 0 AND credited_amount <= total);
  END IF;
END
$invoice_credit_check$;

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS request_key uuid,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS applied_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refundable_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_request_key_uidx
  ON public.credit_notes(organization_id,request_key) WHERE request_key IS NOT NULL;

-- Preserve amounts of pre-existing issued/applied credit notes when introducing the
-- invoice-level credited balance. These historical notes remain visible even if they
-- do not yet have detailed lines.
UPDATE public.invoices i
SET credited_amount=COALESCE((
  SELECT sum(cn.total) FROM public.credit_notes cn
  WHERE cn.organization_id=i.organization_id AND cn.invoice_id=i.id
    AND cn.status IN ('issued','applied')
),0)
WHERE i.credited_amount=0
  AND EXISTS (SELECT 1 FROM public.credit_notes cn
    WHERE cn.organization_id=i.organization_id AND cn.invoice_id=i.id
      AND cn.status IN ('issued','applied'));

CREATE TABLE public.credit_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  credit_note_id uuid NOT NULL,
  source_invoice_line_id uuid NOT NULL,
  stock_return_line_id uuid,
  description text NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  subtotal numeric(18,2) NOT NULL CHECK (subtotal >= 0),
  tax_total numeric(18,2) NOT NULL CHECK (tax_total >= 0),
  total numeric(18,2) NOT NULL CHECK (total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (credit_note_id) REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_invoice_line_id) REFERENCES public.invoice_lines(id) ON DELETE RESTRICT,
  FOREIGN KEY (stock_return_line_id) REFERENCES public.stock_return_lines(id) ON DELETE RESTRICT,
  UNIQUE (organization_id,credit_note_id,source_invoice_line_id),
  CHECK (abs(total-subtotal-tax_total) <= 0.01)
);
CREATE INDEX credit_note_lines_source_invoice_line_idx
  ON public.credit_note_lines(organization_id,source_invoice_line_id);

CREATE TABLE public.credit_note_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  credit_note_id uuid NOT NULL,
  financial_account_id uuid NOT NULL,
  refund_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('bank_transfer','cash','mobile_money','cheque','card','other')),
  reference text NOT NULL,
  request_key uuid NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (credit_note_id) REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  FOREIGN KEY (financial_account_id) REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  UNIQUE (organization_id,request_key)
);

ALTER TABLE public.credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_note_lines,public.credit_note_refunds FROM PUBLIC,anon;
CREATE POLICY credit_note_lines_org_select ON public.credit_note_lines
  FOR SELECT TO authenticated USING (public.has_org_permission(organization_id,'billing.view'));
CREATE POLICY credit_note_refunds_org_select ON public.credit_note_refunds
  FOR SELECT TO authenticated USING (public.has_org_permission(organization_id,'billing.view'));
GRANT SELECT ON public.credit_note_lines,public.credit_note_refunds TO authenticated;
GRANT ALL ON public.credit_note_lines,public.credit_note_refunds TO service_role;

ALTER TABLE public.financial_transactions DROP CONSTRAINT financial_transactions_kind_check;
ALTER TABLE public.financial_transactions ADD CONSTRAINT financial_transactions_kind_check
  CHECK (kind IN ('customer_payment','customer_refund','expense','transfer_in','transfer_out',
    'adjustment','cheque_clearance','fee','customer_fee_recharge','advance','reimbursement'));

INSERT INTO public.pcg2005_accounts(code,label,kind,source)
VALUES ('4457','État, TVA collectée','liability','PCG 2005 Madagascar')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.accounting_posting_rules DROP CONSTRAINT accounting_posting_rules_operation_type_check;
ALTER TABLE public.accounting_posting_rules ADD CONSTRAINT accounting_posting_rules_operation_type_check
  CHECK (operation_type IN ('expense','customer_payment','supplier_payment','internal_transfer',
    'transaction_fee','customer_refund','supplier_refund','advance','invoice','stock_receipt',
    'stock_issue','stock_return','stock_supplier_return','stock_adjustment_in','stock_adjustment_out',
    'customer_credit_note'));

INSERT INTO public.accounting_posting_rules(
  operation_type,event_type,operation_key,debit_account_code,credit_account_code,priority,valid_from
) VALUES
 ('customer_credit_note','recognition','service_revenue','706',NULL,100,current_date),
 ('customer_credit_note','recognition','merchandise_revenue','707',NULL,100,current_date),
 ('customer_credit_note','recognition','tax_payable','4457',NULL,100,current_date),
 ('customer_credit_note','recognition','customer_receivable',NULL,'411',100,current_date)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.issue_customer_credit_note(
  p_org uuid,
  p_invoice_id uuid,
  p_issue_date date,
  p_lines jsonb,
  p_reason text,
  p_request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
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

  SELECT id,request_fingerprint INTO v_note,v_fingerprint
  FROM public.credit_notes
  WHERE organization_id=p_org AND request_key=p_request_key;
  IF FOUND THEN
    IF v_fingerprint IS DISTINCT FROM md5(p_invoice_id::text||':'||p_issue_date::text||':'||p_lines::text||':'||trim(p_reason)) THEN
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

    SELECT COALESCE(sum(quantity),0),COALESCE(sum(subtotal),0),COALESCE(sum(tax_total),0)
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
      WHEN due_date IS NOT NULL AND due_date<current_date THEN 'overdue'
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

CREATE OR REPLACE FUNCTION public.record_customer_credit_note_refund(
  p_org uuid,
  p_credit_note_id uuid,
  p_financial_account_id uuid,
  p_amount numeric,
  p_refund_date date,
  p_method text,
  p_reference text,
  p_request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $function$
DECLARE
  v_note public.credit_notes%rowtype;
  v_account public.financial_accounts%rowtype;
  v_refund uuid;
  v_journal uuid;
  v_lines jsonb;
  v_refunded numeric(18,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org) THEN
    RAISE EXCEPTION 'Accès refusé.';
  END IF;
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'payments.record');
  IF p_amount IS NULL OR p_amount<=0 OR p_refund_date IS NULL OR p_request_key IS NULL
     OR p_method NOT IN ('bank_transfer','cash','mobile_money','cheque','card','other')
     OR nullif(trim(coalesce(p_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Paramètres de remboursement invalides.';
  END IF;
  SELECT id INTO v_refund FROM public.credit_note_refunds
  WHERE organization_id=p_org AND request_key=p_request_key;
  IF FOUND THEN RETURN v_refund; END IF;

  SELECT * INTO v_note FROM public.credit_notes
  WHERE id=p_credit_note_id AND organization_id=p_org AND status IN ('issued','applied')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avoir client introuvable ou non émis.'; END IF;
  SELECT * INTO v_account FROM public.financial_accounts
  WHERE id=p_financial_account_id AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier de remboursement invalide.'; END IF;

  SELECT COALESCE(sum(amount),0) INTO v_refunded
  FROM public.credit_note_refunds
  WHERE organization_id=p_org AND credit_note_id=v_note.id;
  IF p_amount>v_note.refundable_amount-v_refunded+0.00000001 THEN
    RAISE EXCEPTION 'Le remboursement dépasse le montant restant dû au client.';
  END IF;
  IF v_account.balance<p_amount THEN
    RAISE EXCEPTION 'Solde du compte financier insuffisant pour ce remboursement.';
  END IF;

  v_refund:=gen_random_uuid();
  INSERT INTO public.credit_note_refunds(
    id,organization_id,credit_note_id,financial_account_id,refund_date,amount,
    method,reference,request_key,created_by
  ) VALUES (
    v_refund,p_org,v_note.id,v_account.id,p_refund_date,round(p_amount,2),
    p_method,trim(p_reference),p_request_key,auth.uid()
  );

  UPDATE public.financial_accounts SET balance=balance-round(p_amount,2),updated_at=now()
  WHERE id=v_account.id AND organization_id=p_org;
  INSERT INTO public.financial_transactions(
    organization_id,financial_account_id,transaction_date,amount,kind,source_type,
    source_id,reference,description
  ) VALUES (
    p_org,v_account.id,p_refund_date,round(p_amount,2),'customer_refund',
    'credit_note_refund',v_refund,trim(p_reference),'Remboursement avoir client '||v_note.number
  );

  v_lines:=jsonb_build_array(
    jsonb_build_object('pcg_code',public.magnisa_resolve_pcg_account(p_org,'customer_credit_note','recognition','customer_receivable','debit'),
      'debit',round(p_amount,2),'credit',0),
    jsonb_build_object('account_kind','treasury','financial_account_id',v_account.id,
      'account_label',v_account.name,'debit',0,'credit',round(p_amount,2))
  );
  v_journal:=public.magnisa_post_journal(
    p_org,p_refund_date,trim(p_reference),'Remboursement avoir client '||v_note.number,
    'credit_note_refund',v_refund,v_lines
  );
  UPDATE public.credit_note_refunds SET journal_entry_id=v_journal WHERE id=v_refund;
  UPDATE public.credit_notes SET refunded_amount=refunded_amount+round(p_amount,2),
    status=CASE WHEN refunded_amount+round(p_amount,2)>=refundable_amount THEN 'applied' ELSE 'issued' END
  WHERE id=v_note.id AND organization_id=p_org;

  PERFORM public.audit_event(p_org,'credit_note.refunded','credit_note_refund',v_refund,NULL,
    jsonb_build_object('credit_note_id',v_note.id,'amount',p_amount,
      'financial_account_id',v_account.id,'journal_entry_id',v_journal));
  RETURN v_refund;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_customer_credit_note(uuid,uuid,date,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_customer_credit_note(uuid,uuid,date,jsonb,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.record_customer_credit_note_refund(uuid,uuid,uuid,numeric,date,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_customer_credit_note_refund(uuid,uuid,uuid,numeric,date,text,text,uuid) TO authenticated;
