DO $$
DECLARE
  v_constraint text;
  v_list_function text;
  v_response_function text;
  v_select_policy text;
  v_update_policy text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO v_constraint
  FROM pg_constraint AS c
  WHERE c.conrelid = 'public.organization_members'::regclass
    AND c.conname = 'organization_members_status_check';

  IF v_constraint IS NULL OR position('declined' IN v_constraint) = 0 THEN
    RAISE EXCEPTION 'organization_members must support the declined state';
  END IF;

  SELECT pg_get_functiondef('public.get_my_organization_invitations()'::regprocedure)
    INTO v_list_function;
  IF position('auth.uid()' IN v_list_function) = 0
     OR position('status = ''invited''' IN v_list_function) = 0 THEN
    RAISE EXCEPTION 'Invitation listing must be restricted to the signed-in user pending invitations';
  END IF;

  SELECT pg_get_functiondef('public.respond_to_organization_invitation(uuid,boolean)'::regprocedure)
    INTO v_response_function;
  IF position('auth.uid()' IN v_response_function) = 0
     OR position('email_confirmed_at' IN v_response_function) = 0
     OR position('status = ''invited''' IN v_response_function) = 0
     OR position('declined' IN v_response_function) = 0 THEN
    RAISE EXCEPTION 'Invitation response must verify ownership, email confirmation and pending state';
  END IF;

  SELECT qual INTO v_select_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'notifications'
    AND policyname = 'notifications_select_own';

  SELECT qual INTO v_update_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'notifications'
    AND policyname = 'notifications_update_own';

  IF v_select_policy IS NULL OR position('invited' IN v_select_policy) = 0 THEN
    RAISE EXCEPTION 'Pending invite recipients must be able to read their own invitation notification';
  END IF;
  IF v_update_policy IS NULL OR position('invited' IN v_update_policy) = 0 THEN
    RAISE EXCEPTION 'Pending invite recipients must be able to update only their own invitation notification';
  END IF;

  IF has_function_privilege('anon', 'public.get_my_organization_invitations()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.respond_to_organization_invitation(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users must not execute invitation RPCs';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_my_organization_invitations()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.respond_to_organization_invitation(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated users must be able to execute invitation RPCs';
  END IF;
END;
$$;
