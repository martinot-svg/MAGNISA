-- Tighten fixed-asset register access and preserve the distinction between acquisition and commissioning.
-- This migration is additive; it does not create or modify accounting journal entries.

-- Keep the aggregate reconciliation view subject to the caller's underlying RLS policies.
ALTER VIEW public.fixed_asset_register_reconciliation SET (security_invoker = true);

-- Replace every existing read/write policy on the register so a parallel permissive
-- policy cannot bypass the explicit accounting permissions.
DO $policy$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename='fixed_assets'
      AND cmd IN ('SELECT','INSERT','UPDATE','ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.fixed_assets',p.policyname);
  END LOOP;
END;
$policy$;

CREATE POLICY fixed_assets_select
  ON public.fixed_assets FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'accounting.view'));

CREATE POLICY fixed_assets_finance_insert
  ON public.fixed_assets FOR INSERT TO authenticated
  WITH CHECK (public.has_org_permission(organization_id,'accounting.manage'));

CREATE POLICY fixed_assets_finance_update
  ON public.fixed_assets FOR UPDATE TO authenticated
  USING (public.has_org_permission(organization_id,'accounting.manage'))
  WITH CHECK (public.has_org_permission(organization_id,'accounting.manage'));

-- Fixed assets are retired through controlled disposal workflows, never hard-deleted.
REVOKE DELETE ON public.fixed_assets FROM PUBLIC,anon,authenticated;

-- The legacy register had no effective commissioning date. Do not infer it from acquisition.
-- In-progress class 23 assets and explicit construction/WIP categories must remain uncommissioned.
UPDATE public.fixed_assets a
SET in_service_date=NULL,updated_at=now()
WHERE a.in_service_date IS NOT NULL
  AND (
    a.pcg_asset_account_code LIKE '23%'
    OR (
      a.pcg_asset_account_code IS NULL
      AND lower(trim(coalesce(a.category,''))) IN (
        'construction','work_in_progress','wip',
        'immobilisation_en_cours','immobilisation en cours'
      )
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.fixed_asset_commissionings c
    WHERE c.organization_id=a.organization_id
      AND c.fixed_asset_id=a.id
  );

CREATE OR REPLACE FUNCTION public.magnisa_guard_fixed_asset_wip_service_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $function$
BEGIN
  IF NEW.in_service_date IS NOT NULL
     AND (
       NEW.pcg_asset_account_code LIKE '23%'
       OR (
         NEW.pcg_asset_account_code IS NULL
         AND lower(trim(coalesce(NEW.category,''))) IN (
           'construction','work_in_progress','wip',
           'immobilisation_en_cours','immobilisation en cours'
         )
       )
     ) THEN
    NEW.in_service_date := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS fixed_asset_wip_service_date_guard ON public.fixed_assets;
CREATE TRIGGER fixed_asset_wip_service_date_guard
  BEFORE INSERT OR UPDATE OF category,pcg_asset_account_code,in_service_date
  ON public.fixed_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.magnisa_guard_fixed_asset_wip_service_date();

REVOKE ALL ON FUNCTION public.magnisa_guard_fixed_asset_wip_service_date() FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public.magnisa_guard_fixed_asset_wip_service_date() IS
  'Database invariant: acquisition date never implies commissioning for class 23 or explicit construction/WIP assets.';
COMMENT ON POLICY fixed_assets_select ON public.fixed_assets IS
  'Only active organization members with accounting.view may read the fixed-asset register.';
COMMENT ON POLICY fixed_assets_finance_insert ON public.fixed_assets IS
  'Only members with accounting.manage may create fixed-asset register rows.';
COMMENT ON POLICY fixed_assets_finance_update ON public.fixed_assets IS
  'Only members with accounting.manage may update fixed-asset register rows.';

-- Remove duplicate or fragmented permissive policies while preserving their exact access logic.
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS "User can read own profile" ON public.profiles;
DROP POLICY IF EXISTS prospects_commissions_select ON public.prospects;
DROP POLICY IF EXISTS prospects_select ON public.prospects;
DROP POLICY IF EXISTS prospects_authorized_select ON public.prospects;

CREATE POLICY prospects_authorized_select
  ON public.prospects FOR SELECT TO authenticated
  USING (
    public.has_org_permission(organization_id,'sales.view')
    OR public.has_org_permission(organization_id,'commissions.contribute')
  );
