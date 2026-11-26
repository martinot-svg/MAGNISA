-- Restore safe, permission-aware reads of company settings.
-- The base table remains writable only by organization owners and admins.

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_settings'
      AND policyname = 'company_settings_admin_select'
  ) THEN
    EXECUTE 'CREATE POLICY company_settings_admin_select
      ON public.company_settings FOR SELECT TO authenticated
      USING (public.has_org_role(organization_id, ARRAY[''owner'',''admin'']))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_settings'
      AND policyname = 'company_settings_admin_insert'
  ) THEN
    EXECUTE 'CREATE POLICY company_settings_admin_insert
      ON public.company_settings FOR INSERT TO authenticated
      WITH CHECK (public.has_org_role(organization_id, ARRAY[''owner'',''admin'']))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_settings'
      AND policyname = 'company_settings_admin_update'
  ) THEN
    EXECUTE 'CREATE POLICY company_settings_admin_update
      ON public.company_settings FOR UPDATE TO authenticated
      USING (public.has_org_role(organization_id, ARRAY[''owner'',''admin'']))
      WITH CHECK (public.has_org_role(organization_id, ARRAY[''owner'',''admin'']))';
  END IF;
END;
$policy$;

-- Restrictive guards ensure any older permissive member policy cannot expose
-- the raw settings row. Safe member reads go through the masked view below.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_settings'
      AND policyname = 'company_settings_admin_select_guard'
  ) THEN
    EXECUTE 'CREATE POLICY company_settings_admin_select_guard
      ON public.company_settings AS RESTRICTIVE FOR SELECT TO authenticated
      USING (public.has_org_role(organization_id, ARRAY[''owner'',''admin'']))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_settings'
      AND policyname = 'company_settings_admin_insert_guard'
  ) THEN
    EXECUTE 'CREATE POLICY company_settings_admin_insert_guard
      ON public.company_settings AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.has_org_role(organization_id, ARRAY[''owner'',''admin'']))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_settings'
      AND policyname = 'company_settings_admin_update_guard'
  ) THEN
    EXECUTE 'CREATE POLICY company_settings_admin_update_guard
      ON public.company_settings AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.has_org_role(organization_id, ARRAY[''owner'',''admin'']))
      WITH CHECK (public.has_org_role(organization_id, ARRAY[''owner'',''admin'']))';
  END IF;
END;
$guard$;

