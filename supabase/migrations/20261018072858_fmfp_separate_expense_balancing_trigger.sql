CREATE OR REPLACE FUNCTION public.payroll_fmfp_debit_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.account_key='FMFP_PAYABLE' AND NEW.credit>0 THEN
 INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
 VALUES(NEW.organization_id,NEW.journal_entry_id,'PAYROLL_EXPENSE:FMFP','Charge patronale FMFP',NEW.credit,0);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fmfp_debit_line ON public.journal_entry_lines;
CREATE TRIGGER trg_fmfp_debit_line AFTER INSERT ON public.journal_entry_lines FOR EACH ROW WHEN (NEW.account_key='FMFP_PAYABLE') EXECUTE FUNCTION public.payroll_fmfp_debit_line();