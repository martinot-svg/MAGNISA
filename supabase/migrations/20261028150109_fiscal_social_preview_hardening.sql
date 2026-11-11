create or replace function public.preview_fiscal_social_obligations(
  p_org uuid, p_period_start date, p_period_end date
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_settings record;
  v_vat_collected numeric := 0;
  v_vat_input numeric := 0;
  v_irsa numeric := 0;
  v_cnaps numeric := 0;
  v_ostie numeric := 0;
  v_warnings text[] := array[]::text[];
  v_tax jsonb := '[]'::jsonb;
  v_social jsonb := '[]'::jsonb;
  v_net numeric := 0;
begin
  if auth.uid() is null or not exists (
    select 1 from public.organization_members
    where organization_id = p_org and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Accès refusé à cette organisation';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Période invalide';
  end if;

  select vat_status, vat_rate, income_tax_regime, cnaps_enabled, ostie_enabled,
         fiscal_profile_confirmed, fiscal_profile_source
    into v_settings
  from public.company_settings
  where organization_id = p_org;

  if not found then
    v_warnings := array_append(v_warnings, 'Paramètres fiscaux de l’entreprise absents.');
  elsif not coalesce(v_settings.fiscal_profile_confirmed, false) then
    v_warnings := array_append(v_warnings, 'Profil fiscal non confirmé : aucune obligation ne doit être générée.');
  end if;
  if v_settings.income_tax_regime is null or v_settings.income_tax_regime = 'A_VERIFIER' then
    v_warnings := array_append(v_warnings, 'Régime fiscal à confirmer.');
  end if;

  if coalesce(v_settings.vat_status, 'A_VERIFIER') = 'A_VERIFIER' then
    v_warnings := array_append(v_warnings, 'Assujettissement à la TVA à confirmer.');
  elsif v_settings.vat_status = 'ASSUJETTIE' then
    select coalesce(sum(i.tax_total),0) into v_vat_collected
    from public.invoices i
    where i.organization_id = p_org
      and i.issue_date between p_period_start and p_period_end
      and i.status in ('issued','paid');

    select coalesce(sum(si.tax_total),0) into v_vat_input
    from public.supplier_invoices si
    where si.organization_id = p_org
      and si.invoice_date between p_period_start and p_period_end
      and si.status in ('validated','partially_paid','paid');

    v_net := v_vat_collected - v_vat_input;
    v_warnings := array_append(v_warnings, 'La date légale de déclaration et de paiement de TVA doit être confirmée pour le régime de cette entreprise.');
    if v_vat_collected = 0 and v_vat_input = 0 then
      v_warnings := array_append(v_warnings, 'Aucune TVA comptabilisée sur les factures retenues. Vérifier la saisie des taxes avant toute déclaration.');
    end if;
    v_tax := v_tax || jsonb_build_array(jsonb_build_object(
      'type','TVA',
      'period_start',p_period_start,
      'period_end',p_period_end,
      'due_date',null,
      'vat_collected',v_vat_collected,
      'vat_input_identified',v_vat_input,
      'net_before_carryforward',v_net,
      'vat_credit_before_carryforward',greatest(-v_net,0),
      'amount_proposed',greatest(v_net,0),
      'rule_code','TVA_MONTHLY',
      'requires_review',true,
      'note','Aperçu uniquement. Tout crédit de TVA reste visible et doit être rapproché des reports antérieurs.'
    ));
  end if;

  select coalesce(sum(p.income_tax),0),
         coalesce(sum(p.employee_social + p.employer_social),0),
         coalesce(sum(p.employee_health + p.employer_health),0)
    into v_irsa, v_cnaps, v_ostie
  from public.payslips p
  join public.payroll_runs r on r.id = p.payroll_run_id
  where p.organization_id = p_org
    and r.period_start = p_period_start
    and r.period_end = p_period_end
    and p.status in ('calculated','paid')
    and r.status in ('calculated','approved','paid');

  if v_irsa > 0 then
    v_warnings := array_append(v_warnings, 'Montant IRSA issu de la paie : vérifier le bulletin final et la date légale avant déclaration.');
    v_tax := v_tax || jsonb_build_array(jsonb_build_object(
      'type','IRSA','period_start',p_period_start,'period_end',p_period_end,
      'due_date',null,'amount_proposed',v_irsa,'rule_code','IRSA_MONTHLY',
      'requires_review',true,
      'note','Échéance et concordance avec la déclaration officielle à confirmer.'
    ));
  end if;
  if coalesce(v_settings.cnaps_enabled,false) and v_cnaps > 0 then
    v_warnings := array_append(v_warnings, 'Cotisations CNaPS : confirmer la base, les taux, le plafond et l’échéance applicables.');
    v_social := v_social || jsonb_build_array(jsonb_build_object(
      'type','CNaPS','period_start',p_period_start,'period_end',p_period_end,
      'due_date',null,'amount_proposed',v_cnaps,'rule_code','CNAPS_MONTHLY',
      'requires_review',true,
      'note','Montant indicatif des parts salarié et employeur issues des bulletins retenus.'
    ));
  end if;
  if coalesce(v_settings.ostie_enabled,false) and v_ostie > 0 then
    v_warnings := array_append(v_warnings, 'Cotisations santé : confirmer l’organisme, la base et les modalités applicables.');
    v_social := v_social || jsonb_build_array(jsonb_build_object(
      'type','OSTIE','period_start',p_period_start,'period_end',p_period_end,
      'due_date',null,'amount_proposed',v_ostie,'rule_code',null,
      'requires_review',true,
      'note','Montant indicatif des parts salarié et employeur issues des bulletins retenus.'
    ));
  end if;

  return jsonb_build_object(
    'mode','preview_only',
    'writes_performed',false,
    'organization_id',p_org,
    'period_start',p_period_start,
    'period_end',p_period_end,
    'profile_confirmed',coalesce(v_settings.fiscal_profile_confirmed,false),
    'warnings',to_jsonb(v_warnings),
    'tax_obligations',v_tax,
    'social_obligations',v_social,
    'ready_for_generation',false
  );
end;
$function$;

revoke all on function public.preview_fiscal_social_obligations(uuid,date,date) from public;
revoke all on function public.preview_fiscal_social_obligations(uuid,date,date) from anon;
grant execute on function public.preview_fiscal_social_obligations(uuid,date,date) to authenticated;

revoke all on function public.refresh_fiscal_social_obligations(uuid,date,date) from public;
revoke all on function public.refresh_fiscal_social_obligations(uuid,date,date) from anon;
revoke all on function public.refresh_fiscal_social_obligations(uuid,date,date) from authenticated;