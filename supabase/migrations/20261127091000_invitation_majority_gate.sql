-- D-01: invitations cannot bypass the server-validated majority check.
-- Requires the private age table introduced by PR #418.
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

  SELECT u.email_confirmed_at INTO v_email_confirmed_at
  FROM auth.users AS u WHERE u.id = v_user;
  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Confirmez votre adresse e-mail avant de répondre à cette invitation'
      USING errcode = '28000';
  END IF;

  IF p_accept AND NOT EXISTS (
    SELECT 1 FROM private.magnisa_signup_age_checks a WHERE a.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Enregistre ta date de naissance et confirme ta majorité avant de rejoindre une équipe'
      USING errcode = '28000';
  END IF;

  SELECT om.status INTO v_status
  FROM public.organization_members AS om
  WHERE om.organization_id = p_organization_id AND om.user_id = v_user
  FOR UPDATE;
  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION 'Invitation indisponible ou déjà traitée'
      USING errcode = 'P0002';
  END IF;

  UPDATE public.organization_members
  SET status = CASE WHEN p_accept THEN 'active' ELSE 'declined' END
  WHERE organization_id = p_organization_id AND user_id = v_user AND status = 'invited';

  UPDATE public.notifications
  SET read_at = COALESCE(read_at, now()), archived_at = COALESCE(archived_at, now())
  WHERE organization_id = p_organization_id AND recipient_user_id = v_user
    AND entity_type = 'organization_invitation' AND entity_id = p_organization_id
    AND archived_at IS NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_to_organization_invitation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_organization_invitation(uuid, boolean) TO authenticated;
