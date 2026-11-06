-- Keep organization membership self-read consistent across clean installs and production.
-- Existing production databases already have member_select; the guard makes this safe to replay.
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'organization_members'
       AND policyname = 'member_select'
  ) THEN
    CREATE POLICY member_select
      ON public.organization_members
      FOR SELECT
      TO authenticated
      USING (
        user_id = (SELECT auth.uid())
        OR has_org_permission(organization_id, 'users.manage')
      );
  END IF;
END
$$;
