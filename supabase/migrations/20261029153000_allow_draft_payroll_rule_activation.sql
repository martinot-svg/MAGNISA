-- Keep future payroll rule activation consistent for both draft and pending-review versions.
-- All activation still passes through activate_payroll_rule and its permission/date/legal checks.
create or replace function public.payroll_rule_integrity_guard()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  b jsonb;
  prev_cap numeric := 0;
  cap numeric;
  rate numeric;
  found_open boolean := false;
  v_activation boolean := coalesce(current_setting('app.payroll_rule_activation', true), '') = 'on';
begin
  if tg_op = 'UPDATE' and old.status in ('validated', 'archived') then
    if not (
      v_activation
      and old.status = 'validated'
      and new.status = 'archived'
      and new.id is not distinct from old.id
      and new.organization_id is not distinct from old.organization_id
      and new.name is not distinct from old.name
      and new.effective_from is not distinct from old.effective_from
      and new.cnaps_employee_rate is not distinct from old.cnaps_employee_rate
      and new.cnaps_employer_rate is not distinct from old.cnaps_employer_rate
      and new.health_employee_rate is not distinct from old.health_employee_rate
      and new.health_employer_rate is not distinct from old.health_employer_rate
      and new.fmfp_employer_rate is not distinct from old.fmfp_employer_rate
      and new.cnaps_monthly_ceiling is not distinct from old.cnaps_monthly_ceiling
      and new.health_monthly_ceiling is not distinct from old.health_monthly_ceiling
      and new.irsa_brackets is not distinct from old.irsa_brackets
      and new.irsa_minimum is not distinct from old.irsa_minimum
      and new.rounding_policy is not distinct from old.rounding_policy
      and new.legal_reference is not distinct from old.legal_reference
      and new.smie_partner_name is not distinct from old.smie_partner_name
      and new.smie_partner_contact is not distinct from old.smie_partner_contact
      and new.smie_affiliation_number is not distinct from old.smie_affiliation_number
      and new.smie_contract_reference is not distinct from old.smie_contract_reference
      and new.effective_to is not null
      and new.effective_to >= old.effective_from
    ) then
      raise exception 'Un référentiel de paie validé ou archivé est immuable : créer une nouvelle version datée';
    end if;
  end if;

  if new.status = 'validated' then
    if tg_op = 'INSERT' or old.status not in ('pending_review', 'draft') or not v_activation then
      raise exception 'Activation autorisée uniquement depuis un référentiel en attente de revue';
    end if;
    if nullif(btrim(coalesce(new.legal_reference, '')), '') is null
       or new.rounding_policy <> 'floor_100'
       or coalesce(new.cnaps_monthly_ceiling, 0) <= 0
       or coalesce(new.health_monthly_ceiling, 0) <= 0
       or new.irsa_minimum is null or new.irsa_minimum < 0 then
      raise exception 'Référentiel réglementaire incomplet : sources, plafonds, minimum et arrondi requis';
    end if;
    if new.cnaps_employee_rate not between 0 and 1
       or new.cnaps_employer_rate not between 0 and 1
       or new.health_employee_rate not between 0 and 1
       or new.health_employer_rate not between 0 and 1
       or new.fmfp_employer_rate not between 0 and 1 then
      raise exception 'Taux sociaux et FMFP hors des limites autorisées';
    end if;
    if jsonb_typeof(new.irsa_brackets) <> 'array' or jsonb_array_length(new.irsa_brackets) = 0 then
      raise exception 'Barème IRSA vide ou incorrect';
    end if;
    for b in select value from jsonb_array_elements(new.irsa_brackets) loop
      if found_open or jsonb_typeof(b) <> 'object' or not (b ? 'rate') or jsonb_typeof(b->'rate') <> 'number' then
        raise exception 'Structure du barème IRSA invalide';
      end if;
      rate := (b->>'rate')::numeric;
      if rate < 0 or rate > 1 then raise exception 'Taux IRSA invalide'; end if;
      if b->>'up_to' is null then
        found_open := true;
      else
        if jsonb_typeof(b->'up_to') <> 'number' then raise exception 'Borne IRSA invalide'; end if;
        cap := (b->>'up_to')::numeric;
        if cap <= prev_cap then raise exception 'Tranches IRSA non croissantes'; end if;
        prev_cap := cap;
      end if;
    end loop;
    if not found_open then raise exception 'Barème IRSA incomplet : tranche supérieure ouverte manquante'; end if;
  end if;
  return new;
end
$function$;
