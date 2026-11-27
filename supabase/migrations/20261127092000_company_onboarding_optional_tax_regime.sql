-- D-09: tax regime is optional during organization onboarding.
-- Preserve the exact checksum of 20261113184000_create_company_onboarding.sql
-- because that historical migration has already been applied in production.
create or replace function public.magnisa_create_onboarded_company(p_payload jsonb)
returns uuid language plpgsql security invoker
set search_path=pg_catalog,public as $magnisa$
declare
  v_org uuid;
  v_name text;
  v_currency text;
  v_sector text;
  v_region text;
  v_status text;
  v_regime text;
  v_vat text;
  v_start date;
  v_end date;
  v_updated integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Connexion requise' using errcode='28000';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 32768 then
    raise exception 'Formulaire d’entreprise invalide' using errcode='22023';
  end if;
  v_name := btrim(coalesce(p_payload->>'legalName',''));
  v_currency := coalesce(p_payload->>'currency','MGA');
  v_sector := coalesce(p_payload->>'sectorCode','');
  v_region := coalesce(p_payload->>'regionCode','');
  v_status := coalesce(p_payload->>'registrationStatus','');
  v_regime := coalesce(p_payload->>'taxRegime','');
  v_vat := coalesce(p_payload->>'vatStatus','');
  if length(v_name) not between 2 and 160
    or v_currency not in ('MGA','EUR','USD')
    or v_sector !~ '^[A-U]$'
    or v_region !~ '^9(0[1-9]|1[0-9]|2[0-4])$'
    or coalesce(p_payload->>'country','') <> 'MG'
    or length(btrim(coalesce(p_payload->>'localityName',''))) not between 2 and 160
    or length(btrim(coalesce(p_payload->>'primaryActivity',''))) not between 2 and 160
    or coalesce(p_payload->>'legalForm','') not in
      ('EI','SARL','SARLU','SA','SAU','SNC','SCS','COOPERATIVE','ASSOCIATION','AUTRE')
    or v_status not in ('registered','pending')
    or v_regime not in ('','IR','IS','A_VERIFIER')
    or v_vat not in ('ASSUJETTIE','NON_ASSUJETTIE','A_VERIFIER')
    or jsonb_typeof(p_payload->'secondaryActivities') <> 'array'
    or jsonb_array_length(p_payload->'secondaryActivities') > 100
  then raise exception 'Paramètres de création invalides' using errcode='22023'; end if;
  begin
    v_start := (p_payload->>'fiscalStart')::date;
    v_end := (p_payload->>'fiscalEnd')::date;
  exception when others then
    raise exception 'Dates d’exercice invalides' using errcode='22023';
  end;
  if v_start is null or v_end is null or v_start >= v_end then
    raise exception 'L’exercice comptable doit avoir une date de fin postérieure au début'
      using errcode='22023';
  end if;

  v_org := public.create_organization(v_name,v_currency);

  update public.company_settings set
    legal_name=v_name,
    trade_name=nullif(btrim(coalesce(p_payload->>'tradeName','')),''),
    slogan=nullif(btrim(coalesce(p_payload->>'slogan','')),''),
    activity_sector=v_sector,
    address=nullif(btrim(coalesce(p_payload->>'address','')),''),
    phone=nullif(btrim(coalesce(p_payload->>'phone','')),''),
    email=nullif(btrim(coalesce(p_payload->>'email','')),''),
    tax_id=nullif(btrim(coalesce(p_payload->>'nif','')),''),
    stat_id=nullif(btrim(coalesce(p_payload->>'stat','')),''),
    registry_id=nullif(btrim(coalesce(p_payload->>'rcs','')),''),
    income_tax_regime=nullif(v_regime,''),
    vat_status=v_vat,
    fiscal_profile_confirmed=false,
    fiscal_profile_source='DÉCLARATION À CONFIRMER',
    onboarding_profile=p_payload,
    updated_at=now()
  where organization_id=v_org;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Enregistrement des paramètres de l’entreprise impossible';
  end if;
  return v_org;
end;
$magnisa$;
revoke all on function public.magnisa_create_onboarded_company(jsonb)
  from public, anon;
grant execute on function public.magnisa_create_onboarded_company(jsonb) to authenticated;
