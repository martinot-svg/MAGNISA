BEGIN;
SET LOCAL search_path = public, extensions;

-- Cache auth.uid() once per statement instead of re-evaluating it for each row.
-- This is a semantics-preserving RLS planner optimization; policy roles,
-- commands, membership predicates and permission checks remain unchanged.
ALTER POLICY "accounting_periods_select" ON public."accounting_periods" USING ((EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = accounting_periods.organization_id) AND (m.user_id = (SELECT auth.uid())) AND (m.status = 'active'::text)))));

ALTER POLICY "accounting_posting_rules_select" ON public."accounting_posting_rules" USING (((organization_id IS NULL) OR (EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = accounting_posting_rules.organization_id) AND (m.user_id = (SELECT auth.uid())) AND (m.status = 'active'::text))))));

ALTER POLICY "document_appearance_read" ON public."document_appearance_snapshots" USING ((EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = document_appearance_snapshots.organization_id) AND (m.user_id = (SELECT auth.uid())) AND (m.status = 'active'::text)))));

ALTER POLICY "email_connections_select_own" ON public."email_connections" USING (((user_id = (SELECT auth.uid())) AND is_org_member(organization_id)));

ALTER POLICY "fiscal_calendar_rules_insert" ON public."fiscal_calendar_rules" WITH CHECK ((has_org_permission(organization_id, 'accounting.manage'::text) AND ((status = 'draft'::text) OR (status = 'archived'::text)) AND ((created_by IS NULL) OR (created_by = (SELECT auth.uid())))));

ALTER POLICY "fiscal_calendar_rules_update" ON public."fiscal_calendar_rules" USING (has_org_permission(organization_id, 'accounting.manage'::text))
  WITH CHECK ((has_org_permission(organization_id, 'accounting.manage'::text) AND ((updated_by IS NULL) OR (updated_by = (SELECT auth.uid())))));

ALTER POLICY "inventory_counts_insert" ON public."inventory_counts" WITH CHECK (((status = 'draft'::text) AND (created_by = (SELECT auth.uid())) AND has_org_permission(organization_id, 'accounting.manage'::text)));

ALTER POLICY "member_select" ON public."organization_members" USING (((user_id = (SELECT auth.uid())) OR has_org_permission(organization_id, 'users.manage'::text)));

ALTER POLICY "payroll_rule_change_log_read" ON public."payroll_rule_change_log" USING ((EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = payroll_rule_change_log.organization_id) AND (m.user_id = (SELECT auth.uid())) AND (m.status = 'active'::text)))));

ALTER POLICY "payroll_rule_read" ON public."payroll_rule_sets" USING ((EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = payroll_rule_sets.organization_id) AND (m.user_id = (SELECT auth.uid())) AND (m.status = 'active'::text)))));

ALTER POLICY "pcg_mapping_insert" ON public."pcg2005_account_mappings" WITH CHECK ((has_org_permission(organization_id, 'accounting.manage'::text) AND (updated_by = (SELECT auth.uid()))));

ALTER POLICY "pcg_mapping_update" ON public."pcg2005_account_mappings" USING (has_org_permission(organization_id, 'accounting.manage'::text))
  WITH CHECK ((has_org_permission(organization_id, 'accounting.manage'::text) AND (updated_by = (SELECT auth.uid()))));

ALTER POLICY "social_calendar_rules_insert" ON public."social_calendar_rules" WITH CHECK ((has_org_permission(organization_id, 'payroll.manage'::text) AND ((status = 'draft'::text) OR (status = 'archived'::text)) AND ((created_by IS NULL) OR (created_by = (SELECT auth.uid())))));

ALTER POLICY "social_calendar_rules_update" ON public."social_calendar_rules" USING (has_org_permission(organization_id, 'payroll.manage'::text))
  WITH CHECK ((has_org_permission(organization_id, 'payroll.manage'::text) AND ((updated_by IS NULL) OR (updated_by = (SELECT auth.uid())))));

ALTER POLICY "user_document_permissions_read_self" ON public."user_document_permissions" USING ((((SELECT auth.uid()) = user_id) AND is_org_member(organization_id)));

COMMIT;
