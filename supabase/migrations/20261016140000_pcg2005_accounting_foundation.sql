-- MAGNISA TEST ONLY: rapprochement des ecritures avec le PCG 2005 (Madagascar).
-- Catalogue normatif (pas de donnees commerciales simulees).
create table if not exists public.pcg2005_accounts (
  code text primary key check (code ~ '^[1-7][0-9]{0,5}$'),
  label text not null,
  kind text not null check (kind in ('asset','liability','equity','expense','income','clearing')),
  source text not null default 'PCG 2005 Madagascar',
  created_at timestamptz not null default now()
);
revoke all on public.pcg2005_accounts from anon, authenticated;
grant select on public.pcg2005_accounts to authenticated;
alter table public.pcg2005_accounts enable row level security;
drop policy if exists pcg_catalog_read on public.pcg2005_accounts;
create policy pcg_catalog_read on public.pcg2005_accounts for select to authenticated using (true);

insert into public.pcg2005_accounts(code,label,kind) values
 ('101','Capital social','equity'),
 ('164','Emprunts auprès des établissements de crédit','liability'),
 ('201','Frais de développement','asset'),
 ('218','Autres immobilisations corporelles','asset'),
 ('281','Amortissements des immobilisations corporelles','asset'),
 ('345','Prestations de service en cours','asset'),
 ('401','Fournisseurs de biens et services','liability'),
 ('411','Clients','asset'),
 ('413','Clients effets à recevoir','asset'),
 ('419','Clients créditeurs','liability'),
 ('421','Personnel, rémunérations dues','liability'),
 ('425','Personnel, avances et acomptes accordés','asset'),
 ('431','Organismes sociaux','liability'),
 ('444','État, impôts sur les résultats','liability'),
 ('445','État, taxes sur le chiffre d''affaires','liability'),
 ('455','Associés, comptes courants','liability'),
 ('512','Banques comptes courants','asset'),
 ('511','Valeurs à l''encaissement','asset'),
 ('517','Autres organismes financiers','asset'),
 ('519','Concours bancaires courants','liability'),
 ('53','Caisse','asset'),
 ('581','Virements de fonds','clearing'),
 ('604','Achats d''études et de prestations de service','expense'),
 ('611','Sous-traitance générale','expense'),
 ('613','Locations','expense'),
 ('615','Entretien, réparations et maintenance','expense'),
 ('616','Primes d''assurances','expense'),
 ('618','Documentation et divers','expense'),
 ('622','Rémunérations d''intermédiaires et honoraires','expense'),
 ('623','Publicité, publication, relations publiques','expense'),
 ('625','Déplacements, missions et réceptions','expense'),
 ('626','Frais postaux et de télécommunications','expense'),
 ('627','Services bancaires et assimilés','expense'),
 ('635','Autres impôts et taxes','expense'),
 ('641','Rémunérations du personnel','expense'),
 ('645','Cotisations aux organismes sociaux','expense'),
 ('651','Redevances pour logiciels et licences','expense'),
 ('658','Autres charges de gestion courante','expense'),
 ('661','Charges d''intérêts','expense'),
 ('681','Dotations aux amortissements (actifs non courants)','expense'),
 ('695','Impôts sur les bénéfices','expense'),
 ('704','Vente de travaux','income'),
 ('705','Vente d''études','income'),
 ('706','Vente de prestations de service','income'),
 ('708','Produits des activités annexes','income'),
 ('709','Rabais, remises et ristournes accordés','income')
on conflict (code) do update set label=excluded.label,kind=excluded.kind;

create table if not exists public.pcg2005_account_mappings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legacy_account_key text not null,
  pcg_code text not null references public.pcg2005_accounts(code),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key(organization_id,legacy_account_key),
  check(length(trim(legacy_account_key))>0)
);
alter table public.pcg2005_account_mappings enable row level security;
revoke all on public.pcg2005_account_mappings from anon,authenticated;
grant select,insert,update,delete on public.pcg2005_account_mappings to authenticated;
drop policy if exists pcg_mapping_read on public.pcg2005_account_mappings;
create policy pcg_mapping_read on public.pcg2005_account_mappings for select to authenticated
 using (public.has_org_permission(organization_id,'accounting.view'));
drop policy if exists pcg_mapping_insert on public.pcg2005_account_mappings;
create policy pcg_mapping_insert on public.pcg2005_account_mappings for insert to authenticated
 with check (public.has_org_permission(organization_id,'accounting.manage') and updated_by=auth.uid());
drop policy if exists pcg_mapping_update on public.pcg2005_account_mappings;
create policy pcg_mapping_update on public.pcg2005_account_mappings for update to authenticated
 using (public.has_org_permission(organization_id,'accounting.manage'))
 with check (public.has_org_permission(organization_id,'accounting.manage') and updated_by=auth.uid());
drop policy if exists pcg_mapping_delete on public.pcg2005_account_mappings;
create policy pcg_mapping_delete on public.pcg2005_account_mappings for delete to authenticated
 using (public.has_org_permission(organization_id,'accounting.manage'));

