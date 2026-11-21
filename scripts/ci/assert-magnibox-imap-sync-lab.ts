import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required assertion variable: ${name}`);
  return value.trim();
}

async function main(): Promise<void> {
  const url = required("MAGNIBOX_LOCAL_SUPABASE_URL");
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    throw new Error("Assertions accept only the local Supabase API URL");
  }
  const supabase = createClient(url, required("MAGNIBOX_LOCAL_SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: events, error: eventsError } = await supabase.from("magnibox_sync_outbox")
    .select("id,organization_id,status,event_type")
    .eq("aggregate_type", "internal_message")
    .eq("event_type", "message.created");
  if (eventsError || !events || events.length !== 2 || events.some(row => row.status !== "delivered")) {
    throw new Error("The two real outbox events were not both acknowledged as delivered");
  }

  const { data: operations, error: operationsError } = await supabase.from("magnibox_imap_append_operations")
    .select("id,organization_id,outbox_event_id,target_mailbox_id,state,imap_uid,uidvalidity");
  if (operationsError || !operations || operations.length !== 4
    || operations.some(row => row.state !== "confirmed" || !row.imap_uid || !row.uidvalidity)) {
    throw new Error("Expected four confirmed Dovecot APPEND operations (INBOX and Sent per organization)");
  }

  const { data: mappings, error: mappingsError } = await supabase.from("magnibox_imap_message_map")
    .select("id,organization_id,source_type,source_message_id,folder_state_id,imap_uid,uidvalidity");
  if (mappingsError || !mappings || mappings.length !== 4
    || mappings.some(row => row.source_type !== "internal_message" || !row.imap_uid || !row.uidvalidity)) {
    throw new Error("Expected four confirmed organization-scoped IMAP UID mappings");
  }

  const organizationIds = new Set(events.map(row => row.organization_id));
  if (organizationIds.size !== 2) throw new Error("Outbox fixtures did not span exactly two organizations");
  for (const organizationId of organizationIds) {
    const scopedOperations = operations.filter(row => row.organization_id === organizationId);
    const scopedMappings = mappings.filter(row => row.organization_id === organizationId);
    if (scopedOperations.length !== 2 || scopedMappings.length !== 2) {
      throw new Error("Cross-organization projection scope assertion failed");
    }
  }

  process.stdout.write(JSON.stringify({
    outboxEventsDelivered: events.length,
    appendOperationsConfirmed: operations.length,
    uidMappingsConfirmed: mappings.length,
    organizationsIsolated: organizationIds.size,
    result: "PASS",
  }) + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown assertion failure";
  process.stderr.write(`MAGNIBOX IMAP assertion failed: ${message.slice(0, 220)}\n`);
  process.exitCode = 1;
});
