-- MAGNISA: moteur de profil fiscal/social et génération des obligations calculables.
-- Les règles légales restent versionnées et sourcées. Les obligations non calculables
-- automatiquement sont signalées au lieu d'être inventées.

alter table public.company_settings
  add column if not exists activity_sector text,
  add column if not exists income_tax_regime text check (income_tax_regime is null or income_tax_regime in ('IR','IS','IMPOT_SYNTHETIQUE','AUTRE','A_VERIFIER')),
  add column if not exists vat_status text not null default 'A_VERIFIER' check (vat_status in ('ASSUJETTIE','NON_ASSUJETTIE','A_VERIFIER')),
  add column if not exists vat_rate numeric(7,4) not null default 20 check (vat_rate >= 0 and vat_rate <= 100),
  add column if not exists cnaps_enabled boolean not null default true,
  add column if not exists ostie_enabled boolean not null default false,
  add column if not exists fiscal_profile_confirmed boolean not null default false,
  add column if not exists fiscal_profile_source text,
  add column if not exists fiscal_profile_verified_at timestamptz;

create table if not exists public.fiscal_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  domain text not null check(domain in ('FISCAL','SOCIAL')),
  label text not null,
  version text not null,
  effective_from date not null,
  effective_to date,
  parameters jsonb not null default '{}'::jsonb,
  source_label text not null,
  source_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(code,version)
);

create index if not exists fiscal_rules_active_idx on public.fiscal_rules(domain,active,effective_from);

alter table public.tax_obligations
  add column if not exists calculation_key text,
  add column if not exists rule_code text,
  add column if not exists source_summary text,
  add column if not exists calculated_at timestamptz;

alter table public.social_obligations
  add column if not exists calculation_key text,
  add column if not exists rule_code text,
  add column if not exists source_summary text,
  add column if not exists calculated_at timestamptz;

create unique index if not exists tax_obligations_calculation_key_uidx
  on public.tax_obligations(organization_id,calculation_key)
  where calculation_key is not null;

create unique index if not exists social_obligations_calculation_key_uidx
  on public.social_obligations(organization_id,calculation_key)
  where calculation_key is not null;

insert into public.fiscal_rules(code,domain,label,version,effective_from,parameters,source_label,source_url)
values
('TVA_NORMAL','FISCAL','Taux normal de TVA','2026',date '2026-01-01',jsonb_build_object('rate',20,'periodicity','monthly','due_day_next_month',15),'Code des impôts, article 06.01.12','https://portal.impots.mg/textes/textes/2024-10-18--N----undefined-Ref-DNXHEZ-SSLX6G.pdf'),
('TVA_MONTHLY','FISCAL','Déclaration mensuelle de TVA','2026',date '2026-01-01',jsonb_build_object('due_day_next_month',15),'Code des impôts, article 06.01.16','https://portal.impots.mg/textes/textes/2024-10-18--N----undefined-Ref-DNXHEZ-SSLX6G.pdf'),
('IRSA_MONTHLY','FISCAL','Déclaration mensuelle IRSA','2026',date '2026-01-01',jsonb_build_object('due_day_next_month',15),'DGI, guide des échéances fiscales','https://portal.impots.mg/textes/textes/2015-12-01--N-15-Ref-M561V6-T5AYKZ.pdf'),
('CNAPS_MONTHLY','SOCIAL','Cotisations sociales mensuelles CNaPS','2026',date '2026-01-01',jsonb_build_object('periodicity','monthly'),'CNaPS, obligations employeur','https://www.cnaps.mg/');

create or replace function public.next_month_due_date(p_period_end date, p_day integer default 15)
returns date language sql immutable as $$
  select make_date(extract(year from (p_period_end + interval '1 month'))::int, extract(month from (p_period_end + interval '1 month'))::int, least(p_day, extract(day from (date_trunc('month', p_period_end + interval '2 months') - interval '1 day'))::int));
$$;

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
  v_period_key text := to_char(p_period_start,'YYYYMM') || '_' || to_char(p_period_end,'YYYYMMDD');
  v_count integer := 0;
