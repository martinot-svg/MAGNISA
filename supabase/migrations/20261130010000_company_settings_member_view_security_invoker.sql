BEGIN;

CREATE OR REPLACE FUNCTION public.get_company_settings_member_read_model()
RETURNS TABLE (
  organization_id uuid,
  legal_name text,
  trade_name text,
  logo_url text,
  address text,
  phone text,
  email text,
  website text,
  tax_id text,
  stat_id text,
  registry_id text,
  bank_details text,
  payment_terms text,
  legal_mentions text,
  default_payment_days integer,
  updated_at timestamptz,
  slogan text,
  primary_color text,
  secondary_color text,
  accent_color text,
  font_family text,
  logo_storage_path text,
  signature_url text,
  stamp_url text,
  document_theme jsonb,
  activity_sector text,
  income_tax_regime text,
  vat_status text,
  vat_rate numeric,
  cnaps_enabled boolean,
  ostie_enabled boolean,
  fiscal_profile_confirmed boolean,
  fiscal_profile_source text,
  fiscal_profile_verified_at timestamptz,
  onboarding_profile jsonb,
  logo_inverse_storage_path text,
  auto_prepare_recurring_invoices boolean,
  recurring_invoice_lead_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
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
WHERE auth.uid() IS NOT NULL AND public.is_org_member(cs.organization_id)
$function$;

REVOKE ALL ON FUNCTION public.get_company_settings_member_read_model() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_settings_member_read_model() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.company_settings_member_view
WITH (security_barrier = true, security_invoker = true)
AS
SELECT * FROM public.get_company_settings_member_read_model();

COMMENT ON VIEW public.company_settings_member_view IS
  'Security-invoker member read model backed by a permission-aware SECURITY DEFINER function. Sensitive fields are masked by organization permission; raw company_settings remains owner/admin-only.';

REVOKE ALL ON public.company_settings_member_view FROM PUBLIC, anon;
GRANT SELECT ON public.company_settings_member_view TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
