BEGIN;

-- Keep organization-member read access, but split administrator write policies
-- so PostgreSQL does not combine redundant permissive SELECT policies.
DROP POLICY IF EXISTS email_templates_manage_admin ON public.email_templates;
CREATE POLICY email_templates_manage_insert
  ON public.email_templates FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','admin']));
CREATE POLICY email_templates_manage_update
  ON public.email_templates FOR UPDATE TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','admin']));
CREATE POLICY email_templates_manage_delete
  ON public.email_templates FOR DELETE TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS notification_rules_manage_admin ON public.notification_rules;
CREATE POLICY notification_rules_manage_insert
  ON public.notification_rules FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','admin','director']));
CREATE POLICY notification_rules_manage_update
  ON public.notification_rules FOR UPDATE TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','admin','director']))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','admin','director']));
CREATE POLICY notification_rules_manage_delete
  ON public.notification_rules FOR DELETE TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','admin','director']));

COMMIT;
