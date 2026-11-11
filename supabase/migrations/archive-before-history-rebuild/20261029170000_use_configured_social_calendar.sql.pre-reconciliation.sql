-- Integrate validated social calendar rules into obligation generation.
-- Never invent a due date when no verified rule applies. Preserve paid/partially paid records.
create or replace function public.configured_social_due_date(
  p_org uuid,
  p_organism_code text,
  p_period_start date,
  p_period_end date
) returns date
language plpgsql stable security definer set search_path=public as $$
declare
  v_rule jsonb;
  v_due date;
  v_day integer;
  v_days integer;
  v_effective_from date;
  v_effective_to date;
begin
  select r.due_rule, r.effective_from, r.effective_to
    into v_rule, v_effective_from, v_effective_to
  from public.social_calendar_rules r
  where r.organization_id = p_org
    and r.organism_code = upper(p_organism_code)
    and r.status = 'validated'
    and r.effective_from <= p_period_end
    and (r.effective_to is null or r.effective_to >= p_period_end)
  order by r.effective_from desc, r.version desc
  limit 1;

  if v_rule is null then return null; end if;

  case v_rule->>'type'
    when 'day_of_next_month' then
      v_day := (v_rule->>'day')::integer;
      if v_day < 1 or v_day > 31 then return null; end if;
      v_due := (date_trunc('month', p_period_end) + interval '1 month')::date;
      v_due := v_due + (least(v_day, extract(day from (date_trunc('month', v_due) + interval '1 month - 1 day'))::integer) - 1);
    when 'days_after_period_end' then
      v_days := (v_rule->>'days')::integer;
      if v_days < 0 or v_days > 366 then return null; end if;
      v_due := p_period_end + v_days;
    when 'day_of_month_after_quarter' then
      v_day := (v_rule->>'day')::integer;
      if v_day < 1 or v_day > 31 then return null; end if;
      v_due := (date_trunc('quarter', p_period_end) + interval '3 months')::date;
      v_due := v_due + (least(v_day, extract(day from (date_trunc('month', v_due) + interval '1 month - 1 day'))::integer) - 1);
    when 'fixed_date' then
      v_due := (v_rule->>'date')::date;
      if v_due < p_period_start then return null; end if;
    else
      return null;
  end case;
  return v_due;
exception when others then
  return null;
end;
$$;

revoke all on function public.configured_social_due_date(uuid,text,date,date) from public, anon;
grant execute on function public.configured_social_due_date(uuid,text,date,date) to authenticated;

