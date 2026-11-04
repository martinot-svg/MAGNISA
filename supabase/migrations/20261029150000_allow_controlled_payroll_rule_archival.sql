-- Permit only the activation RPC to close and archive an already validated payroll rule.
-- All rates, legal fields, IRSA settings and effective start remain immutable.
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
    if tg_op = 'INSERT' or old.status <> 'pending_review' then
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

create or replace function public.activate_payroll_rule(p_org uuid, p_rule uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v public.payroll_rule_sets%rowtype;
  v_role text;
  v_allowed boolean;
  v_next_start date;
  v_target_end date;
begin
  perform public.assert_org_access(p_org);

  select role into v_role
    from public.organization_members
   where organization_id = p_org
     and user_id = auth.uid()
     and status = 'active';

  if v_role is null then
    raise exception 'Membre actif introuvable pour cette organisation';
  end if;

  if v_role = 'owner' then
    v_allowed := true;
  else
    select allowed into v_allowed
      from public.role_permissions
     where organization_id = p_org
       and role = v_role
       and permission_key = 'payroll.manage'
     limit 1;
    if v_allowed is null then
      v_allowed := v_role in ('admin', 'accountant', 'hr');
    end if;
  end if;

  if not coalesce(v_allowed, false) then
    raise exception 'Activation non autorisée : ce compte ne possède pas la permission payroll.manage';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org::text), 1742);

  select * into v
    from public.payroll_rule_sets
   where id = p_rule and organization_id = p_org
   for update;

  if not found then
    raise exception 'Paramètres introuvables pour cette organisation';
  end if;

  if v.status not in ('pending_review', 'draft') then
    if v.status = 'validated' then return; end if;
    raise exception 'Cette version ne peut pas être appliquée depuis son statut actuel';
  end if;

  if nullif(trim(coalesce(v.legal_reference, '')), '') is null
     or v.cnaps_monthly_ceiling is null or v.cnaps_monthly_ceiling <= 0
     or v.health_monthly_ceiling is null or v.health_monthly_ceiling <= 0
     or v.rounding_policy <> 'floor_100'
     or jsonb_typeof(v.irsa_brackets) <> 'array'
     or jsonb_array_length(v.irsa_brackets) = 0
     or v.irsa_minimum is null or v.irsa_minimum < 0 then
    raise exception 'Référentiel incomplet : vérifie les références, plafonds positifs, minimum IRSA, arrondi et barème IRSA';
  end if;

  if v.effective_to is not null and v.effective_to < v.effective_from then
    raise exception 'Période invalide : la date de fin précède la date de début';
  end if;

  select min(b.effective_from) into v_next_start
    from public.payroll_rule_sets b
   where b.organization_id = p_org
     and b.id <> p_rule
     and b.status = 'validated'
     and b.effective_from > v.effective_from
     and (v.effective_to is null or b.effective_from <= v.effective_to);

  v_target_end := v.effective_to;
  if v_next_start is not null and (v_target_end is null or v_target_end >= v_next_start) then
    v_target_end := v_next_start - 1;
    update public.payroll_rule_sets
       set effective_to = v_target_end, updated_at = now()
     where id = p_rule and organization_id = p_org;
    v.effective_to := v_target_end;
  end if;

  perform set_config('app.payroll_rule_activation', 'on', true);

  update public.payroll_rule_sets x
     set effective_to = v.effective_from - 1,
         status = 'archived',
         updated_at = now()
   where x.organization_id = p_org
     and x.id <> p_rule
     and x.status = 'validated'
     and x.effective_from < v.effective_from
     and daterange(x.effective_from, coalesce(x.effective_to, 'infinity'::date), '[]')
         && daterange(v.effective_from, coalesce(v.effective_to, 'infinity'::date), '[]');

  update public.payroll_rule_sets
     set status = 'validated',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         updated_at = now()
   where id = p_rule and organization_id = p_org;
end
$function$;

comment on function public.activate_payroll_rule(uuid, uuid) is
'Explicit activation of a payroll rule. The authorized click validates the selected pending rule, preserves audit history, and archives older overlapping validated rules through a narrowly scoped transaction-local exception.';
