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
    raise exception 'Activation non autorisée pour ce rôle';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org::text), 1742);

  select * into v
    from public.payroll_rule_sets
   where id = p_rule and organization_id = p_org
   for update;

  if not found then
    raise exception 'Paramètres introuvables';
  end if;

  if v.status <> 'pending_review' then
    raise exception 'Seuls les paramètres à vérifier peuvent être activés';
  end if;

  if nullif(trim(coalesce(v.legal_reference, '')), '') is null
     or v.cnaps_monthly_ceiling is null
     or v.health_monthly_ceiling is null
     or v.rounding_policy <> 'floor_100'
     or jsonb_typeof(v.irsa_brackets) <> 'array'
     or jsonb_array_length(v.irsa_brackets) = 0 then
    raise exception 'Référentiel incomplet : références, plafonds, arrondis et barème IRSA validés obligatoires';
  end if;

  if exists (
    select 1 from public.payroll_rule_sets x
     where x.organization_id = p_org
       and x.id <> p_rule
       and x.status = 'validated'
       and x.effective_from >= v.effective_from
       and daterange(x.effective_from, coalesce(x.effective_to, 'infinity'::date), '[]')
           && daterange(v.effective_from, coalesce(v.effective_to, 'infinity'::date), '[]')
  ) then
    raise exception 'Une règle validée commence à la même date ou après cette version et couvre une période commune. Résous ce conflit avant activation.';
  end if;

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
