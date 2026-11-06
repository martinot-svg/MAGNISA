do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.payroll_compute_fmfp_on_insert()'::regprocedure)
  into definition;

  if definition !~* 'new\.employer_fmfp\s*:=\s*round\s*\(\s*new\.gross_pay\s*\*\s*v_rule\.fmfp_employer_rate' then
    raise exception 'FMFP must be calculated on gross_pay without the CNaPS ceiling';
  end if;

  if definition ~* 'new\.employer_fmfp\s*:=\s*round\s*\(\s*least\s*\(\s*new\.gross_pay' then
    raise exception 'FMFP must not reuse the capped CNaPS base';
  end if;
end;
$$;