create or replace function public.refresh_fiscal_social_obligations(p_org uuid,p_period_start date,p_period_end date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_vat_status text;
  v_vat_rate numeric := 20;
  v_regime text;
  v_cnaps boolean := false;
  v_ostie boolean := false;
  v_vat_collected numeric := 0;
  v_vat_input numeric := 0;
  v_vat_due numeric := 0;
  v_irsa numeric := 0;
  v_cnaps_amount numeric := 0;
  v_ostie_amount numeric := 0;
  v_due date;
  v_cnaps_due date;
  v_ostie_due date;
  v_period_key text := to_char(p_period_start,'YYYYMM') || '_' || to_char(p_period_end,'YYYYMMDD');
  v_count integer := 0;
  v_warnings text[] := array[]::text[];
begin
  perform public.assert_org_access(p_org);

  select vat_status, vat_rate, income_tax_regime, cnaps_enabled, ostie_enabled
    into v_vat_status, v_vat_rate, v_regime, v_cnaps, v_ostie
  from public.company_settings where organization_id=p_org;

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

    v_vat_due := greatest(v_vat_collected - v_vat_input,0);
    v_due := public.next_month_due_date(p_period_end,15);

    insert into public.tax_obligations(
      organization_id,obligation_type,period_start,period_end,due_date,amount,paid_amount,status,notes,
      calculation_key,rule_code,source_summary,calculated_at
    ) values (
      p_org,'TVA',p_period_start,p_period_end,v_due,v_vat_due,0,'open',
      format('TVA collectée %s - TVA achats identifiée %s',v_vat_collected,v_vat_input),
      'AUTO_TVA_'||v_period_key,'TVA_MONTHLY',
      format('TVA collectée: %s; TVA achats identifiée: %s; statut TVA: %s; taux de référence: %s%%',v_vat_collected,v_vat_input,v_vat_status,v_vat_rate),now()
    )
    on conflict (organization_id,calculation_key) where calculation_key is not null
    do update set
      amount=case when public.tax_obligations.paid_amount > 0 or public.tax_obligations.status='paid' then public.tax_obligations.amount else excluded.amount end,
      due_date=case when public.tax_obligations.paid_amount > 0 or public.tax_obligations.status='paid' then public.tax_obligations.due_date else excluded.due_date end,
      notes=excluded.notes,source_summary=excluded.source_summary,rule_code=excluded.rule_code,calculated_at=excluded.calculated_at,
      status=case when public.tax_obligations.paid_amount >= excluded.amount or public.tax_obligations.status='paid' then 'paid'
                  when public.tax_obligations.paid_amount > 0 then 'partially_paid' else 'open' end;
    v_count := v_count + 1;
  end if;

  select coalesce(sum(p.income_tax),0),
         coalesce(sum(p.employee_social + p.employer_social),0),
         coalesce(sum(p.employee_health + p.employer_health),0)
    into v_irsa,v_cnaps_amount,v_ostie_amount
  from public.payslips p
  join public.payroll_runs r on r.id=p.payroll_run_id
  where p.organization_id=p_org and r.period_start=p_period_start and r.period_end=p_period_end and p.status <> 'cancelled';

  if v_irsa > 0 then
    v_due := public.next_month_due_date(p_period_end,15);
    insert into public.tax_obligations(organization_id,obligation_type,period_start,period_end,due_date,amount,paid_amount,status,notes,calculation_key,rule_code,source_summary,calculated_at)
    values(p_org,'IRSA',p_period_start,p_period_end,v_due,v_irsa,0,'open','Montant issu des bulletins de paie validés','AUTO_IRSA_'||v_period_key,'IRSA_MONTHLY','Somme de l''IRSA retenu sur les bulletins de la période',now())
    on conflict (organization_id,calculation_key) where calculation_key is not null
    do update set
      amount=case when public.tax_obligations.paid_amount > 0 or public.tax_obligations.status='paid' then public.tax_obligations.amount else excluded.amount end,
      due_date=case when public.tax_obligations.paid_amount > 0 or public.tax_obligations.status='paid' then public.tax_obligations.due_date else excluded.due_date end,
      notes=excluded.notes,source_summary=excluded.source_summary,calculated_at=excluded.calculated_at,
      status=case when public.tax_obligations.paid_amount >= excluded.amount or public.tax_obligations.status='paid' then 'paid'
                  when public.tax_obligations.paid_amount > 0 then 'partially_paid' else 'open' end;
    v_count := v_count + 1;
  end if;

  if v_cnaps and v_cnaps_amount > 0 then
    v_cnaps_due := public.configured_social_due_date(p_org,'CNAPS',p_period_start,p_period_end);
    if v_cnaps_due is null then
      v_warnings := array_append(v_warnings,'CNaPS: aucune règle de calendrier validée et applicable. Obligation non créée.');
    else
      insert into public.social_obligations(organization_id,organization_name,period_start,period_end,due_date,amount,paid_amount,status,notes,calculation_key,rule_code,source_summary,calculated_at)
      values(p_org,'CNaPS',p_period_start,p_period_end,v_cnaps_due,v_cnaps_amount,0,'open','Cotisations salariales et patronales issues de la paie','AUTO_CNAPS_'||v_period_key,'CNAPS_CALENDAR','Source: bulletins de paie; échéance issue du calendrier validé',now())
      on conflict (organization_id,calculation_key) where calculation_key is not null
      do update set
        amount=case when public.social_obligations.paid_amount > 0 or public.social_obligations.status='paid' then public.social_obligations.amount else excluded.amount end,
        due_date=case when public.social_obligations.paid_amount > 0 or public.social_obligations.status='paid' then public.social_obligations.due_date else excluded.due_date end,
        notes=excluded.notes,source_summary=excluded.source_summary,rule_code=excluded.rule_code,calculated_at=excluded.calculated_at,
        status=case when public.social_obligations.paid_amount >= excluded.amount or public.social_obligations.status='paid' then 'paid'
                    when public.social_obligations.paid_amount > 0 then 'partially_paid' else 'open' end;
      v_count := v_count + 1;
    end if;
  end if;

  if v_ostie and v_ostie_amount > 0 then
    v_ostie_due := public.configured_social_due_date(p_org,'OSTIE',p_period_start,p_period_end);
    if v_ostie_due is null then
      v_warnings := array_append(v_warnings,'OSTIE: aucune règle de calendrier validée et applicable. Obligation non créée.');
    else
      insert into public.social_obligations(organization_id,organization_name,period_start,period_end,due_date,amount,paid_amount,status,notes,calculation_key,rule_code,source_summary,calculated_at)
      values(p_org,'OSTIE',p_period_start,p_period_end,v_ostie_due,v_ostie_amount,0,'open','Cotisations santé issues de la paie','AUTO_OSTIE_'||v_period_key,'OSTIE_CALENDAR','Source: bulletins de paie; échéance issue du calendrier validé',now())
      on conflict (organization_id,calculation_key) where calculation_key is not null
      do update set
        amount=case when public.social_obligations.paid_amount > 0 or public.social_obligations.status='paid' then public.social_obligations.amount else excluded.amount end,
        due_date=case when public.social_obligations.paid_amount > 0 or public.social_obligations.status='paid' then public.social_obligations.due_date else excluded.due_date end,
        notes=excluded.notes,source_summary=excluded.source_summary,rule_code=excluded.rule_code,calculated_at=excluded.calculated_at,
        status=case when public.social_obligations.paid_amount >= excluded.amount or public.social_obligations.status='paid' then 'paid'
                    when public.social_obligations.paid_amount > 0 then 'partially_paid' else 'open' end;
      v_count := v_count + 1;
    end if;
  end if;

  return jsonb_build_object(
    'period_start',p_period_start,'period_end',p_period_end,'obligations_updated',v_count,
    'vat_collected',v_vat_collected,'vat_input_identified',v_vat_input,'vat_due',v_vat_due,
    'irsa',v_irsa,'cnaps',v_cnaps_amount,'ostie',v_ostie_amount,'vat_status',v_vat_status,
    'income_tax_regime',v_regime,'warnings',to_jsonb(v_warnings)
  );
end;
$$;

grant execute on function public.refresh_fiscal_social_obligations(uuid,date,date) to authenticated;
