import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { createMagniboxSupabaseCredentialProvider } from "../magnibox/imap-credential-supabase-provider";
import { loadMagniboxCredentialKeyring } from "../magnibox/imap-credential-crypto";

type Account = {
  org: "org-a" | "org-b";
  slug: string;
  localPart: "alice" | "bob";
  email: string;
  password: string;
  displayName: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required lab variable: ${name}`);
  return value.trim();
}

async function mailboxEpoch(account: Account, folder: string, ca: Buffer): Promise<string> {
  const client = new ImapFlow({
    host: required("MAGNIBOX_LAB_IMAP_HOST"),
    port: 993,
    secure: true,
    auth: { user: account.email, pass: account.password },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", ca },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  let connected = false;
  let lock: { release(): void } | undefined;
  try {
    await client.connect();
    connected = true;
    if (folder === "Sent") {
      try { await client.mailboxCreate("Sent"); } catch { /* Existing Sent folder is acceptable. */ }
    }
    lock = await client.getMailboxLock(folder, { description: "MAGNIBOX CI fixture" });
    const value = client.mailbox?.uidValidity;
    const epoch = value === undefined || value === null ? "" : String(value);
    if (!/^[1-9][0-9]*$/.test(epoch)) throw new Error("Dovecot returned an invalid folder UIDVALIDITY");
    return epoch;
  } finally {
    lock?.release();
    if (connected) await client.logout().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const supabaseUrl = required("MAGNIBOX_LOCAL_SUPABASE_URL");
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(supabaseUrl)) {
    throw new Error("Fixture accepts only the local Supabase API URL");
  }
  const serviceKey = required("MAGNIBOX_LOCAL_SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const keyring = loadMagniboxCredentialKeyring({
    MAGNIBOX_IMAP_ACTIVE_KEY_ID: required("MAGNIBOX_LOCAL_IMAP_ACTIVE_KEY_ID"),
    MAGNIBOX_IMAP_CREDENTIALS_KEYS: required("MAGNIBOX_LOCAL_IMAP_CREDENTIALS_KEYS"),
  });
  const credentials = createMagniboxSupabaseCredentialProvider(supabase, keyring);
  const ca = readFileSync(required("MAGNIBOX_IMAP_CA_FILE"));

  const accounts: Account[] = [
    { org: "org-a", slug: "org-a", localPart: "alice", email: "org-a-alice@example.test", password: required("MAGNIBOX_LAB_ORG_A_ALICE_PASSWORD"), displayName: "Org A Alice" },
    { org: "org-a", slug: "org-a", localPart: "bob", email: "org-a-bob@example.test", password: required("MAGNIBOX_LAB_ORG_A_BOB_PASSWORD"), displayName: "Org A Bob" },
    { org: "org-b", slug: "org-b", localPart: "alice", email: "org-b-alice@example.test", password: required("MAGNIBOX_LAB_ORG_B_ALICE_PASSWORD"), displayName: "Org B Alice" },
    { org: "org-b", slug: "org-b", localPart: "bob", email: "org-b-bob@example.test", password: required("MAGNIBOX_LAB_ORG_B_BOB_PASSWORD"), displayName: "Org B Bob" },
  ];

  const organizations = new Map<string, string>();
  for (const org of ["org-a", "org-b"] as const) {
    const { data, error } = await supabase.from("organizations")
      .insert({ name: `MAGNIBOX isolated ${org.toUpperCase()}`, currency: "MGA" })
      .select("id").single();
    if (error || !data?.id) throw new Error(`Unable to create isolated ${org} organization`);
    organizations.set(org, data.id);
    const namespace = await supabase.from("magnibox_internal_namespaces")
      .insert({ organization_id: data.id, slug: org });
    if (namespace.error) throw new Error(`Unable to create ${org} MAGNIBOX namespace`);
  }

  const mailboxIds = new Map<string, string>();
  const userIds = new Map<string, string>();
  for (const account of accounts) {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    });
    if (authError || !authData.user?.id) throw new Error("Unable to create disposable local auth user");
    userIds.set(account.email, authData.user.id);

    const organizationId = organizations.get(account.org)!;
    const membership = await supabase.from("organization_members").insert({
      organization_id: organizationId,
      user_id: authData.user.id,
      role: "owner",
      status: "active",
    });
    if (membership.error) throw new Error(`Unable to create ${account.org} test membership`);

    const { data: mailbox, error: mailboxError } = await supabase.from("magnibox_internal_mailboxes")
      .insert({
        organization_id: organizationId,
        local_part: account.localPart,
        owner_user_id: authData.user.id,
        display_name: account.displayName,
        is_active: true,
        can_read: true,
        can_send: true,
      })
      .select("id").single();
    if (mailboxError || !mailbox?.id) throw new Error("Unable to create canonical MAGNIBOX mailbox");
    mailboxIds.set(account.email, mailbox.id);

    await credentials.rotate({
      organizationId,
      mailboxId: mailbox.id,
      credentials: {
        host: "mailserver",
        port: 993,
        secure: true,
        username: account.email,
        password: account.password,
      },
      idempotencyKey: `ci-imap-lab:${account.email}`,
    });

    for (const folder of ["INBOX", "Sent"]) {
      const uidValidity = await mailboxEpoch(account, folder, ca);
      const { error: folderError } = await supabase.from("magnibox_imap_folder_state").insert({
        organization_id: organizationId,
        mailbox_id: mailbox.id,
        namespace: "internal",
        identity_id: null,
        folder_key: folder === "INBOX" ? "inbox" : "sent",
        imap_folder_name: folder,
        uidvalidity: uidValidity,
      });
      if (folderError) throw new Error(`Unable to register ${folder} folder state`);
    }
  }

  for (const org of ["org-a", "org-b"] as const) {
    const organizationId = organizations.get(org)!;
    const sender = accounts.find(a => a.org === org && a.localPart === "alice")!;
    const recipient = accounts.find(a => a.org === org && a.localPart === "bob")!;
    const { error } = await supabase.from("magnibox_internal_messages").insert({
      organization_id: organizationId,
      sender_mailbox_id: mailboxIds.get(sender.email),
      recipient_mailbox_id: mailboxIds.get(recipient.email),
      subject: `Isolated IMAP integration ${org}`,
      body_text: `Synthetic message for ${org}; this event must stay inside its organization.`,
    });
    if (error) throw new Error(`Unable to create canonical internal message for ${org}`);
  }

  const { data: events, error: eventError } = await supabase.from("magnibox_sync_outbox")
    .select("id,organization_id,aggregate_type,event_type,status")
    .eq("aggregate_type", "internal_message")
    .eq("event_type", "message.created");
  if (eventError || events?.length !== 2) throw new Error("Expected exactly two real database-triggered internal-message events");
  process.stdout.write(JSON.stringify({
    organizations: organizations.size,
    mailboxes: mailboxIds.size,
    canonicalMessages: 2,
    outboxEvents: events.length,
    folders: 8,
    fixture: "isolated-local-only",
  }) + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown fixture failure";
  process.stderr.write(`MAGNIBOX IMAP fixture failed: ${message.slice(0, 220)}\n`);
  process.exitCode = 1;
});
