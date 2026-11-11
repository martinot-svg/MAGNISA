-- Production had this legacy table before the timestamped migration ledger began.
-- The historical 0008 migration hardens it and the later 0015 migration removes it.
-- Recreate only this pre-ledger object for a clean local replay; do not recreate core schema.
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- This RPC existed in production before the first recorded migration. The later
-- security migration revokes anonymous execution, so clean replay must restore
-- the function signature before that historical grant-hardening step.
CREATE OR REPLACE FUNCTION public.organization_member_directory(p_org uuid)
RETURNS TABLE(user_id uuid,email text,role text,status text,created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'users.manage');
  RETURN QUERY
  SELECT om.user_id,COALESCE(p.email,u.email),om.role,om.status,om.created_at
  FROM public.organization_members om
  JOIN auth.users u ON u.id=om.user_id
  LEFT JOIN public.profiles p ON p.id=om.user_id
  WHERE om.organization_id=p_org
  ORDER BY om.created_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.organization_member_directory(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.organization_member_directory(uuid) TO authenticated,service_role;
