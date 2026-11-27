BEGIN;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data)
VALUES('10000000-0000-4000-8000-000000000105','authenticated','authenticated','majority-gate-org@magnisa.test',now(),now(),now(),'{"full_name":"Age Gate Test","given_names":"Age","family_name":"Gate"}'::jsonb,'{"provider":"email","providers":["email"]}'::jsonb)
ON CONFLICT(id) DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000105',true);
DO $$
DECLARE v_blocked boolean:=false;
BEGIN
  BEGIN
    PERFORM public.create_organization('Must be blocked','MGA');
  EXCEPTION WHEN SQLSTATE '28000' THEN v_blocked:=true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Direct organization RPC must reject a user without a majority record'; END IF;
END;
$$;
RESET ROLE;
ROLLBACK;
