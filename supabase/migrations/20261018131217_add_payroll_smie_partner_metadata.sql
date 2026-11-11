alter table public.payroll_rule_sets add column if not exists smie_partner_name text, add column if not exists smie_partner_contact text, add column if not exists smie_affiliation_number text, add column if not exists smie_contract_reference text;
alter table public.payroll_rule_sets add constraint payroll_rule_smie_partner_lengths check (
length(coalesce(smie_partner_name,''))<=160 and length(coalesce(smie_partner_contact,''))<=500 and length(coalesce(smie_affiliation_number,''))<=120 and length(coalesce(smie_contract_reference,''))<=200
);