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

  if v.status not in ('pending_review', 'draft', 'validated') then
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

  -- If a future validated version overlaps, archive this version's overlap window
  -- only by closing it before the next validated version. Do not overwrite future rules.
  if exists (
    select 1 from public.payroll_rule_sets b
     where b.organization_id = p_org
       and b.id <> p_rule
       and b.status = 'validated'
       and b.effective_from > v.effective_from
       and daterange(b.effective_from, coalesce(b.effective_to, 'infinity'::date), '[]')
           && daterange(v.effective_from, coalesce(v.effective_to, 'infinity'::date), '[]')
  ) then
    update public.payroll_rule_sets x
       set effective_to = (
         select min(y.effective_from) - 1
           from public.payroll_rule_sets y
          where y.organization_id = p_org
            and y.id <> p_rule
            and y.status = 'validated'
            and y.effective_from > v.effective_from
            and daterange(y.effective_from, coalesce(y.effective_to, 'infinity'::date), '[]')
                && daterange(v.effective_from, coalesce(v.effective_to, 'infinity'::date), '[]')
       ),
           status = 'archived',
           updated_at = now()
     where x.organization_id = p_org and x.id = p_rule;
    select * into v from public.payroll_rule_sets where id = p_rule and organization_id = p_org;
  end if;

  -- Clicking "Appliquer cette version" is the user's explicit approval.
  -- Preserve history and archive older validated versions that overlap this period.
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