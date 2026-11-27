BEGIN;

-- Deterministic fixtures are rolled back at the end of this test.
-- Stage completed-signup fixtures before the auth.users trigger runs.
INSERT INTO private.magnisa_signup_age_pending(email,birth_date,majority_confirmed_at,expires_at) VALUES
  ('invite-accept@magnisa.test', date '1990-01-01', now(), now()+interval '15 minutes'),
  ('invite-decline@magnisa.test', date '1990-01-01', now(), now()+interval '15 minutes'),
  ('invite-unconfirmed@magnisa.test', date '1990-01-01', now(), now()+interval '15 minutes')
ON CONFLICT (email) DO UPDATE SET birth_date=excluded.birth_date,
 majority_confirmed_at=excluded.majority_confirmed_at, expires_at=excluded.expires_at;

INSERT INTO auth.users (
  id, email, email_confirmed_at, invited_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES
  ('10000000-0000-4000-8000-000000000101', 'invite-accept@magnisa.test', now(), NULL, now(), now(),
   '{"first_name":"Invite","last_name":"Accept"}'::jsonb, '{"provider":"email","providers":["email"]}'::jsonb),
  ('10000000-0000-4000-8000-000000000102', 'invite-decline@magnisa.test', now(), NULL, now(), now(),
   '{"first_name":"Invite","last_name":"Decline"}'::jsonb, '{"provider":"email","providers":["email"]}'::jsonb),
  ('10000000-0000-4000-8000-000000000103', 'invite-unconfirmed@magnisa.test', NULL, NULL, now(), now(),
   '{"first_name":"Invite","last_name":"Unconfirmed"}'::jsonb, '{"provider":"email","providers":["email"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, currency) VALUES
  ('20000000-0000-4000-8000-000000000101', 'Invitation accept test', 'MGA'),
  ('20000000-0000-4000-8000-000000000102', 'Invitation decline test', 'MGA'),
  ('20000000-0000-4000-8000-000000000103', 'Invitation unconfirmed test', 'MGA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES
  ('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', 'viewer', 'invited'),
  ('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', 'viewer', 'invited'),
  ('20000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000103', 'viewer', 'invited')
ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'invited';

INSERT INTO public.notifications (
  organization_id, recipient_user_id, category, priority, title, body,
  entity_type, entity_id, metadata, dedupe_key
) VALUES
  ('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', 'system', 'info',
   'Invitation test', 'Invitation à accepter.', 'organization_invitation',
   '20000000-0000-4000-8000-000000000101', '{"role":"viewer"}', 'invitation-test-accept'),
  ('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', 'system', 'info',
   'Invitation test', 'Invitation à refuser.', 'organization_invitation',
   '20000000-0000-4000-8000-000000000102', '{"role":"viewer"}', 'invitation-test-decline'),
  ('20000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000103', 'system', 'info',
   'Invitation test', 'Invitation en attente de vérification.', 'organization_invitation',
   '20000000-0000-4000-8000-000000000103', '{"role":"viewer"}', 'invitation-test-unconfirmed')
ON CONFLICT (organization_id, recipient_user_id, dedupe_key) DO NOTHING;

-- A confirmed but unverified-majority user must not accept the invitation.
INSERT INTO auth.users(id,email,email_confirmed_at,invited_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data)
VALUES ('10000000-0000-4000-8000-000000000104','invite-no-age@magnisa.test',now(),now(),now(),now(),
  '{"first_name":"Invite","last_name":"NoAge"}'::jsonb,'{"provider":"email","providers":["email"]}'::jsonb)
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.organizations(id,name,currency)
VALUES ('20000000-0000-4000-8000-000000000104','Invitation no age test','MGA')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('20000000-0000-4000-8000-000000000104','10000000-0000-4000-8000-000000000104','viewer','invited')
ON CONFLICT (organization_id,user_id) DO UPDATE SET status='invited';


SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);

DO $$
DECLARE
  v_count integer;
  v_status text;
BEGIN
  SELECT count(*) INTO v_count FROM public.get_my_organization_invitations();
  IF v_count <> 1 THEN RAISE EXCEPTION 'A user must see only their own pending invitation'; END IF;

  SELECT count(*) INTO v_count FROM public.notifications;
  IF v_count <> 1 THEN RAISE EXCEPTION 'An invited user must see only their own invitation notification'; END IF;

  UPDATE public.notifications
  SET read_at = now()
  WHERE recipient_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'An invited user must be able to mark their own notification as read'; END IF;

  IF public.is_org_member('20000000-0000-4000-8000-000000000101') THEN
    RAISE EXCEPTION 'An invited user must not be an active organization member before acceptance';
  END IF;

  PERFORM public.respond_to_organization_invitation(
    '20000000-0000-4000-8000-000000000101', true
  );

  SELECT status INTO v_status
  FROM public.organization_members
  WHERE organization_id = '20000000-0000-4000-8000-000000000101'
    AND user_id = auth.uid();

  IF v_status <> 'active' THEN RAISE EXCEPTION 'Accepted invitation must activate membership'; END IF;
  IF NOT public.is_org_member('20000000-0000-4000-8000-000000000101') THEN
    RAISE EXCEPTION 'Accepted user must become an organization member';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.notifications
  WHERE archived_at IS NOT NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Acceptance must archive the matching invitation notification'; END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000102', true);

DO $$
DECLARE
  v_status text;
  v_count integer;
BEGIN
  PERFORM public.respond_to_organization_invitation(
    '20000000-0000-4000-8000-000000000102', false
  );

  SELECT status INTO v_status
  FROM public.organization_members
  WHERE organization_id = '20000000-0000-4000-8000-000000000102'
    AND user_id = auth.uid();

  IF v_status <> 'declined' THEN RAISE EXCEPTION 'Declined invitation must retain declined status'; END IF;
  IF public.is_org_member('20000000-0000-4000-8000-000000000102') THEN
    RAISE EXCEPTION 'Declined user must not become an organization member';
  END IF;

  SELECT count(*) INTO v_count FROM public.notifications;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Declined user must no longer see the invitation notification'; END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000103', true);

DO $$
DECLARE
  v_rejected boolean := false;
  v_status text;
BEGIN
  BEGIN
    PERFORM public.respond_to_organization_invitation(
      '20000000-0000-4000-8000-000000000103', true
    );
  EXCEPTION WHEN SQLSTATE '28000' THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN RAISE EXCEPTION 'Unconfirmed email must not be allowed to accept an invitation'; END IF;

  SELECT status INTO v_status
  FROM public.organization_members
  WHERE organization_id = '20000000-0000-4000-8000-000000000103'
    AND user_id = auth.uid();

  IF v_status <> 'invited' THEN RAISE EXCEPTION 'Unconfirmed invitation must remain pending'; END IF;
END;
$$;


SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000104',true);
DO $$
DECLARE v_rejected boolean:=false; v_status text;
BEGIN
  BEGIN
    PERFORM public.respond_to_organization_invitation('20000000-0000-4000-8000-000000000104',true);
  EXCEPTION WHEN SQLSTATE '28000' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Confirmed user without a majority record must not accept invitation'; END IF;
  SELECT status INTO v_status FROM public.organization_members
  WHERE organization_id='20000000-0000-4000-8000-000000000104' AND user_id=auth.uid();
  IF v_status <> 'invited' THEN RAISE EXCEPTION 'Invitation without majority must remain pending'; END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
