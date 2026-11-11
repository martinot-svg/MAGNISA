create or replace function public.activate_payroll_rule(p_org uuid,p_rule uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.payroll_rule_sets%rowtype; v_role text;
begin
 perform public.assert_org_access(p_org);
 select role into v_role from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='active';
 if v_role not in ('owner','admin') then raise exception 'Activation réservée à un administrateur autorisé'; end if;
 perform pg_advisory_xact_lock(hashtext(p_org::text),1742);
 select * into v from public.payroll_rule_sets where id=p_rule and organization_id=p_org for update;
 if not found then raise exception 'Paramètres introuvables'; end if;
 if v.status<>'pending_review' then raise exception 'Seuls les paramètres à vérifier peuvent être activés'; end if;
 if nullif(trim(coalesce(v.legal_reference,'')),'') is null or v.cnaps_monthly_ceiling is null or v.health_monthly_ceiling is null or v.rounding_policy<>'floor_100' or jsonb_typeof(v.irsa_brackets)<>'array' or jsonb_array_length(v.irsa_brackets)=0 then
 raise exception 'Référentiel incomplet : références, plafonds, arrondis et barème IRSA validés obligatoires';end if;
 if exists(select 1 from public.payroll_rule_sets x where x.organization_id=p_org and x.id<>p_rule and x.status='validated' and daterange(x.effective_from,coalesce(x.effective_to,'infinity'::date),'[]') && daterange(v.effective_from,coalesce(v.effective_to,'infinity'::date),'[]')) then
 raise exception 'Une règle validée couvre déjà cette période';end if;
 update public.payroll_rule_sets set status='validated',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_rule and organization_id=p_org;
end $$;
revoke all on function public.activate_payroll_rule(uuid,uuid) from public;
grant execute on function public.activate_payroll_rule(uuid,uuid) to authenticated;