begin
  perform public.assert_org_access(p_org);

  select vat_status, vat_rate, income_tax_regime, cnaps_enabled, ostie_enabled
    into v_vat_status, v_vat_rate, v_regime, v_cnaps, v_ostie
  from public.company_settings where organization_id=p_org;

  v_vat_status := coalesce(v_vat_status,'A_VERIFIER');
  v_vat_rate := coalesce(v_vat_rate,20);

  if v_vat_status='ASSUJETTIE' then
    select coalesce(sum(i.tax_total),0)
      into v_vat_collected
    from public.invoices i
    where i.organization_id=p_org
      and i.issue_date between p_period_start and p_period_end
      and i.status <> 'cancelled';

    select coalesce(sum(si.tax_total),0)
      into v_vat_input
    from public.supplier_invoices si
    where si.organization_id=p_org
      and si.invoice_date between p_period_start and p_period_end
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
    do update set amount=excluded.amount,due_date=excluded.due_date,notes=excluded.notes,source_summary=excluded.source_summary,rule_code=excluded.rule_code,calculated_at=excluded.calculated_at,status=case when public.tax_obligations.status='paid' then 'paid' else 'open' end;
    v_count := v_count + 1;
  end if;

  select coalesce(sum(p.income_tax),0), coalesce(sum(p.employee_social + p.employer_social),0), coalesce(sum(p.employee_health + p.employer_health),0)
    into v_irsa,v_cnaps_amount,v_ostie_amount
  from public.payslips p
  join public.payroll_runs r on r.id=p.payroll_run_id
  where p.organization_id=p_org and r.period_start=p_period_start and r.period_end=p_period_end
    and p.status <> 'cancelled';

  if v_irsa > 0 then
    v_due := public.next_month_due_date(p_period_end,15);
    insert into public.tax_obligations(organization_id,obligation_type,period_start,period_end,due_date,amount,paid_amount,status,notes,calculation_key,rule_code,source_summary,calculated_at)
    values(p_org,'IRSA',p_period_start,p_period_end,v_due,v_irsa,0,'open','Montant issu des bulletins de paie validés','AUTO_IRSA_'||v_period_key,'IRSA_MONTHLY','Somme de l''IRSA retenu sur les bulletins de la période',now())
    on conflict (organization_id,calculation_key) where calculation_key is not null
    do update set amount=excluded.amount,due_date=excluded.due_date,notes=excluded.notes,source_summary=excluded.source_summary,calculated_at=excluded.calculated_at,status=case when public.tax_obligations.status='paid' then 'paid' else 'open' end;
    v_count := v_count + 1;
  end if;

  if v_cnaps and v_cnaps_amount > 0 then
    v_due := public.next_month_due_date(p_period_end,15);
    insert into public.social_obligations(organization_id,organization_name,period_start,period_end,due_date,amount,paid_amount,status,notes,calculation_key,rule_code,source_summary,calculated_at)
    values(p_org,'CNaPS',p_period_start,p_period_end,v_due,v_cnaps_amount,0,'open','Somme des cotisations sociales salariales et patronales calculées par la paie','AUTO_CNAPS_'||v_period_key,'CNAPS_MONTHLY','Source: bulletins de paie; montant calculé par le moteur de paie',now())
    on conflict (organization_id,calculation_key) where calculation_key is not null
    do update set amount=excluded.amount,due_date=excluded.due_date,notes=excluded.notes,source_summary=excluded.source_summary,calculated_at=excluded.calculated_at,status=case when public.social_obligations.status='paid' then 'paid' else 'open' end;
    v_count := v_count + 1;
  end if;

  if v_ostie and v_ostie_amount > 0 then
    v_due := public.next_month_due_date(p_period_end,15);
    insert into public.social_obligations(organization_id,organization_name,period_start,period_end,due_date,amount,paid_amount,status,notes,calculation_key,rule_code,source_summary,calculated_at)
    values(p_org,'OSTIE',p_period_start,p_period_end,v_due,v_ostie_amount,0,'open','Somme des cotisations santé calculées par la paie','AUTO_OSTIE_'||v_period_key,null,'Source: bulletins de paie; échéance à confirmer selon régime applicable',now())
    on conflict (organization_id,calculation_key) where calculation_key is not null
    do update set amount=excluded.amount,due_date=excluded.due_date,notes=excluded.notes,source_summary=excluded.source_summary,calculated_at=excluded.calculated_at,status=case when public.social_obligations.status='paid' then 'paid' else 'open' end;
    v_count := v_count + 1;
  end if;

  return jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'obligations_updated',v_count,'vat_collected',v_vat_collected,'vat_input_identified',v_vat_input,'vat_due',v_vat_due,'irsa',v_irsa,'cnaps',v_cnaps_amount,'ostie',v_ostie_amount,'vat_status',v_vat_status,'income_tax_regime',v_regime);
end;
$$;

grant execute on function public.refresh_fiscal_social_obligations(uuid,date,date) to authenticated;
