-- Keep fiscal previews aligned with the real obligation engine.
-- Tax due dates are unavailable until the organization's fiscal profile is confirmed.
-- This migration does not alter existing organization data or create obligations.

create or replace function public.configured_fiscal_due_date(
  p_org uuid,
  p_organism_code text,
  p_period_start date,
  p_period_end date
) returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule jsonb;
  v_due date;
  v_day integer;
  v_days integer;
  v_profile_confirmed boolean := false;
begin
  if p_org is null
     or p_organism_code is null
     or p_period_start is null
     or p_period_end is null
     or p_period_end < p_period_start then
    return null;
  end if;

  perform public.assert_org_access(p_org);

  select coalesce(cs.fiscal_profile_confirmed, false)
    into v_profile_confirmed
  from public.company_settings cs
  where cs.organization_id = p_org;

  if not coalesce(v_profile_confirmed, false) then
    return null;
  end if;

  select r.due_rule
    into v_rule
  from public.fiscal_calendar_rules r
  where r.organization_id = p_org
    and r.organism_code = upper(p_organism_code)
    and r.status = 'validated'
    and length(trim(coalesce(r.source_label, ''))) > 0
    and (r.source_url is null or r.source_url ~* '^https?://')
    and r.effective_from <= p_period_end
    and (r.effective_to is null or r.effective_to >= p_period_end)
  order by r.effective_from desc, r.version desc
  limit 1;

  if v_rule is null then
    return null;
  end if;

  case v_rule->>'type'
    when 'day_of_next_month' then
      v_day := (v_rule->>'day')::integer;
      if v_day < 1 or v_day > 31 then return null; end if;
      v_due := (date_trunc('month', p_period_end) + interval '1 month')::date;
      v_due := v_due + (
        least(
          v_day,
          extract(day from (date_trunc('month', v_due) + interval '1 month - 1 day'))::integer
        ) - 1
      );
    when 'days_after_period_end' then
      v_days := (v_rule->>'days')::integer;
      if v_days < 0 or v_days > 366 then return null; end if;
      v_due := p_period_end + v_days;
    when 'day_of_month_after_quarter' then
      v_day := (v_rule->>'day')::integer;
      if v_day < 1 or v_day > 31 then return null; end if;
      v_due := (date_trunc('quarter', p_period_end) + interval '3 months')::date;
      v_due := v_due + (
        least(
          v_day,
          extract(day from (date_trunc('month', v_due) + interval '1 month - 1 day'))::integer
        ) - 1
      );
    when 'fixed_date' then
      v_due := (v_rule->>'date')::date;
      if v_due < p_period_start then return null; end if;
    else
      return null;
  end case;

  return v_due;
exception
  when others then return null;
end;
$$;

revoke all on function public.configured_fiscal_due_date(uuid, text, date, date) from public, anon;
grant execute on function public.configured_fiscal_due_date(uuid, text, date, date) to authenticated;

