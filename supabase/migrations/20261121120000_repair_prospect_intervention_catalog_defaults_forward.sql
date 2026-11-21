-- Keep the CRM intervention catalogue complete for organizations whose settings
-- predate the seeding trigger. Existing tenant customizations always take precedence.
create or replace function public.list_prospect_intervention_types(p_org uuid)
returns table(intervention_type text,label text,is_active boolean,requires_evidence boolean,sort_order smallint)
language plpgsql
security definer
set search_path = pg_catalog, public
as $types$
begin
  if auth.uid() is null or not (
    public.has_org_permission(p_org,'sales.view')
    or public.has_org_permission(p_org,'commissions.contribute')
    or public.has_org_permission(p_org,'commissions.policy.manage')
    or public.has_org_permission(p_org,'commissions.audit')
  ) then
    raise exception 'Accès au catalogue des interventions refusé.';
  end if;

  return query
  select
    defaults.intervention_type,
    coalesce(settings.label, defaults.label),
    coalesce(settings.is_active, true),
    coalesce(settings.requires_evidence, false),
    defaults.sort_order::smallint
  from (values
    ('recommendation','Recommandation',10),
    ('prospecting','Prospection',20),
    ('contact','Prise de contact',30),
    ('presentation','Présentation',40),
    ('qualification','Qualification',50),
    ('negotiation','Négociation',60),
    ('transfer','Transfert',70),
    ('closing','Conclusion',80),
    ('signature','Signature',90),
    ('follow_up','Suivi',100),
    ('retention','Fidélisation',110)
  ) as defaults(intervention_type,label,sort_order)
  left join public.prospect_intervention_type_settings settings
    on settings.organization_id=p_org
   and settings.intervention_type=defaults.intervention_type
  order by defaults.sort_order;
end;
$types$;

revoke all on function public.list_prospect_intervention_types(uuid) from public,anon;
grant execute on function public.list_prospect_intervention_types(uuid) to authenticated;
