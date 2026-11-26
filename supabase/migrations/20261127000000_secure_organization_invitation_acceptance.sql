-- Keep organization invitations pending until the invited user explicitly accepts.
-- Existing active memberships and organization data are preserved.

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_status_check;

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_status_check
  CHECK (status IN ('active', 'suspended', 'invited', 'declined'));

CREATE OR REPLACE FUNCTION public.get_my_organization_invitations()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  role text,
  invited_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user uuid;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING errcode = '28000';
  END IF;

  RETURN QUERY
  SELECT om.organization_id, o.name, om.role, om.created_at
  FROM public.organization_members AS om
  JOIN public.organizations AS o ON o.id = om.organization_id
  WHERE om.user_id = v_user
    AND om.status = 'invited'
  ORDER BY om.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_organization_invitation(
  p_organization_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user uuid;
  v_email_confirmed_at timestamptz;
  v_status text;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING errcode = '28000';
  END IF;
  IF p_organization_id IS NULL OR p_accept IS NULL THEN
    RAISE EXCEPTION 'Réponse à l’invitation invalide' USING errcode = '22023';
  END IF;

  SELECT u.email_confirmed_at
    INTO v_email_confirmed_at
  FROM auth.users AS u
  WHERE u.id = v_user;

  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Confirmez votre adresse e-mail avant de répondre à cette invitation'
      USING errcode = '28000';
  END IF;

  SELECT om.status
    INTO v_status
  FROM public.organization_members AS om
  WHERE om.organization_id = p_organization_id
    AND om.user_id = v_user
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION 'Invitation indisponible ou déjà traitée'
      USING errcode = 'P0002';
  END IF;

  UPDATE public.organization_members
  SET status = CASE WHEN p_accept THEN 'active' ELSE 'declined' END
  WHERE organization_id = p_organization_id
    AND user_id = v_user
    AND status = 'invited';

  UPDATE public.notifications
  SET read_at = COALESCE(read_at, now()),
      archived_at = COALESCE(archived_at, now())
  WHERE organization_id = p_organization_id
    AND recipient_user_id = v_user
    AND entity_type = 'organization_invitation'
    AND entity_id = p_organization_id
    AND archived_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_organization_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_organization_invitations() TO authenticated;

REVOKE ALL ON FUNCTION public.respond_to_organization_invitation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_organization_invitation(uuid, boolean) TO authenticated;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own
ON public.notifications
FOR SELECT
TO authenticated
USING (
  recipient_user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.organization_members AS om
    WHERE om.organization_id = notifications.organization_id
      AND om.user_id = (SELECT auth.uid())
      AND om.status IN ('active', 'invited')
  )
);

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own
ON public.notifications
FOR UPDATE
TO authenticated
USING (
  recipient_user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.organization_members AS om
    WHERE om.organization_id = notifications.organization_id
      AND om.user_id = (SELECT auth.uid())
      AND om.status IN ('active', 'invited')
  )
)
WITH CHECK (
  recipient_user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.organization_members AS om
    WHERE om.organization_id = notifications.organization_id
      AND om.user_id = (SELECT auth.uid())
      AND om.status IN ('active', 'invited')
  )
);