create or replace function public.preview_fiscal_social_obligations(
  p_org uuid,
  p_period_start date,
  p_period_end date
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_settings record;
  v_vat_collected numeric := 0;
  v_vat_input numeric := 0;
  v_irsa numeric := 0;
  v_cnaps numeric := 0;
  v_ostie numeric := 0;
  v_net numeric := 0;
  v_tva_due date;
  v_irsa_due date;
  v_cnaps_due date;
  v_ostie_due date;
  v_warnings text[] := array[]::text[];
  v_tax jsonb := '[]'::jsonb;
  v_social jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.organization_members
    where organization_id = p_org
      and user_id = auth.uid()
      and status = 'active'
  ) then
    raise exception 'Accès refusé à cette organisation';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Période invalide';
  end if;

  select
    vat_status,
    vat_rate,
    income_tax_regime,
    cnaps_enabled,
    ostie_enabled,
    fiscal_profile_confirmed,
    fiscal_profile_source
  into v_settings
  from public.company_settings
  where organization_id = p_org;

  if not found then
    v_warnings := array_append(v_warnings, 'Paramètres fiscaux de l’entreprise absents.');
  elsif not coalesce(v_settings.fiscal_profile_confirmed, false) then
    v_warnings := array_append(v_warnings, 'Profil fiscal non confirmé : les échéances fiscales ne sont pas activées.');
  end if;

  if v_settings.income_tax_regime is null or v_settings.income_tax_regime = 'A_VERIFIER' then
    v_warnings := array_append(v_warnings, 'Régime fiscal à confirmer.');
  end if;

  if coalesce(v_settings.vat_status, 'A_VERIFIER') = 'A_VERIFIER' then
    v_warnings := array_append(v_warnings, 'Assujettissement à la TVA à confirmer.');
  elsif v_settings.vat_status = 'ASSUJETTIE' then
    select coalesce(sum(i.tax_total), 0)
      into v_vat_collected
    from public.invoices i
    where i.organization_id = p_org
      and i.issue_date between p_period_start and p_period_end
      and i.status <> 'cancelled';

    select coalesce(sum(si.tax_total), 0)
      into v_vat_input
    from public.supplier_invoices si
    where si.organization_id = p_org
      and si.invoice_date between p_period_start and p_period_end
      and si.status in ('validated', 'partially_paid', 'paid');

    v_net := v_vat_collected - v_vat_input;
    v_tva_due := public.configured_fiscal_due_date(p_org, 'DGI_TVA', p_period_start, p_period_end);

    if v_tva_due is null then
      if not coalesce(v_settings.fiscal_profile_confirmed, false) then
        v_warnings := array_append(v_warnings, 'TVA : échéance indisponible tant que le profil fiscal n’est pas confirmé.');
      else
        v_warnings := array_append(v_warnings, 'TVA : aucune règle DGI_TVA validée et applicable.');
      end if;
    end if;

    if v_vat_collected = 0 and v_vat_input = 0 then
      v_warnings := array_append(v_warnings, 'Aucune TVA comptabilisée sur les factures retenues. Vérifier la saisie des taxes avant toute déclaration.');
    end if;

    v_tax := v_tax || jsonb_build_array(jsonb_build_object(
      'type', 'TVA',
      'period_start', p_period_start,
      'period_end', p_period_end,
      'due_date', v_tva_due,
      'vat_collected', v_vat_collected,
      'vat_input_identified', v_vat_input,
      'net_before_carryforward', v_net,
      'vat_credit_before_carryforward', greatest(-v_net, 0),
      'amount_proposed', greatest(v_net, 0),
      'rule_code', 'TVA_MONTHLY',
      'requires_review', true,
      'note', 'Aperçu uniquement. Tout crédit de TVA reste visible et doit être rapproché des reports antérieurs.'
    ));
  end if;

  select
    coalesce(sum(p.income_tax), 0),
    coalesce(sum(p.employee_social + p.employer_social), 0),
    coalesce(sum(p.employee_health + p.employer_health), 0)
  into v_irsa, v_cnaps, v_ostie
  from public.payslips p
  join public.payroll_runs r on r.id = p.payroll_run_id
  where p.organization_id = p_org
    and r.period_start = p_period_start
    and r.period_end = p_period_end
    and p.status <> 'cancelled';

  if v_irsa > 0 then
    v_irsa_due := public.configured_fiscal_due_date(p_org, 'DGI_IRSA', p_period_start, p_period_end);
    if v_irsa_due is null then
      if not coalesce(v_settings.fiscal_profile_confirmed, false) then
        v_warnings := array_append(v_warnings, 'IRSA : échéance indisponible tant que le profil fiscal n’est pas confirmé.');
      else
        v_warnings := array_append(v_warnings, 'IRSA : aucune règle DGI_IRSA validée et applicable.');
      end if;
    end if;

    v_tax := v_tax || jsonb_build_array(jsonb_build_object(
      'type', 'IRSA',
      'period_start', p_period_start,
      'period_end', p_period_end,
      'due_date', v_irsa_due,
      'amount_proposed', v_irsa,
      'rule_code', 'IRSA_MONTHLY',
      'requires_review', true,
      'note', 'Montant issu des bulletins de paie retenus. Échéance à confirmer avant déclaration.'
    ));
  end if;

  if coalesce(v_settings.cnaps_enabled, false) and v_cnaps > 0 then
    v_cnaps_due := public.configured_social_due_date(p_org, 'CNAPS', p_period_start, p_period_end);
    if v_cnaps_due is null then
      v_warnings := array_append(v_warnings, 'Cotisations CNaPS : aucune règle de calendrier validée et applicable.');
    end if;

    v_social := v_social || jsonb_build_array(jsonb_build_object(
      'type', 'CNaPS',
      'period_start', p_period_start,
      'period_end', p_period_end,
      'due_date', v_cnaps_due,
      'amount_proposed', v_cnaps,
      'rule_code', 'CNAPS_MONTHLY',
      'requires_review', true,
      'note', 'Montant indicatif des parts salarié et employeur issues des bulletins retenus.'
    ));
  end if;

  if coalesce(v_settings.ostie_enabled, false) and v_ostie > 0 then
    v_ostie_due := public.configured_social_due_date(p_org, 'OSTIE', p_period_start, p_period_end);
    if v_ostie_due is null then
      v_warnings := array_append(v_warnings, 'Cotisations santé : aucune règle de calendrier validée et applicable.');
    end if;

    v_social := v_social || jsonb_build_array(jsonb_build_object(
      'type', 'OSTIE',
      'period_start', p_period_start,
      'period_end', p_period_end,
      'due_date', v_ostie_due,
      'amount_proposed', v_ostie,
      'rule_code', 'OSTIE_MONTHLY',
      'requires_review', true,
      'note', 'Montant indicatif des parts salarié et employeur issues des bulletins retenus.'
    ));
  end if;

  return jsonb_build_object(
    'mode', 'preview_only',
    'writes_performed', false,
    'organization_id', p_org,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'profile_confirmed', coalesce(v_settings.fiscal_profile_confirmed, false),
    'warnings', to_jsonb(v_warnings),
    'tax_obligations', v_tax,
    'social_obligations', v_social,
    'ready_for_generation', false
  );
end;
$$;

revoke all on function public.preview_fiscal_social_obligations(uuid, date, date) from public, anon;
grant execute on function public.preview_fiscal_social_obligations(uuid, date, date) to authenticated;
