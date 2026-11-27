-- Production release schema contract.
-- Run after the reviewed migration allowlist has been applied to a clean replay,
-- a disposable production restore, or production itself.
DO $$
BEGIN
  IF to_regprocedure('public.magnibox_has_internal_reader(uuid,uuid)') IS NULL
    OR to_regprocedure('public.magnibox_list_deliverable_mailboxes(uuid)') IS NULL
    OR to_regprocedure('public.magnibox_can_send_internal(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'MAGNIBOX internal mailbox permission functions are missing';
  END IF;

  IF NOT has_function_privilege('authenticated','public.magnibox_has_internal_reader(uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_has_internal_reader(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.magnibox_list_deliverable_mailboxes(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_list_deliverable_mailboxes(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.magnibox_can_send_internal(uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_can_send_internal(uuid,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'MAGNIBOX permission function grants violate the least-privilege contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'magnibox_internal_messages'
      AND policyname = 'magnibox_messages_select'
      AND position('sender_mailbox_id' in coalesce(qual,'')) > 0
      AND position('send' in coalesce(qual,'')) > 0
  ) THEN
    RAISE EXCEPTION 'MAGNIBOX sent-folder read policy is missing';
  END IF;

  IF to_regprocedure('private.magnisa_generate_username(text,text)') IS NULL
    OR to_regprocedure('private.magnisa_issue_profile_id()') IS NULL
    OR to_regprocedure('public.claim_magnisa_identity(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'MAGNISA username identity functions are missing';
  END IF;

  IF NOT has_function_privilege('authenticated','public.claim_magnisa_identity(text,text,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.claim_magnisa_identity(text,text,text,text)','EXECUTE')
    OR has_function_privilege('authenticated','private.magnisa_generate_username(text,text)','EXECUTE')
    OR has_function_privilege('anon','private.magnisa_generate_username(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'MAGNISA identity function grants violate the least-privilege contract';
  END IF;

  IF to_regprocedure('public.get_my_organization_invitations()') IS NULL
    OR to_regprocedure('public.respond_to_organization_invitation(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Organization invitation RPCs are missing';
  END IF;

  IF NOT has_function_privilege('authenticated','public.get_my_organization_invitations()','EXECUTE')
    OR has_function_privilege('anon','public.get_my_organization_invitations()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.respond_to_organization_invitation(uuid,boolean)','EXECUTE')
    OR has_function_privilege('anon','public.respond_to_organization_invitation(uuid,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Organization invitation RPC grants violate the least-privilege contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_members'::regclass
      AND conname = 'organization_members_status_check'
      AND pg_get_constraintdef(oid) ILIKE '%invited%'
      AND pg_get_constraintdef(oid) ILIKE '%declined%'
  ) THEN
    RAISE EXCEPTION 'Organization invitation membership states are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_select_own'
      AND position('invited' in coalesce(qual,'')) > 0
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_update_own'
      AND position('invited' in coalesce(qual,'')) > 0
  ) THEN
    RAISE EXCEPTION 'Pending invitation notification policies are missing';
  END IF;

  IF to_regclass('public.company_settings_member_view') IS NULL THEN
    RAISE EXCEPTION 'Permission-aware company settings view is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'company_settings_member_view'
      AND c.reloptions @> ARRAY['security_barrier=true']
      AND c.reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'Company settings member view must use security_barrier and security_invoker';
  END IF;

  IF position('get_company_settings_member_read_model' in lower(pg_get_viewdef('public.company_settings_member_view'::regclass, true))) = 0
    OR position('can_bank' in lower(pg_get_functiondef('public.get_company_settings_member_read_model()'::regprocedure))) = 0
    OR position('can_identity' in lower(pg_get_functiondef('public.get_company_settings_member_read_model()'::regprocedure))) = 0
    OR position('can_fiscal' in lower(pg_get_functiondef('public.get_company_settings_member_read_model()'::regprocedure))) = 0 THEN
    RAISE EXCEPTION 'Company settings member view must preserve owner/admin and field-level masking through its read model';
  END IF;

  IF position('get_company_settings_member_read_model' in lower(pg_get_viewdef('public.company_settings_member_view'::regclass, true))) = 0
    OR position('is_org_member' in lower(pg_get_functiondef('public.get_company_settings_member_read_model()'::regprocedure))) = 0
    OR to_regprocedure('public.is_org_member(uuid)') IS NULL
    OR to_regprocedure('public.has_org_permission(uuid,text)') IS NULL
    OR to_regprocedure('public.has_org_role(uuid,text[])') IS NULL THEN
    RAISE EXCEPTION 'Company settings member read model must keep active-member and permission filters';
  END IF;

  IF position('auth.uid' in lower(pg_get_functiondef('public.is_org_member(uuid)'::regprocedure))) = 0
    OR position('active' in lower(pg_get_functiondef('public.is_org_member(uuid)'::regprocedure))) = 0
    OR position('auth.uid' in lower(pg_get_functiondef('public.has_org_permission(uuid,text)'::regprocedure))) = 0
    OR position('active' in lower(pg_get_functiondef('public.has_org_permission(uuid,text)'::regprocedure))) = 0
    OR position('auth.uid' in lower(pg_get_functiondef('public.has_org_role(uuid,text[])'::regprocedure))) = 0
    OR position('active' in lower(pg_get_functiondef('public.has_org_role(uuid,text[])'::regprocedure))) = 0 THEN
    RAISE EXCEPTION 'Organization membership and permission helpers must remain bound to the authenticated active member';
  END IF;

  IF NOT has_table_privilege('authenticated','public.company_settings_member_view','SELECT')
    OR has_table_privilege('anon','public.company_settings_member_view','SELECT') THEN
    RAISE EXCEPTION 'Company settings member view grants are incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.company_settings'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Company settings base table must keep RLS enabled';
  END IF;

  IF NOT has_table_privilege('authenticated','public.company_settings','SELECT')
    OR NOT has_table_privilege('authenticated','public.company_settings','INSERT')
    OR NOT has_table_privilege('authenticated','public.company_settings','UPDATE')
    OR has_table_privilege('authenticated','public.company_settings','DELETE') THEN
    RAISE EXCEPTION 'Company settings base-table grants violate the expected read/write/no-delete contract';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_settings'
      AND policyname IN (
        'company_settings_admin_select_guard',
        'company_settings_admin_insert_guard',
        'company_settings_admin_update_guard'
      )
      AND permissive = 'RESTRICTIVE'
  ) <> 3 THEN
    RAISE EXCEPTION 'Company settings raw-table restrictive guards are missing';
  END IF;
END;
$$;
