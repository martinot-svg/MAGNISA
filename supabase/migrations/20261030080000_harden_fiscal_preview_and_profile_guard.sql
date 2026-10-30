-- Fiscal engine safety: preview displays configured deadlines and generation requires a confirmed profile.
create or replace function public.preview_fiscal_social_obligations(
  p_org uuid, p_period_start date, p_period_end date
) returns jsonb
language plpgsql set search_path=public as $$
declare
  v_settings record;
  v_vat_collected numeric := 0;
  v_vat_input numeric := 0;
  v_irsa numeric := 0;
  v_cnaps numeric := 0;
  v_ostie numeric := 0;
  v_tva_due date;
  v_irsa_due date;
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
    v_tva_due := public.configured_fiscal_due_date(p_org,'DGI_TVA',p_period_start,p_period_end);
    if v_tva_due is null then
      v_warnings := array_append(v_warnings, 'TVA : aucune règle fiscale validée et applicable (DGI_TVA). Échéance à confirmer.');
    end if;
    if v_vat_collected = 0 and v_vat_input = 0 then
      v_warnings := array_append(v_warnings, 'Aucune TVA comptabilisée sur les factures retenues. Vérifier la saisie des taxes avant toute déclaration.');
    end if;
    v_tax := v_tax || jsonb_build_array(jsonb_build_object(
      'type','TVA',
      'period_start',p_period_start,
      'period_end',p_period_end,
      'due_date',v_tva_due,
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
    v_irsa_due := public.configured_fiscal_due_date(p_org,'DGI_IRSA',p_period_start,p_period_end);
    if v_irsa_due is null then
      v_warnings := array_append(v_warnings, 'IRSA : aucune règle fiscale validée et applicable (DGI_IRSA). Échéance à confirmer.');
    end if;
    v_tax := v_tax || jsonb_build_array(jsonb_build_object(
      'type','IRSA','period_start',p_period_start,'period_end',p_period_end,
      'due_date',v_irsa_due,'amount_proposed',v_irsa,'rule_code','IRSA_MONTHLY',
      'requires_review',true,
      'note','Échéance issue du calendrier fiscal validé, à contrôler avant déclaration.'
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
$$;

create or replace function public.refresh_fiscal_social_obligations(
  p_org uuid, p_period_start date, p_period_end date
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_vat_status text;
  v_vat_rate numeric := 20;
  v_regime text;
  v_cnaps boolean := false;
  v_ostie boolean := false;
  v_profile_confirmed boolean := false;
  v_vat_collected numeric := 0;
  v_vat_input numeric := 0;
  v_vat_due numeric := 0;
  v_irsa numeric := 0;
  v_cnaps_amount numeric := 0;
  v_ostie_amount numeric := 0;
  v_tva_due date;
  v_irsa_due date;
  v_cnaps_due date;
  v_ostie_due date;
  v_period_key text;
  v_count integer := 0;
  v_warnings text[] := array[]::text[];
begin
  perform public.assert_org_access(p_org);
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Période invalide';
  end if;
  v_period_key := to_char(p_period_start,'YYYYMM') || '_' || to_char(p_period_end,'YYYYMMDD');

  select vat_status, vat_rate, income_tax_regime, cnaps_enabled, ostie_enabled, fiscal_profile_confirmed
    into v_vat_status, v_vat_rate, v_regime, v_cnaps, v_ostie, v_profile_confirmed
  from public.company_settings
  where organization_id = p_org;

  if not found or not coalesce(v_profile_confirmed,false) then
    v_warnings := array_append(v_warnings, 'Profil fiscal absent ou non confirmé : génération bloquée. Confirmer les paramètres fiscaux avant toute création d’obligation.');
    return jsonb_build_object(
      'period_start',p_period_start,'period_end',p_period_end,
      'obligations_updated',0,'profile_confirmed',false,
      'vat_collected',0,'vat_input_identified',0,'vat_due',0,
      'irsa',0,'cnaps',0,'ostie',0,
      'vat_status',coalesce(v_vat_status,'A_VERIFIER'),
      'income_tax_regime',v_regime,
      'warnings',to_jsonb(v_warnings),
      'generation_blocked',true
    );
  end if;

  v_vat_status := coalesce(v_vat_status,'A_VERIFIER');
  v_vat_rate := coalesce(v_vat_rate,20);

  if v_vat_status='ASSUJETTIE' then
    select coalesce(sum(i.tax_total),0) into v_vat_collected
    from public.invoices i
    where i.organization_id=p_org and i.issue_date between p_period_start and p_period_end and i.status <> 'cancelled';
    select coalesce(sum(si.tax_total),0) into v_vat_input
    from public.supplier_invoices si
    where si.organization_id=p_org and si.invoice_date between p_period_start and p_period_end
      and si.status in ('validated','partially_paid','paid');
    v_vat_due := greatest(v_vat_collected-v_vat_input,0);
    v_tva_due := public.configured_fiscal_due_date(p_org,'DGI_TVA',p_period_start,p_period_end);
    if v_tva_due is null then
      v_warnings := array_append(v_warnings,'TVA : aucune règle fiscale validée et applicable (DGI_TVA). Obligation non créée.');
    else
      insert into public.tax_obligations(
        organization_id,obligation_type,period_start,period_end,due_date,amount,paid_amount,status,notes,
        calculation_key,rule_code,source_summary,calculated_at
      ) values (
        p_org,'TVA',p_period_start,p_period_end,v_tva_due,v_vat_due,0,'open',
        format('TVA collectée %s - TVA achats identifiée %s',v_vat_collected,v_vat_input),
        'AUTO_TVA_'||v_period_key,'TVA_MONTHLY',
        format('TVA collectée: %s; TVA achats identifiée: %s; statut TVA: %s; taux de référence: %s%%',v_vat_collected,v_vat_input,v_vat_status,v_vat_rate),now()
      )
      on conflict (organization_id,calculation_key) where calculation_key is not null do update set
        amount=case when public.tax_obligations.paid_amount>0 or public.tax_obligations.status='paid' then public.tax_obligations.amount else excluded.amount end,
        due_date=case when public.tax_obligations.paid_amount>0 or public.tax_obligations.status='paid' then public.tax_obligations.due_date else excluded.due_date end,
        notes=excluded.notes,source_summary=excluded.source_summary,rule_code=excluded.rule_code,calculated_at=excluded.calculated_at,
        status=case when public.tax_obligations.paid_amount>=excluded.amount or public.tax_obligations.status='paid' then 'paid'
          when public.tax_obligations.paid_amount>0 then 'partially_paid' else 'open' end;
      v_count := v_count+1;
    end if;
  end if;

  select coalesce(sum(p.income_tax),0),
         coalesce(sum(p.employee_social+p.employer_social),0),
         coalesce(sum(p.employee_health+p.employer_health),0)
    into v_irsa,v_cnaps_amount,v_ostie_amount
  from public.payslips p join public.payroll_runs r on r.id=p.payroll_run_id
  where p.organization_id=p_org and r.period_start=p_period_start and r.period_end=p_period_end and p.status<>'cancelled';

  if v_irsa>0 then
    v_irsa_due := public.configured_fiscal_due_date(p_org,'DGI_IRSA',p_period_start,p_period_end);
    if v_irsa_due is null then
      v_warnings := array_append(v_warnings,'IRSA : aucune règle fiscale validée et applicable (DGI_IRSA). Obligation non créée.');
    else
      insert into public.tax_obligations(
        organization_id,obligation_type,period_start,period_end,due_date,amount,paid_amount,status,notes,
        calculation_key,rule_code,source_summary,calculated_at
      ) values (
        p_org,'IRSA',p_period_start,p_period_end,v_irsa_due,v_irsa,0,'open',
        'Montant issu des bulletins de paie validés',
        'AUTO_IRSA_'||v_period_key,'IRSA_MONTHLY',
        'Somme de l’IRSA retenu sur les bulletins de la période',now()
      )
      on conflict (organization_id,calculation_key) where calculation_key is not null do update set
        amount=case when public.tax_obligations.paid_amount>0 or public.tax_obligations.status='paid' then public.tax_obligations.amount else excluded.amount end,
        due_date=case when public.tax_obligations.paid_amount>0 or public.tax_obligations.status='paid' then public.tax_obligations.due_date else excluded.due_date end,
        notes=excluded.notes,source_summary=excluded.source_summary,calculated_at=excluded.calculated_at,
        status=case when public.tax_obligations.paid_amount>=excluded.amount or public.tax_obligations.status='paid' then 'paid'
          when public.tax_obligations.paid_amount>0 then 'partially_paid' else 'open' end;
      v_count := v_count+1;
    end if;
  end if;

  if v_cnaps and v_cnaps_amount>0 then
    v_cnaps_due := public.configured_social_due_date(p_org,'CNAPS',p_period_start,p_period_end);
    if v_cnaps_due is null then
      v_warnings := array_append(v_warnings,'CNaPS : aucune règle de calendrier validée et applicable. Obligation non créée.');
    else
      insert into public.social_obligations(
        organization_id,organization_name,period_start,period_end,due_date,amount,paid_amount,status,notes,
        calculation_key,rule_code,source_summary,calculated_at
      ) values (
        p_org,'CNaPS',p_period_start,p_period_end,v_cnaps_due,v_cnaps_amount,0,'open',
        'Cotisations salariales et patronales issues de la paie',
        'AUTO_CNAPS_'||v_period_key,'CNAPS_CALENDAR',
        'Source: bulletins de paie; échéance issue du calendrier validé',now()
      )
      on conflict (organization_id,calculation_key) where calculation_key is not null do update set
        amount=case when public.social_obligations.paid_amount>0 or public.social_obligations.status='paid' then public.social_obligations.amount else excluded.amount end,
        due_date=case when public.social_obligations.paid_amount>0 or public.social_obligations.status='paid' then public.social_obligations.due_date else excluded.due_date end,
        notes=excluded.notes,source_summary=excluded.source_summary,rule_code=excluded.rule_code,calculated_at=excluded.calculated_at,
        status=case when public.social_obligations.paid_amount>=excluded.amount or public.social_obligations.status='paid' then 'paid'
          when public.social_obligations.paid_amount>0 then 'partially_paid' else 'open' end;
      v_count := v_count+1;
    end if;
  end if;

  if v_ostie and v_ostie_amount>0 then
    v_ostie_due := public.configured_social_due_date(p_org,'OSTIE',p_period_start,p_period_end);
    if v_ostie_due is null then
      v_warnings := array_append(v_warnings,'OSTIE : aucune règle de calendrier validée et applicable. Obligation non créée.');
    else
      insert into public.social_obligations(
        organization_id,organization_name,period_start,period_end,due_date,amount,paid_amount,status,notes,
        calculation_key,rule_code,source_summary,calculated_at
      ) values (
        p_org,'OSTIE',p_period_start,p_period_end,v_ostie_due,v_ostie_amount,0,'open',
        'Cotisations santé issues de la paie',
        'AUTO_OSTIE_'||v_period_key,'OSTIE_CALENDAR',
        'Source: bulletins de paie; échéance issue du calendrier validé',now()
      )
      on conflict (organization_id,calculation_key) where calculation_key is not null do update set
        amount=case when public.social_obligations.paid_amount>0 or public.social_obligations.status='paid' then public.social_obligations.amount else excluded.amount end,
        due_date=case when public.social_obligations.paid_amount>0 or public.social_obligations.status='paid' then public.social_obligations.due_date else excluded.due_date end,
        notes=excluded.notes,source_summary=excluded.source_summary,rule_code=excluded.rule_code,calculated_at=excluded.calculated_at,
        status=case when public.social_obligations.paid_amount>=excluded.amount or public.social_obligations.status='paid' then 'paid'
          when public.social_obligations.paid_amount>0 then 'partially_paid' else 'open' end;
      v_count := v_count+1;
    end if;
  end if;

  return jsonb_build_object(
    'period_start',p_period_start,'period_end',p_period_end,'obligations_updated',v_count,
    'profile_confirmed',true,'generation_blocked',false,
    'vat_collected',v_vat_collected,'vat_input_identified',v_vat_input,'vat_due',v_vat_due,
    'irsa',v_irsa,'cnaps',v_cnaps_amount,'ostie',v_ostie_amount,
    'vat_status',v_vat_status,'income_tax_regime',v_regime,'warnings',to_jsonb(v_warnings)
  );
end;
$$;

grant execute on function public.refresh_fiscal_social_obligations(uuid,date,date) to authenticated;
