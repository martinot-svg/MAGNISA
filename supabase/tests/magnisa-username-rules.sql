-- Runtime contract for MAGNISA username assignment. Run after a clean migration replay.
begin;

do $username_test$
declare
  v_first_id uuid := gen_random_uuid();
  v_duplicate_id uuid := gen_random_uuid();
  v_fallback_id uuid := gen_random_uuid();
  v_handle text;
  v_actual text;
  v_collision_rejected boolean := false;
begin
  -- The auth.users trigger consumes a staged majority declaration atomically.
  INSERT INTO private.magnisa_signup_age_pending(email,birth_date,majority_confirmed_at,expires_at)
  VALUES
    ('magnisa-username-' || v_first_id::text || '@example.invalid', DATE '1990-01-01', now(), now() + interval '15 minutes'),
    ('magnisa-username-' || v_duplicate_id::text || '@example.invalid', DATE '1990-01-01', now(), now() + interval '15 minutes'),
    ('magnisa-username-' || v_fallback_id::text || '@example.invalid', DATE '1990-01-01', now(), now() + interval '15 minutes');

  -- Build a deterministic-format, per-run unique 10-letter test handle.
  v_handle := 'm' || translate(
    substr(replace(v_first_id::text,'-',''),1,9),
    '0123456789','abcdefghij'
  );

  insert into auth.users (
    id, aud, role, email, encrypted_password, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) values (
    v_first_id, 'authenticated', 'authenticated',
    'magnisa-username-' || v_first_id::text || '@example.invalid',
    '', '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name','Test Username',
      'given_names','Test',
      'family_name','Username',
      'username',v_handle
    ),
    now(), now()
  );

  select username into v_actual from public.profiles where id=v_first_id;
  if v_actual is distinct from v_handle then
    raise exception 'Selected username was not preserved: expected %, got %',v_handle,v_actual;
  end if;

  begin
    insert into auth.users (
      id, aud, role, email, encrypted_password, raw_app_meta_data,
      raw_user_meta_data, created_at, updated_at
    ) values (
      v_duplicate_id, 'authenticated', 'authenticated',
      'magnisa-username-' || v_duplicate_id::text || '@example.invalid',
      '', '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'full_name','Duplicate Username',
        'given_names','Duplicate',
        'family_name','Username',
        'username',v_handle
      ),
      now(), now()
    );
  exception when unique_violation then
    v_collision_rejected := true;
  end;

  if not v_collision_rejected then
    raise exception 'Duplicate selected username was not rejected';
  end if;

  insert into auth.users (
    id, aud, role, email, encrypted_password, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) values (
    v_fallback_id, 'authenticated', 'authenticated',
    'magnisa-username-' || v_fallback_id::text || '@example.invalid',
    '', '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name','Alpha Beta',
      'given_names','Alpha',
      'family_name','Beta',
      'username','invalid.handle'
    ),
    now(), now()
  );

  select username into v_actual from public.profiles where id=v_fallback_id;
  if v_actual is null or v_actual !~ '^[a-z]{3,10}$' then
    raise exception 'Fallback username does not satisfy 3-10 lowercase letters: %',v_actual;
  end if;

  v_actual := private.magnisa_generate_username('A','B');
  if v_actual is null or v_actual !~ '^[a-z]{3,10}$' then
    raise exception 'Short-name generation does not satisfy 3-10 lowercase letters: %',v_actual;
  end if;
end;
$username_test$;

rollback;
