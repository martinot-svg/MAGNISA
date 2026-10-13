import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import {
  buildMimeMessage,
  getGmailAccess,
  sendGmailDraft,
  sendGmailRaw,
  updateGmailDraft,
} from "@/lib/google/gmail";
import { matchCustomerByEmails, recordMailHistory } from "@/lib/magnimail/history";
import { parseComposeForm, recipientEmails } from "@/lib/magnimail/compose";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireOrganization();
    const { organizationId, user, supabase } = ctx;
    const form = await request.formData();
    const compose = await parseComposeForm(form);
    const { connection, accessToken } = await getGmailAccess(organizationId, user.id);

    const raw = buildMimeMessage({
      from: connection.email,
      to: compose.to,
      cc: compose.cc || undefined,
      bcc: compose.bcc || undefined,
      subject: compose.subject,
      body: compose.body,
      attachments: compose.attachments,
      inReplyTo: compose.inReplyTo,
      references: compose.references,
    });

    let sent: { id: string; threadId: string };
    if (compose.draftId) {
      await updateGmailDraft(accessToken, compose.draftId, raw, compose.threadId);
      const draftSent = await sendGmailDraft(accessToken, compose.draftId);
      sent = { id: draftSent.id, threadId: draftSent.threadId };
    } else {
      sent = await sendGmailRaw(accessToken, raw, compose.threadId);
    }

    const allRecipientEmails = [
      ...recipientEmails(compose.to),
      ...recipientEmails(compose.cc),
      ...recipientEmails(compose.bcc),
    ];
    const matchedCustomer = compose.customerId
      ? { id: compose.customerId }
      : await matchCustomerByEmails(supabase, organizationId, allRecipientEmails);

    await recordMailHistory({
      organizationId,
      connectionId: connection.id,
      provider: "google",
      providerMessageId: sent.id,
      providerThreadId: sent.threadId,
      direction: "outgoing",
      fromEmail: connection.email,
      toEmails: recipientEmails(compose.to),
      ccEmails: recipientEmails(compose.cc),
      subject: compose.subject,
      snippet: compose.body.slice(0, 240),
      occurredAt: new Date().toISOString(),
      customerId: matchedCustomer?.id || null,
      quoteId: compose.quoteId || null,
      invoiceId: compose.invoiceId || null,
      projectId: compose.projectId || null,
      creditNoteId: compose.creditNoteId || null,
      paymentId: compose.paymentId || null,
      attachmentNames: compose.attachments.map((file) => file.filename),
      createdBy: user.id,
    });

    return NextResponse.json({
      ok: true,
      messageId: sent.id,
      threadId: sent.threadId,
      from: connection.email,
    });
  } catch (error) {
    console.error("MagniMail send failed", error);
    const message = error instanceof Error ? error.message : "Envoi impossible.";
    const status = message.includes("invalide") || message.includes("limite") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
