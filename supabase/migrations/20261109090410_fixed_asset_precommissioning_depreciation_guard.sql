-- Prevent depreciation schedules for periods ending before an asset is commissioned.
CREATE OR REPLACE FUNCTION public.magnisa_guard_fixed_asset_depreciation_service_date()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_service_date date;
BEGIN
  SELECT in_service_date INTO v_service_date
  FROM public.fixed_assets
  WHERE id=NEW.fixed_asset_id AND organization_id=NEW.organization_id;
  IF v_service_date IS NULL THEN
    RAISE EXCEPTION 'Aucune dotation ne peut être planifiée avant la mise en service effective';
  END IF;
  IF NEW.period_end<v_service_date THEN
    RAISE EXCEPTION 'La période de dotation doit être postérieure ou égale à la date de mise en service';
  END IF;
  IF NEW.depreciation_charge>0 AND NEW.period_start<v_service_date
     AND NEW.period_end<v_service_date THEN
    RAISE EXCEPTION 'Une dotation antérieure à la mise en service est interdite';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fixed_asset_depreciation_service_date_guard
  ON public.fixed_asset_depreciation_entries;
CREATE TRIGGER fixed_asset_depreciation_service_date_guard
  BEFORE INSERT OR UPDATE OF period_start,period_end,depreciation_charge,fixed_asset_id,organization_id
  ON public.fixed_asset_depreciation_entries
  FOR EACH ROW EXECUTE FUNCTION public.magnisa_guard_fixed_asset_depreciation_service_date();

REVOKE ALL ON FUNCTION public.magnisa_guard_fixed_asset_depreciation_service_date() FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public.magnisa_guard_fixed_asset_depreciation_service_date() IS
  'Database invariant: no depreciation schedule may be created before the effective commissioning date.';
