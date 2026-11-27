BEGIN;
DO $$
DECLARE v_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO auth.users(
      id,aud,role,email,email_confirmed_at,invited_at,created_at,updated_at,
      raw_user_meta_data,raw_app_meta_data
    ) VALUES (
      '10000000-0000-4000-8000-000000000199','authenticated','authenticated',
      'direct-signup-without-majority@magnisa.test',now(),NULL,now(),now(),
      '{"first_name":"Direct","last_name":"Signup"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Direct Auth user creation without a staged majority declaration must be rejected';
  END IF;
END;
$$;
ROLLBACK;
