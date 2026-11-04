-- Prevent fiscal/social obligation generation until the organization confirms its fiscal profile.
-- Preserve the existing calculation implementation as a private internal routine.
alter function public.refresh_fiscal_social_obligations(uuid, date, date)
  rename to refresh_fiscal_social_obligations_unchecked;

revoke all on function public.refresh_fiscal_social_obligations_unchecked(uuid, date, date)
  from public, anon, authenticated;

create or replace function public.refresh_fiscal_social_obligations(
  p_org uuid,
  p_period_start date,
  p_period_end date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirmed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  if p_org is null or p_period_start is null or p_period_end is null
     or p_period_end < p_period_start then
    raise exception 'Période ou organisation invalide';
  end if;

  perform public.assert_org_access(p_org);

  select coalesce(cs.fiscal_profile_confirmed, false)
    into v_confirmed
  from public.company_settings cs
  where cs.organization_id = p_org;

  if not coalesce(v_confirmed, false) then
    return jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'obligations_updated', 0,
      'vat_collected', 0,
      'vat_input_identified', 0,
      'vat_due', 0,
      'irsa', 0,
      'cnaps', 0,
      'ostie', 0,
      'warnings', jsonb_build_array(
        'Génération bloquée : le profil fiscal de l’organisation doit être confirmé.'
      ),
      'generation_blocked', true,
      'writes_performed', false
    );
  end if;

  return public.refresh_fiscal_social_obligations_unchecked(
    p_org, p_period_start, p_period_end
  );
end;
$$;

revoke all on function public.refresh_fiscal_social_obligations(uuid, date, date)
  from public, anon;
grant execute on function public.refresh_fiscal_social_obligations(uuid, date, date)
  to authenticated;

comment on function public.refresh_fiscal_social_obligations(uuid, date, date) is
  'Generates configured fiscal and social obligations only after the organization confirms its fiscal profile. The underlying calculation routine is not directly executable by API roles.';
