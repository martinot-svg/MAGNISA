import { MagniboxSyncError } from "./imap-sync-core";
import {
  type MagniboxInternalMessageResolverRepository,
  type MagniboxInternalMessageRow,
  type MagniboxInternalMailboxRow,
} from "./canonical-internal-message-resolver";

type QueryError = { message?: string } | null;
type QueryResult = { data: unknown; error: QueryError };

interface ResolverQueryBuilder {
  select(columns: string): ResolverQueryBuilder;
  eq(column: string, value: string | boolean): ResolverQueryBuilder;
  limit(count: number): ResolverQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
}

/**
 * Structural interface keeps the adapter testable without exporting a
 * service-role client type into browser-facing modules.
 */
export interface MagniboxResolverSupabaseClient {
  from(table: "magnibox_internal_messages" | "magnibox_internal_mailboxes" | "magnibox_internal_mailbox_grants"): ResolverQueryBuilder;
}

function asRow(value: unknown, label: string): Record<string, unknown> | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MagniboxSyncError(`Invalid ${label} database response`, false);
  }
  return value as Record<string, unknown>;
}

function requiredText(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new MagniboxSyncError("Invalid canonical database row", false);
  }
  return value;
}

function nullableText(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new MagniboxSyncError("Invalid canonical database row", false);
  }
  return value;
}

function requiredBoolean(row: Record<string, unknown>, field: string): boolean {
  const value = row[field];
  if (typeof value !== "boolean") {
    throw new MagniboxSyncError("Invalid canonical database row", false);
  }
  return value;
}

async function single(
  query: PromiseLike<QueryResult>,
  operation: string,
): Promise<Record<string, unknown> | null> {
  const result = await query;
  if (result.error) {
    // Database/network errors remain retryable; do not persist raw SQL details.
    throw new MagniboxSyncError(`${operation} failed`);
  }
  return asRow(result.data, operation);
}

function mapMessage(row: Record<string, unknown>): MagniboxInternalMessageRow {
  return {
    id: requiredText(row, "id"),
    organization_id: requiredText(row, "organization_id"),
    sender_mailbox_id: requiredText(row, "sender_mailbox_id"),
    recipient_mailbox_id: requiredText(row, "recipient_mailbox_id"),
    subject: requiredText(row, "subject"),
    body_text: typeof row.body_text === "string" ? row.body_text : (() => {
      throw new MagniboxSyncError("Invalid canonical database row", false);
    })(),
    created_at: requiredText(row, "created_at"),
  };
}

function mapMailbox(row: Record<string, unknown>): MagniboxInternalMailboxRow {
  return {
    id: requiredText(row, "id"),
    organization_id: requiredText(row, "organization_id"),
    local_part: requiredText(row, "local_part"),
    owner_user_id: nullableText(row, "owner_user_id"),
    display_name: typeof row.display_name === "string" ? row.display_name : "",
    is_active: requiredBoolean(row, "is_active"),
    can_read: requiredBoolean(row, "can_read"),
  };
}

/** Must be constructed only with a server-side Supabase service-role client. */
export function createMagniboxSupabaseInternalMessageResolverRepository(
  client: MagniboxResolverSupabaseClient,
): MagniboxInternalMessageResolverRepository {
  return {
    async getMessage({ organizationId, messageId }) {
      const row = await single(
        client.from("magnibox_internal_messages")
          .select("id,organization_id,sender_mailbox_id,recipient_mailbox_id,subject,body_text,created_at")
          .eq("organization_id", organizationId)
          .eq("id", messageId)
          .maybeSingle(),
        "Canonical message lookup",
      );
      return row ? mapMessage(row) : null;
    },

    async getMailbox({ organizationId, mailboxId }) {
      const row = await single(
        client.from("magnibox_internal_mailboxes")
          .select("id,organization_id,local_part,owner_user_id,display_name,is_active,can_read")
          .eq("organization_id", organizationId)
          .eq("id", mailboxId)
          .maybeSingle(),
        "Mailbox lookup",
      );
      return row ? mapMailbox(row) : null;
    },

    async hasActiveGrants({ organizationId, mailboxId }) {
      const row = await single(
        client.from("magnibox_internal_mailbox_grants")
          .select("mailbox_id")
          .eq("organization_id", organizationId)
          .eq("mailbox_id", mailboxId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle(),
        "Mailbox grant lookup",
      );
      return row !== null;
    },
  };
}
