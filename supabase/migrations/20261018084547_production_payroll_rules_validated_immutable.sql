create or replace function public.payroll_rule_integrity_guard()
returns trigger language plpgsql set search_path=public as $$
declare b jsonb; prev_cap numeric:=0; cap numeric; rate numeric; found_open boolean:=false;
begin
 if tg_op='UPDATE' and old.status in ('validated','archived') then
   raise exception 'Un référentiel de paie validé ou archivé est immuable : créer une nouvelle version datée';
 end if;
 if new.status='validated' then
  if tg_op='INSERT' or old.status<>'pending_review' then
    raise exception 'Activation autorisée uniquement depuis un référentiel en attente de revue';
  end if;
  if nullif(btrim(coalesce(new.legal_reference,'')),'') is null or new.rounding_policy<>'floor_100'
     or coalesce(new.cnaps_monthly_ceiling,0)<=0 or coalesce(new.health_monthly_ceiling,0)<=0
     or new.irsa_minimum<0 then
    raise exception 'Référentiel réglementaire incomplet : sources, plafonds, minimum et arrondi requis';
  end if;
  if new.cnaps_employee_rate not between 0 and 1 or new.cnaps_employer_rate not between 0 and 1
   or new.health_employee_rate not between 0 and 1 or new.health_employer_rate not between 0 and 1
   or new.fmfp_employer_rate not between 0 and 1 then
    raise exception 'Taux sociaux et FMFP hors des limites autorisées';
  end if;
  if jsonb_typeof(new.irsa_brackets)<>'array' or jsonb_array_length(new.irsa_brackets)=0 then
   raise exception 'Barème IRSA vide ou incorrect';
  end if;
  for b in select value from jsonb_array_elements(new.irsa_brackets) loop
   if found_open or jsonb_typeof(b)<>'object' or not (b ? 'rate') or jsonb_typeof(b->'rate')<>'number' then
    raise exception 'Structure du barème IRSA invalide';
   end if;
   rate=(b->>'rate')::numeric;
   if rate<0 or rate>1 then raise exception 'Taux IRSA invalide';end if;
   if b->>'up_to' is null then
    found_open=true;
   else
    if jsonb_typeof(b->'up_to')<>'number' then raise exception 'Borne IRSA invalide';end if;
    cap=(b->>'up_to')::numeric;
    if cap<=prev_cap then raise exception 'Tranches IRSA non croissantes';end if;
    prev_cap=cap;
   end if;
  end loop;
  if not found_open then raise exception 'Barème IRSA incomplet : tranche supérieure ouverte manquante';end if;
 end if;
 return new;
end $$;
drop trigger if exists trg_payroll_rule_integrity_guard on public.payroll_rule_sets;
create trigger trg_payroll_rule_integrity_guard before insert or update on public.payroll_rule_sets for each row execute function public.payroll_rule_integrity_guard();