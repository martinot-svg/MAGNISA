BEGIN;

INSERT INTO auth.users (
  id, email, email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES
  ('30000000-0000-4000-8000-000000000101', 'settings-viewer@magnisa.test', now(), now(), now(),
   '{"first_name":"Settings","last_name":"Viewer"}'::jsonb, '{"provider":"email","providers":["email"]}'::jsonb),
  ('30000000-0000-4000-8000-000000000102', 'settings-finance@magnisa.test', now(), now(), now(),
   '{"first_name":"Settings","last_name":"Finance"}'::jsonb, '{"provider":"email","providers":["email"]}'::jsonb),
  ('30000000-0000-4000-8000-000000000103', 'settings-owner@magnisa.test', now(), now(), now(),
   '{"first_name":"Settings","last_name":"Owner"}'::jsonb, '{"provider":"email","providers":["email"]}'::jsonb),
  ('30000000-0000-4000-8000-000000000104', 'settings-invited@magnisa.test', now(), now(), now(),
   '{"first_name":"Settings","last_name":"Invited"}'::jsonb, '{"provider":"email","providers":["email"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, currency)
VALUES ('40000000-0000-4000-8000-000000000101', 'Company settings access test', 'MGA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES
  ('40000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000101', 'viewer', 'active'),
  ('40000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000102', 'finance_manager', 'active'),
  ('40000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000103', 'owner', 'active'),
  ('40000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000104', 'viewer', 'invited')
ON CONFLICT (organization_id, user_id) DO UPDATE SET
  role = EXCLUDED.role,
  status = EXCLUDED.status;

INSERT INTO public.company_settings (
  organization_id, legal_name, trade_name, tax_id, stat_id, registry_id,
  bank_details, default_payment_days, document_theme
) VALUES (
  '40000000-0000-4000-8000-000000000101',
  'Settings test legal name',
  'Settings test trade name',
  'TEST-TAX-ID',
  'TEST-STAT-ID',
  'TEST-REGISTRY-ID',
  'TEST-BANK-DETAILS',
  30,
  '{}'::jsonb
)
ON CONFLICT (organization_id) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  trade_name = EXCLUDED.trade_name,
  tax_id = EXCLUDED.tax_id,
  stat_id = EXCLUDED.stat_id,
  registry_id = EXCLUDED.registry_id,
  bank_details = EXCLUDED.bank_details,
  default_payment_days = EXCLUDED.default_payment_days;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000101', true);
DO $$
DECLARE
  v_trade_name text;
  v_tax_id text;
  v_bank_details text;
  v_count integer;
BEGIN
  SELECT trade_name, tax_id, bank_details
    INTO v_trade_name, v_tax_id, v_bank_details
  FROM public.company_settings_member_view
  WHERE organization_id = '40000000-0000-4000-8000-000000000101';

  IF v_trade_name <> 'Settings test trade name' THEN
    RAISE EXCEPTION 'Active viewer must see non-sensitive company identity';
  END IF;
  IF v_tax_id IS NOT NULL OR v_bank_details IS NOT NULL THEN
    RAISE EXCEPTION 'Viewer must not see fiscal identifiers or bank details';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.company_settings
  WHERE organization_id = '40000000-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Non-admin viewer must not read the base settings table';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000102', true);
DO $$
DECLARE
  v_tax_id text;
  v_bank_details text;
  v_count integer;
BEGIN
  SELECT tax_id, bank_details
    INTO v_tax_id, v_bank_details
  FROM public.company_settings_member_view
  WHERE organization_id = '40000000-0000-4000-8000-000000000101';

  IF v_tax_id <> 'TEST-TAX-ID' OR v_bank_details <> 'TEST-BANK-DETAILS' THEN
    RAISE EXCEPTION 'Finance manager must see fiscal identifiers and banking details';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.company_settings
  WHERE organization_id = '40000000-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Finance manager must use the permission-aware view, not the base table';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000103', true);
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.company_settings
  WHERE organization_id = '40000000-0000-4000-8000-000000000101';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner must retain base-table read access';
  END IF;

  UPDATE public.company_settings
  SET legal_name = 'Settings test legal name updated'
  WHERE organization_id = '40000000-0000-4000-8000-000000000101';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owner must retain base-table update access';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000104', true);
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.company_settings_member_view
  WHERE organization_id = '40000000-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Invited users must not read organization settings before acceptance';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
