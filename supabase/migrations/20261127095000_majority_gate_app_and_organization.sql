-- D-01: enforce private majority record on protected app access and organization creation.
create or replace function public.has_magnisa_signup_age_check()
returns boolean language sql stable security definer set search_path=''
as $magnisa$
  select auth.uid() is not null and exists (
    select 1 from private.magnisa_signup_age_checks a where a.user_id=auth.uid()
  );
$magnisa$;
revoke all on function public.has_magnisa_signup_age_check() from public,anon;
grant execute on function public.has_magnisa_signup_age_check() to authenticated;

-- Organization creation is a server-side boundary; do not rely on the onboarding UI.
create or replace function public.create_organization(p_name text,p_currency text default 'MGA')
returns uuid language plpgsql security definer set search_path=public as $magnisa$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise' using errcode='28000'; end if;
  if not exists(select 1 from private.magnisa_signup_age_checks where user_id=auth.uid()) then
    raise exception 'Enregistre ta date de naissance et confirme ta majorité avant de créer une organisation'
      using errcode='28000';
  end if;
  if length(trim(p_name)) < 2 then raise exception 'Nom d''entreprise invalide'; end if;
  insert into public.organizations(name,currency) values(trim(p_name),upper(trim(p_currency))) returning id into v_org;
  insert into public.organization_members(organization_id,user_id,role,status) values(v_org,auth.uid(),'owner','active');
  insert into public.company_settings(organization_id,legal_name) values(v_org,trim(p_name));
  insert into public.number_sequences(organization_id,document_type,prefix,next_value,padding) values
    (v_org,'quote','DEV-',1,5),(v_org,'invoice','FAC-',1,5),(v_org,'payment','PAY-',1,5),(v_org,'expense','DEP-',1,5);
  perform public.audit_event(v_org,'organization.created','organization',v_org,null,jsonb_build_object('name',p_name,'currency',p_currency));
  return v_org;
end;
$magnisa$;