create or replace view public.pcg2005_journal_lines
with (security_invoker=true) as
select
  jl.organization_id, je.id as journal_entry_id, je.entry_date,
  je.reference, je.status, je.source_type, jl.id as line_id, jl.account_key, jl.account_label,
  jl.debit, jl.credit, jl.customer_id, jl.financial_account_id,
  coalesce(m.pcg_code,
    case
      when jl.account_key='AR' then '411'
      when jl.account_key='AP' then '401'
      when jl.account_key='SALES_REVENUE' then '706'
      when jl.account_key like 'TAX_PAYABLE%' then '445'
      when jl.account_key='PAYROLL_PAYABLE' then '421'
      when jl.account_key='EMPLOYEE_ADVANCE_RECEIVABLE' then '425'
      when jl.account_key='SOCIAL_PAYABLE' then '431'
      when jl.account_key='HEALTH_PAYABLE' then '431'
      when jl.account_key='OTHER_PAYROLL_PAYABLE' then '421'
      when jl.account_key like 'PAYROLL_EXPENSE:%' then '641'
      when jl.account_key like 'TREASURY:%' and fa.type='bank' then '512'
      when jl.account_key like 'TREASURY:%' and fa.type='cash' then '53'
      when jl.account_key like 'TREASURY:%' and fa.type='mobile_money' then '517'
      when jl.account_key like 'TREASURY:%' and fa.type='cheque_clearing' then '511'
      else null
    end
  ) as pcg_code,
  case when m.pcg_code is not null then 'manuel'
       when jl.account_key in ('AR','AP','SALES_REVENUE','PAYROLL_PAYABLE','EMPLOYEE_ADVANCE_RECEIVABLE','SOCIAL_PAYABLE','HEALTH_PAYABLE','OTHER_PAYROLL_PAYABLE')
        or jl.account_key like 'TAX_PAYABLE%' or jl.account_key like 'PAYROLL_EXPENSE:%'
        or (jl.account_key like 'TREASURY:%' and fa.type is not null)
        then 'automatique'
       else 'a_mapper'
  end as mapping_status
from public.journal_entry_lines jl
join public.journal_entries je on je.id=jl.journal_entry_id and je.organization_id=jl.organization_id
left join public.financial_accounts fa on fa.id=jl.financial_account_id and fa.organization_id=jl.organization_id
left join public.pcg2005_account_mappings m
 on m.organization_id=jl.organization_id and m.legacy_account_key=jl.account_key;
revoke all on public.pcg2005_journal_lines from anon;
grant select on public.pcg2005_journal_lines to authenticated;

create or replace view public.pcg2005_trial_balance
with (security_invoker=true) as
select organization_id, coalesce(pcg_code,'NON_CLASSE') as pcg_code,
 account_key, max(account_label) as account_label, mapping_status,
 sum(debit)::numeric(20,2) as total_debit,
 sum(credit)::numeric(20,2) as total_credit,
 sum(debit-credit)::numeric(20,2) as net_debit
from public.pcg2005_journal_lines
group by organization_id,pcg_code,account_key,mapping_status;
revoke all on public.pcg2005_trial_balance from anon;
grant select on public.pcg2005_trial_balance to authenticated;

create or replace view public.pcg2005_journal_integrity
with (security_invoker=true) as
select je.organization_id,je.id,je.entry_date,je.reference,je.status,
 je.total_debit as header_debit,je.total_credit as header_credit,
 coalesce(sum(jl.debit),0)::numeric(20,2) as lines_debit,
 coalesce(sum(jl.credit),0)::numeric(20,2) as lines_credit,
 case when je.total_debit=je.total_credit
   and je.total_debit=coalesce(sum(jl.debit),0)
   and je.total_credit=coalesce(sum(jl.credit),0)
   and count(jl.id)>0 then 'equilibree'
 else 'anomalie' end as integrity_status
from public.journal_entries je
left join public.journal_entry_lines jl on jl.journal_entry_id=je.id and jl.organization_id=je.organization_id
group by je.organization_id,je.id,je.entry_date,je.reference,je.status,je.total_debit,je.total_credit;
revoke all on public.pcg2005_journal_integrity from anon;
grant select on public.pcg2005_journal_integrity to authenticated;

-- Les roles de l'application ne doivent pas pouvoir TRUNCATE les tables financieres.
revoke truncate,trigger,references on
 public.customers,public.services,public.quotes,public.quote_lines,
 public.orders,public.order_lines,public.invoices,public.invoice_lines,
 public.payments,public.expenses,public.financial_accounts,public.financial_transactions,
 public.journal_entries,public.journal_entry_lines,
 public.supplier_invoices,public.supplier_payments,public.partner_accounts,
 public.partner_account_movements,public.payroll_runs,public.payslips,
 public.payroll_payments,public.loans,public.budgets,public.fixed_assets,
 public.tax_obligations,public.social_obligations,public.audit_logs
from anon,authenticated;
