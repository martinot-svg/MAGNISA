-- Verify read policies stay member-readable and admin writes remain separately gated.
DO $contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='email_templates'
      AND policyname='email_templates_select_org' AND cmd='SELECT'
  ) THEN
    RAISE EXCEPTION 'Email templates organization-member SELECT policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='email_templates'
      AND policyname='email_templates_manage_insert' AND cmd='INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='email_templates'
      AND policyname='email_templates_manage_update' AND cmd='UPDATE'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='email_templates'
      AND policyname='email_templates_manage_delete' AND cmd='DELETE'
  ) THEN
    RAISE EXCEPTION 'Email template admin write policies missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='email_templates'
      AND policyname='email_templates_manage_admin'
  ) THEN
    RAISE EXCEPTION 'Legacy overlapping email template ALL policy remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='notification_rules'
      AND policyname='notification_rules_read_member' AND cmd='SELECT'
  ) THEN
    RAISE EXCEPTION 'Notification rules organization-member SELECT policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='notification_rules'
      AND policyname='notification_rules_manage_insert' AND cmd='INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='notification_rules'
      AND policyname='notification_rules_manage_update' AND cmd='UPDATE'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='notification_rules'
      AND policyname='notification_rules_manage_delete' AND cmd='DELETE'
  ) THEN
    RAISE EXCEPTION 'Notification rules admin write policies missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='notification_rules'
      AND policyname='notification_rules_manage_admin'
  ) THEN
    RAISE EXCEPTION 'Legacy overlapping notification rules ALL policy remains';
  END IF;
END;
$contract$;
