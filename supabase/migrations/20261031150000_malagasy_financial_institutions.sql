-- Central reference directory for Malagasy lenders used by the loan module.
create table if not exists public.financial_institutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  category text not null check (category in ('bank','microfinance','financial_institution','individual_company','other')),
  legal_name text,
  display_name text not null check (length(btrim(display_name)) between 2 and 160),
  country_code text not null default 'MG' check (country_code ~ '^[A-Z]{2}$'),
  is_active boolean not null default true,
  verification_status text not null default 'reference'
    check (verification_status in ('verified','reference','user_added','needs_review')),
  source_name text,
  source_url text,
  source_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists financial_institutions_global_unique
  on public.financial_institutions(category, country_code, lower(display_name))
  where organization_id is null;
create unique index if not exists financial_institutions_org_unique
  on public.financial_institutions(organization_id, category, country_code, lower(display_name))
  where organization_id is not null;
create index if not exists financial_institutions_category_idx
  on public.financial_institutions(country_code, category, is_active, display_name);

alter table public.loans
  add column if not exists lender_category text,
  add column if not exists financial_institution_id uuid references public.financial_institutions(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='loans_lender_category_check' and conrelid='public.loans'::regclass) then
    alter table public.loans add constraint loans_lender_category_check
      check (lender_category is null or lender_category in ('bank','microfinance','financial_institution','individual_company','other'));
  end if;
end $$;

alter table public.financial_institutions enable row level security;
drop policy if exists financial_institutions_read on public.financial_institutions;
create policy financial_institutions_read on public.financial_institutions
  for select to authenticated
  using (organization_id is null or public.has_org_permission(organization_id, 'finance.view'));
drop policy if exists financial_institutions_insert on public.financial_institutions;
create policy financial_institutions_insert on public.financial_institutions
  for insert to authenticated
  with check (organization_id is not null and public.has_org_permission(organization_id, 'treasury.transfer'));
drop policy if exists financial_institutions_update on public.financial_institutions;
create policy financial_institutions_update on public.financial_institutions
  for update to authenticated
  using (organization_id is not null and public.has_org_permission(organization_id, 'treasury.transfer'))
  with check (organization_id is not null and public.has_org_permission(organization_id, 'treasury.transfer'));

revoke all on public.financial_institutions from anon, authenticated;
grant select, insert, update on public.financial_institutions to authenticated;

insert into public.financial_institutions
  (organization_id, category, legal_name, display_name, country_code, verification_status, source_name, source_url, source_note)
values
  (null,'bank','Banque Malgache de l''Océan Indien','BMOI','MG','reference','Banky Foiben''i Madagasikara / référentiel bancaire','https://www.banky-foibe.mg/','Liste initiale à recouper avec la dernière liste nominative CSBF.'),
  (null,'bank','BNI Madagascar','BNI Madagascar','MG','reference','Banky Foiben''i Madagasikara / référentiel bancaire','https://www.banky-foibe.mg/','Liste initiale à recouper avec la dernière liste nominative CSBF.'),
  (null,'bank','The Mauritius Commercial Bank (Madagascar) SA','MCB Madagascar','MG','reference','Banky Foiben''i Madagasikara / référentiel bancaire','https://www.banky-foibe.mg/','Liste initiale à recouper avec la dernière liste nominative CSBF.'),
  (null,'bank','Banque SBM Madagascar','SBM Madagascar','MG','reference','Banky Foiben''i Madagasikara / référentiel bancaire','https://www.banky-foibe.mg/','Liste initiale à recouper avec la dernière liste nominative CSBF.'),
  (null,'bank','BRED Madagasikara Banque Populaire','BRED Madagasikara','MG','reference','Référentiel bancaire malgache','https://www.banky-foibe.mg/','Dénomination commerciale à confirmer sur le contrat et la liste CSBF courante.'),
  (null,'bank','Bank of Africa Madagascar','BOA Madagascar','MG','reference','Banky Foiben''i Madagasikara / référentiel bancaire','https://www.banky-foibe.mg/','Liste initiale à recouper avec la dernière liste nominative CSBF.'),
  (null,'bank','AccèsBanque Madagascar','AccèsBanque Madagascar','MG','reference','Banky Foiben''i Madagasikara / référentiel bancaire','https://www.banky-foibe.mg/','Liste initiale à recouper avec la dernière liste nominative CSBF.'),
  (null,'bank','BGFIBank Madagascar','BGFIBank Madagascar','MG','reference','Banky Foiben''i Madagasikara / référentiel bancaire','https://www.banky-foibe.mg/','Liste initiale à recouper avec la dernière liste nominative CSBF.'),
  (null,'bank','Baobab Banque Madagascar','Baobab Banque Madagascar','MG','reference','Référentiel bancaire malgache','https://www.banky-foibe.mg/','Dénomination commerciale à confirmer sur le contrat et la liste CSBF courante.'),
  (null,'bank','Banky First','Banky First','MG','reference','Référentiel bancaire malgache','https://www.banky-foibe.mg/','Dénomination commerciale à confirmer sur le contrat et la liste CSBF courante.'),
  (null,'bank','SIPEM Banque','SIPEM Banque','MG','reference','Référentiel bancaire malgache','https://www.banky-foibe.mg/','Dénomination commerciale à confirmer sur le contrat et la liste CSBF courante.'),
  (null,'bank','MVola Banque','MVola Banque','MG','reference','Référentiel bancaire malgache','https://www.banky-foibe.mg/','Dénomination commerciale à confirmer sur le contrat et la liste CSBF courante.'),
  (null,'bank','AFG Bank Madagascar','AFG Bank Madagascar','MG','reference','Référentiel bancaire malgache','https://www.banky-foibe.mg/','Dénomination commerciale à confirmer sur le contrat et la liste CSBF courante.'),
  (null,'microfinance','ACEP Madagascar','ACEP Madagascar','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','APEM PAIQ-SA','APEM PAIQ','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','Avotra MG','Avotra MG','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','Caisse d''Epargne et de Crédit Agricole Mutuels','CECAM','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','Caisse d''Epargne de Madagascar','Caisse d''Epargne de Madagascar (CEM)','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; vérifier la catégorie réglementaire exacte pour chaque produit.'),
  (null,'microfinance','Centrale Crédit','Centrale Crédit','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','MADACREDITO','MADACREDITO','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','NIM SA','NIM','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','OTIV ZAM','OTIV ZAM','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','OTIV DIANA','OTIV DIANA','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','OTIV SAVA','OTIV SAVA','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','OTIV Toamasina Zone Littorale','OTIV Toamasina','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','Première Agence de Microfinance','PAMF','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','PAOSITRA Finances','PAOSITRA Finances','MG','reference','APIMF / site officiel','https://www.paositrafinances.mg/mentions-legales/','Dénomination officielle déclarée par l''institution ; agrément CSBF publié.'),
  (null,'microfinance','Société Malagasy Mutualiste d''Epargne et de Crédit','SMMEC','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','VAHATRA SA','Vahatra','MG','reference','APIMF Madagascar','https://apimfmada.mg/les-institutions-membres/','Membre APIMF ; agrément CSBF à contrôler lors de la mise à jour réglementaire.'),
  (null,'microfinance','Vola Mahasoa','Vola Mahasoa','MG','reference','APIMF Madagascar / points de services régionaux','https://apimfmada.mg/point-de-services-par-region/','Présent dans le répertoire des points de services APIMF ; statut d''adhésion et agrément à revalider.')
