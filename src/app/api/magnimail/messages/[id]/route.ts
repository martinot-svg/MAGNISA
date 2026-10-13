import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import {
  getGmailAccess,
  gmailAttachments,
  gmailBody,
  gmailHeader,
  gmailJson,
  parseAddressList,
  type GmailDraft,
  type GmailMessage,
} from "@/lib/google/gmail";
import { matchCustomerByEmails, recordMailHistory } from "@/lib/magnimail/history";

function textFromHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchMessage(accessToken: string, id: string, kind: string) {
  if (kind === "draft") {
    const draft = await gmailJson<GmailDraft>(
      accessToken,
      `/drafts/${encodeURIComponent(id)}?format=full`,
    );
    if (!draft.message) throw new Error("Brouillon Gmail introuvable.");
    return { message: draft.message, draftId: draft.id };
  }
  const message = await gmailJson<GmailMessage>(
    accessToken,
    `/messages/${encodeURIComponent(id)}?format=full`,
  );
  return { message, draftId: null };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await requireOrganization();
    const { organizationId, user, supabase } = ctx;
    const { connection, accessToken } = await getGmailAccess(organizationId, user.id);
    const kind = new URL(request.url).searchParams.get("kind") === "draft" ? "draft" : "message";

    const { message, draftId } = await fetchMessage(accessToken, id, kind);
    if (kind === "message" && (message.labelIds || []).includes("UNREAD")) {
      await gmailJson<GmailMessage>(
        accessToken,
        `/messages/${encodeURIComponent(message.id)}/modify`,
        {
          method: "POST",
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
        },
      ).catch((error) => console.error("MagniMail mark read failed", error));
    }

    const bodies = gmailBody(message);
    const bodyText = bodies.text || textFromHtml(bodies.html);
    const attachments = gmailAttachments(message);
    const from = gmailHeader(message, "From");
    const to = gmailHeader(message, "To");
    const cc = gmailHeader(message, "Cc");
    const bcc = gmailHeader(message, "Bcc");
    const subject = gmailHeader(message, "Subject") || "(Sans objet)";
    const messageIdHeader = gmailHeader(message, "Message-ID") || gmailHeader(message, "Message-Id");
    const references = gmailHeader(message, "References");
    const emails = [
      ...parseAddressList(from),
      ...parseAddressList(to),
      ...parseAddressList(cc),
    ];
    const customer = await matchCustomerByEmails(supabase, organizationId, emails);
    const outgoing = (message.labelIds || []).includes("SENT");

    if (kind === "message") {
      await recordMailHistory({
        organizationId,
        connectionId: connection.id,
        provider: "google",
        providerMessageId: message.id,
        providerThreadId: message.threadId,
        direction: outgoing ? "outgoing" : "incoming",
        fromEmail: parseAddressList(from)[0] || null,
        toEmails: parseAddressList(to),
        ccEmails: parseAddressList(cc),
        subject,
        snippet: message.snippet || bodyText.slice(0, 240),
        occurredAt: message.internalDate
          ? new Date(Number(message.internalDate)).toISOString()
          : new Date().toISOString(),
        customerId: customer?.id || null,
        attachmentNames: attachments.map((item) => item.filename),
        createdBy: outgoing ? user.id : null,
      }).catch((error) => console.error("MagniMail history detail failed", error));
    }

    return NextResponse.json({
      id: kind === "draft" ? draftId : message.id,
      messageId: message.id,
      threadId: message.threadId,
      kind,
      subject,
      from,
      to,
      cc,
      bcc,
      date: gmailHeader(message, "Date"),
      timestamp: message.internalDate ? Number(message.internalDate) : 0,
      body: bodyText,
      snippet: message.snippet || "",
      labelIds: message.labelIds || [],
      messageIdHeader,
      references,
      attachments,
      customer,
      connectedEmail: connection.email,
    });
  } catch (error) {
    console.error("MagniMail detail failed", error);
    const message = error instanceof Error ? error.message : "Impossible de charger le message.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await requireOrganization();
    const { organizationId, user } = ctx;
    const { accessToken } = await getGmailAccess(organizationId, user.id);
    let payload: { action?: string } | null = null;
    try { payload = (await request.json()) as { action?: string }; } catch { payload = null; }
    const action = payload?.action;

    if (!["trash", "untrash"].includes(String(action))) {
      return NextResponse.json({ error: "Action MagniMail invalide." }, { status: 400 });
    }

    const result = await gmailJson<GmailMessage>(
      accessToken,
      `/messages/${encodeURIComponent(id)}/${action}`,
      { method: "POST", body: "{}" },
    );

    return NextResponse.json({ ok: true, id: result.id, labelIds: result.labelIds || [] });
  } catch (error) {
    console.error("MagniMail action failed", error);
    const message = error instanceof Error ? error.message : "Action impossible.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