CREATE OR REPLACE VIEW public.company_settings_member_view
WITH (security_barrier = true)
AS
SELECT
  cs.organization_id,
  cs.legal_name,
  cs.trade_name,
  cs.logo_url,
  cs.address,
  cs.phone,
  cs.email,
  cs.website,
  CASE WHEN p.can_identity THEN cs.tax_id ELSE NULL::text END AS tax_id,
  CASE WHEN p.can_identity THEN cs.stat_id ELSE NULL::text END AS stat_id,
  CASE WHEN p.can_identity THEN cs.registry_id ELSE NULL::text END AS registry_id,
  CASE WHEN p.can_bank THEN cs.bank_details ELSE NULL::text END AS bank_details,
  CASE WHEN p.can_billing OR p.can_finance OR p.can_manage THEN cs.payment_terms ELSE NULL::text END AS payment_terms,
  CASE WHEN p.can_billing OR p.can_manage THEN cs.legal_mentions ELSE NULL::text END AS legal_mentions,
  CASE WHEN p.can_billing OR p.can_finance OR p.can_manage THEN cs.default_payment_days ELSE NULL::integer END AS default_payment_days,
  cs.updated_at,
  cs.slogan,
  cs.primary_color,
  cs.secondary_color,
  cs.accent_color,
  cs.font_family,
  cs.logo_storage_path,
  CASE WHEN p.can_documents THEN cs.signature_url ELSE NULL::text END AS signature_url,
  CASE WHEN p.can_documents THEN cs.stamp_url ELSE NULL::text END AS stamp_url,
  cs.document_theme,
  CASE WHEN p.can_fiscal THEN cs.activity_sector ELSE NULL::text END AS activity_sector,
  CASE WHEN p.can_fiscal THEN cs.income_tax_regime ELSE NULL::text END AS income_tax_regime,
  CASE WHEN p.can_fiscal THEN cs.vat_status ELSE NULL::text END AS vat_status,
  CASE WHEN p.can_fiscal THEN cs.vat_rate ELSE NULL::numeric END AS vat_rate,
  CASE WHEN p.can_fiscal THEN cs.cnaps_enabled ELSE NULL::boolean END AS cnaps_enabled,
  CASE WHEN p.can_fiscal THEN cs.ostie_enabled ELSE NULL::boolean END AS ostie_enabled,
  CASE WHEN p.can_fiscal THEN cs.fiscal_profile_confirmed ELSE false END AS fiscal_profile_confirmed,
  CASE WHEN p.can_fiscal THEN cs.fiscal_profile_source ELSE NULL::text END AS fiscal_profile_source,
  CASE WHEN p.can_fiscal THEN cs.fiscal_profile_verified_at ELSE NULL::timestamptz END AS fiscal_profile_verified_at,
  CASE WHEN p.can_manage OR p.can_finance OR p.can_accounting
    THEN cs.onboarding_profile ELSE '{}'::jsonb END AS onboarding_profile,
  cs.logo_inverse_storage_path,
  CASE WHEN p.can_billing OR p.can_finance OR p.can_manage
    THEN cs.auto_prepare_recurring_invoices ELSE false END AS auto_prepare_recurring_invoices,
  CASE WHEN p.can_billing OR p.can_finance OR p.can_manage
    THEN cs.recurring_invoice_lead_days ELSE NULL::integer END AS recurring_invoice_lead_days
FROM public.company_settings AS cs
CROSS JOIN LATERAL (
  SELECT
    public.has_org_permission(cs.organization_id, 'settings.manage') AS can_manage,
    public.has_org_role(cs.organization_id, ARRAY['owner','admin']) AS can_bank,
    public.has_org_permission(cs.organization_id, 'finance.view') AS can_finance,
    public.has_org_permission(cs.organization_id, 'accounting.view') AS can_accounting,
    public.has_org_permission(cs.organization_id, 'payroll.view') AS can_payroll,
    public.has_org_permission(cs.organization_id, 'reports.export') AS can_reports,
    public.has_org_permission(cs.organization_id, 'billing.view') AS can_billing,
    (
      public.has_org_permission(cs.organization_id, 'settings.manage')
      OR public.has_org_permission(cs.organization_id, 'finance.view')
      OR public.has_org_permission(cs.organization_id, 'accounting.view')
      OR public.has_org_permission(cs.organization_id, 'payroll.view')
      OR public.has_org_permission(cs.organization_id, 'reports.export')
    ) AS can_fiscal,
    (
      public.has_org_permission(cs.organization_id, 'settings.manage')
      OR public.has_org_permission(cs.organization_id, 'finance.view')
      OR public.has_org_permission(cs.organization_id, 'accounting.view')
      OR public.has_org_permission(cs.organization_id, 'reports.export')
      OR public.has_org_permission(cs.organization_id, 'billing.view')
    ) AS can_identity,
    (
      public.has_org_permission(cs.organization_id, 'settings.manage')
      OR public.has_org_permission(cs.organization_id, 'billing.view')
      OR public.has_org_permission(cs.organization_id, 'payroll.view')
      OR public.has_org_permission(cs.organization_id, 'reports.export')
    ) AS can_documents
) AS p
WHERE public.is_org_member(cs.organization_id);

COMMENT ON VIEW public.company_settings_member_view IS
  'Permission-aware, active-member read model for company settings. Bank details remain owner/admin-only until the product role policy is explicitly approved; fiscal fields are masked by organization permission.';

REVOKE ALL ON public.company_settings_member_view FROM PUBLIC, anon;
GRANT SELECT ON public.company_settings_member_view TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