on conflict do nothing;

-- The existing contract RPC remains unchanged. This wrapper adds the lender
-- reference in the same transaction and preserves the existing loan workflow.
create or replace function public.create_loan_with_schedule_and_lender(
  p_organization_id uuid,
  p_lender_name text,
  p_lender_category text,
  p_financial_institution_id uuid,
  p_register_new_lender boolean,
  p_principal numeric,
  p_interest_rate numeric,
  p_start_date date,
  p_end_date date,
  p_notes text,
  p_contract_reference text,
  p_repayment_method text,
  p_payment_frequency integer,
  p_total_installments integer,
  p_first_due_date date,
  p_liability_account_code text,
  p_fee_account_code text,
  p_penalty_account_code text,
  p_repayment_allocation_order text,
  p_request_key uuid,
  p_installments jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_loan_id uuid;
  v_institution_id uuid;
  v_display_name text;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'finance.view');
  perform public.assert_org_permission(p_organization_id, 'treasury.transfer');

  if p_lender_category not in ('bank','microfinance','financial_institution','individual_company','other') then
    raise exception 'Catégorie de prêteur invalide';
  end if;
  if length(btrim(coalesce(p_lender_name,''))) < 2 or length(btrim(p_lender_name)) > 160 then
    raise exception 'Nom du prêteur invalide';
  end if;

  if coalesce(p_register_new_lender,false) then
    if p_financial_institution_id is not null then
      raise exception 'Référence de prêteur incohérente';
    end if;
    insert into public.financial_institutions(
      organization_id, category, legal_name, display_name, country_code,
      verification_status, source_name, source_note
    ) values (
      p_organization_id, p_lender_category, btrim(p_lender_name), btrim(p_lender_name), 'MG',
      'user_added', 'Ajout par un utilisateur MAGNISA', 'Référentiel propre à l''organisation ; vérifier les documents du prêteur.'
    )
    on conflict (organization_id, category, country_code, lower(display_name))
      where organization_id is not null
    do update set is_active=true, updated_at=now()
    returning id into v_institution_id;
  else
    if p_financial_institution_id is null then
      raise exception 'Sélectionne un prêteur dans la liste ou ajoute-le';
    end if;
    select id, display_name into v_institution_id, v_display_name
    from public.financial_institutions
    where id=p_financial_institution_id
      and is_active=true
      and category=p_lender_category
      and country_code='MG'
      and (organization_id is null or organization_id=p_organization_id);
    if v_institution_id is null or v_display_name <> btrim(p_lender_name) then
      raise exception 'Le prêteur sélectionné est invalide ou indisponible';
    end if;
  end if;

  v_loan_id := public.create_loan_with_schedule(
    p_organization_id, btrim(p_lender_name), p_principal, p_interest_rate,
    p_start_date, p_end_date, p_notes, p_contract_reference, p_repayment_method,
    p_payment_frequency, p_total_installments, p_first_due_date,
    p_liability_account_code, p_fee_account_code, p_penalty_account_code,
    p_repayment_allocation_order, p_request_key, p_installments
  );

  update public.loans
  set lender_category=p_lender_category, financial_institution_id=v_institution_id
  where id=v_loan_id and organization_id=p_organization_id;

  return v_loan_id;
end;
$function$;

revoke all on function public.create_loan_with_schedule_and_lender(uuid,text,text,uuid,boolean,numeric,numeric,date,date,text,text,text,integer,integer,date,text,text,text,text,uuid,jsonb) from public, anon;
grant execute on function public.create_loan_with_schedule_and_lender(uuid,text,text,uuid,boolean,numeric,numeric,date,date,text,text,text,integer,integer,date,text,text,text,text,uuid,jsonb) to authenticated;
