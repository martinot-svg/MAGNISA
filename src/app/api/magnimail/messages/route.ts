import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import {
  getGmailAccess,
  gmailHeader,
  gmailJson,
  parseAddressList,
  type GmailDraft,
  type GmailMessage,
} from "@/lib/google/gmail";
import { createAdminClient } from "@/lib/supabase/admin";

const folderLabels: Record<string, string> = {
  inbox: "INBOX",
  sent: "SENT",
  trash: "TRASH",
};

function mailSummary(message: GmailMessage, kind: "message" | "draft", idOverride?: string) {
  return {
    id: idOverride || message.id,
    messageId: message.id,
    threadId: message.threadId,
    kind,
    subject: gmailHeader(message, "Subject") || "(Sans objet)",
    from: gmailHeader(message, "From"),
    to: gmailHeader(message, "To"),
    cc: gmailHeader(message, "Cc"),
    date: gmailHeader(message, "Date"),
    snippet: message.snippet || "",
    labelIds: message.labelIds || [],
    unread: (message.labelIds || []).includes("UNREAD"),
    timestamp: message.internalDate ? Number(message.internalDate) : 0,
  };
}

async function syncHistory(
  ctx: Awaited<ReturnType<typeof requireOrganization>>,
  connectionId: string,
  items: ReturnType<typeof mailSummary>[],
) {
  const { supabase, organizationId, user } = ctx;
  const { data: customers = [] } = await supabase
    .from("customers")
    .select("id,name,email")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .not("email", "is", null);

  const customerMap = new Map(
    (customers as Array<{ id: string; name: string; email: string }>).map((c) => [
      String(c.email || "").trim().toLowerCase(),
      c,
    ]),
  );

  const rows = items
    .filter((item) => item.kind === "message")
    .map((item) => {
      const fromEmails = parseAddressList(item.from);
      const toEmails = parseAddressList(item.to);
      const ccEmails = parseAddressList(item.cc);
      const match = [...fromEmails, ...toEmails, ...ccEmails]
        .map((email) => customerMap.get(email))
        .find(Boolean);
      const outgoing = item.labelIds.includes("SENT");
      return {
        organization_id: organizationId,
        connection_id: connectionId,
        provider: "google",
        provider_message_id: item.messageId,
        provider_thread_id: item.threadId,
        direction: outgoing ? "outgoing" : "incoming",
        from_email: fromEmails[0] || null,
        to_emails: toEmails,
        cc_emails: ccEmails,
        subject: item.subject,
        snippet: item.snippet,
        occurred_at: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
        customer_id: match?.id || null,
        created_by: outgoing ? user.id : null,
        updated_at: new Date().toISOString(),
      };
    });

  if (!rows.length) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from("email_history")
    .upsert(rows, { onConflict: "organization_id,provider,provider_message_id" });
  if (error) console.error("MagniMail history sync failed", error);
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireOrganization();
    const { organizationId, user } = ctx;
    const { connection, accessToken } = await getGmailAccess(organizationId, user.id);
    const url = new URL(request.url);
    const folder = (url.searchParams.get("folder") || "inbox").toLowerCase();
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 300);
    const pageToken = String(url.searchParams.get("pageToken") || "").trim();

    if (folder === "drafts") {
      const params = new URLSearchParams({ maxResults: "30" });
      if (q) params.set("q", q);
      if (pageToken) params.set("pageToken", pageToken);
      const result = await gmailJson<{
        drafts?: GmailDraft[];
        nextPageToken?: string;
        resultSizeEstimate?: number;
      }>(accessToken, `/drafts?${params.toString()}`);

      const summaries = await Promise.all(
        (result.drafts || []).map(async (draft) => {
          const detail = await gmailJson<GmailDraft>(
            accessToken,
            `/drafts/${encodeURIComponent(draft.id)}?format=metadata`,
          );
          const message = detail.message!;
          return mailSummary(message, "draft", draft.id);
        }),
      );

      return NextResponse.json({
        connectedEmail: connection.email,
        items: summaries.sort((a, b) => b.timestamp - a.timestamp),
        nextPageToken: result.nextPageToken || null,
        resultSizeEstimate: result.resultSizeEstimate || summaries.length,
      });
    }

    const label = folderLabels[folder] || "INBOX";
    const params = new URLSearchParams({ maxResults: "30" });
    params.append("labelIds", label);
    if (q) params.set("q", q);
    if (pageToken) params.set("pageToken", pageToken);

    const result = await gmailJson<{
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>(accessToken, `/messages?${params.toString()}`);

    const detailParams = new URLSearchParams({ format: "metadata" });
    for (const header of ["From", "To", "Cc", "Subject", "Date", "Message-ID"]) {
      detailParams.append("metadataHeaders", header);
    }

    const items = await Promise.all(
      (result.messages || []).map((ref) =>
        gmailJson<GmailMessage>(
          accessToken,
          `/messages/${encodeURIComponent(ref.id)}?${detailParams.toString()}`,
        ).then((message) => mailSummary(message, "message")),
      ),
    );

    await syncHistory(ctx, connection.id, items);

    return NextResponse.json({
      connectedEmail: connection.email,
      items: items.sort((a, b) => b.timestamp - a.timestamp),
      nextPageToken: result.nextPageToken || null,
      resultSizeEstimate: result.resultSizeEstimate || items.length,
    });
  } catch (error) {
    console.error("MagniMail list failed", error);
    const message = error instanceof Error ? error.message : "Impossible de charger la messagerie.";
    const status = message.includes("Aucun compte Gmail") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
