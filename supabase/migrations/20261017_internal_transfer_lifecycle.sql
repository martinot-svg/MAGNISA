-- Transfer lifecycle: debit confirmed first, credit confirmed separately.
CREATE TABLE IF NOT EXISTS public.magnisa_internal_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 source_account_id uuid NOT NULL REFERENCES public.financial_accounts(id),
 destination_account_id uuid NOT NULL REFERENCES public.financial_accounts(id),
 request_key uuid NOT NULL,
 transfer_date date NOT NULL,
 received_date date,
 source_debit numeric(18,2) NOT NULL CHECK(source_debit>0),
 destination_credit numeric(18,2) NOT NULL CHECK(destination_credit>0),
 operator_fee numeric(18,2) NOT NULL CHECK(operator_fee>=0),
 source_reference text NOT NULL,
 destination_reference text,
 status text NOT NULL DEFAULT 'in_transit' CHECK(status IN ('in_transit','completed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CONSTRAINT magnisa_transfer_unique_request UNIQUE(organization_id,request_key),
 CONSTRAINT magnisa_transfer_distinct_accounts CHECK(source_account_id<>destination_account_id),
 CONSTRAINT magnisa_transfer_balance CHECK(source_debit=destination_credit+operator_fee)
);
CREATE UNIQUE INDEX IF NOT EXISTS magnisa_transfer_source_reference_unique
 ON public.magnisa_internal_transfers(organization_id,source_account_id,source_reference);
CREATE INDEX IF NOT EXISTS magnisa_transfer_org_date
 ON public.magnisa_internal_transfers(organization_id,transfer_date DESC);
ALTER TABLE public.magnisa_internal_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS magnisa_transfer_select_org ON public.magnisa_internal_transfers;
CREATE POLICY magnisa_transfer_select_org ON public.magnisa_internal_transfers FOR SELECT
 USING (organization_id IN (SELECT id FROM public.organizations WHERE id=organization_id AND (EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=id AND m.user_id=auth.uid()))));
REVOKE ALL ON public.magnisa_internal_transfers FROM anon,authenticated;
GRANT SELECT ON public.magnisa_internal_transfers TO authenticated;

CREATE OR REPLACE FUNCTION public.magnisa_record_transfer_debit(
 p_org uuid,p_source uuid,p_destination uuid,p_date date,
 p_source_debit numeric,p_destination_credit numeric,p_fee numeric,
 p_reference text,p_request_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_source public.financial_accounts%rowtype;v_dest public.financial_accounts%rowtype;v_entry uuid;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'treasury.transfer');
 IF p_source=p_destination OR p_source IS NULL OR p_destination IS NULL THEN RAISE EXCEPTION 'Comptes source et destination distincts requis'; END IF;
 IF p_date IS NULL OR p_date>current_date THEN RAISE EXCEPTION 'Date de debit invalide'; END IF;
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
  VALUES(p_org,p_source,p_date,-p_fee,'operator_fee','internal_transfer_fee',v_id,btrim(p_reference),'Frais reels de transfert vers '||v_dest.name);
 END IF;
 INSERT INTO public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit,status)
 VALUES(p_org,p_date,btrim(p_reference),'Debit source confirme - fonds en transit','internal_transfer_debit',v_id,p_source_debit,p_source_debit,'posted') RETURNING id INTO v_entry;
 INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id)
 VALUES (p_org,v_entry,'TRANSIT:'||v_id::text,'Fonds en transit',p_destination_credit,0,null),
 (p_org,v_entry,'TREASURY:'||p_source::text,v_source.name,0,p_source_debit,p_source),
 (p_org,v_entry,'TRANSFER_FEES','Frais de transfert reels',p_fee,0,null);
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.magnisa_confirm_transfer_credit(
 p_org uuid,p_transfer uuid,p_date date,p_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
 IF p_date IS NULL OR p_date<v_t.transfer_date OR p_date>current_date OR nullif(btrim(p_reference),'') IS NULL
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
END;$$;
REVOKE ALL ON FUNCTION public.magnisa_record_transfer_debit(uuid,uuid,uuid,date,numeric,numeric,numeric,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.magnisa_confirm_transfer_credit(uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.magnisa_record_transfer_debit(uuid,uuid,uuid,date,numeric,numeric,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_confirm_transfer_credit(uuid,uuid,date,text) TO authenticated;