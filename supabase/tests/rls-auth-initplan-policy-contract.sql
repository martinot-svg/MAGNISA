DO $contract$
DECLARE
  v_policy record;
  v_expression text;
  v_count integer := 0;
BEGIN
  FOR v_policy IN
    SELECT p.tablename,p.policyname,p.qual,p.with_check
    FROM pg_policies p
    JOIN (VALUES
      ('organization_members','member_select'),
      ('social_calendar_rules','social_calendar_rules_insert'),
      ('social_calendar_rules','social_calendar_rules_update'),
      ('email_connections','email_connections_select_own'),
      ('pcg2005_account_mappings','pcg_mapping_insert'),
      ('pcg2005_account_mappings','pcg_mapping_update'),
      ('fiscal_calendar_rules','fiscal_calendar_rules_insert'),
      ('fiscal_calendar_rules','fiscal_calendar_rules_update'),
      ('user_document_permissions','user_document_permissions_read_self'),
      ('payroll_rule_sets','payroll_rule_read'),
      ('payroll_rule_change_log','payroll_rule_change_log_read'),
      ('document_appearance_snapshots','document_appearance_read'),
      ('accounting_posting_rules','accounting_posting_rules_select'),
      ('accounting_periods','accounting_periods_select'),
      ('inventory_counts','inventory_counts_insert')
    ) AS expected(tablename,policyname)
      ON expected.tablename=p.tablename AND expected.policyname=p.policyname
    WHERE p.schemaname='public'
  LOOP
    v_count := v_count + 1;
    v_expression := coalesce(v_policy.qual,'') || ' ' || coalesce(v_policy.with_check,'');
    v_expression := regexp_replace(
      v_expression,
      E'\\(\\s*SELECT\\s+auth\\.uid\\(\\)\\s+AS\\s+uid\\s*\\)',
      '',
      'gi'
    );
    IF v_expression ILIKE '%auth.uid()%' THEN
      RAISE EXCEPTION 'RLS policy %.% still evaluates auth.uid() per row',v_policy.tablename,v_policy.policyname;
    END IF;
  END LOOP;
  IF v_count <> 15 THEN
    RAISE EXCEPTION 'Expected 15 optimized RLS policies, found %',v_count;
  END IF;
END;
$contract$;
