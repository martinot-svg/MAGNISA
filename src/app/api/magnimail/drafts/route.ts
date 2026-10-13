import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import {
  buildMimeMessage,
  createGmailDraft,
  getGmailAccess,
  updateGmailDraft,
} from "@/lib/google/gmail";
import { matchCustomerByEmails, recordMailHistory } from "@/lib/magnimail/history";
import { parseComposeForm, recipientEmails } from "@/lib/magnimail/compose";

export async function POST(request: NextRequest) {
  try {
    const { organizationId, user, supabase } = await requireOrganization();
    const compose = await parseComposeForm(await request.formData());
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

    const draft = compose.draftId
      ? await updateGmailDraft(accessToken, compose.draftId, raw, compose.threadId)
      : await createGmailDraft(accessToken, raw, compose.threadId);

    const recipientList = [
      ...recipientEmails(compose.to),
      ...recipientEmails(compose.cc),
      ...recipientEmails(compose.bcc),
    ];
    const customer = compose.customerId
      ? { id: compose.customerId }
      : await matchCustomerByEmails(supabase, organizationId, recipientList);

    const providerMessageId = draft.message?.id || `draft:${draft.id}`;
    await recordMailHistory({
      organizationId,
      connectionId: connection.id,
      provider: "google",
      providerMessageId,
      providerThreadId: draft.message?.threadId || compose.threadId || null,
      direction: "draft",
      fromEmail: connection.email,
      toEmails: recipientEmails(compose.to),
      ccEmails: recipientEmails(compose.cc),
      subject: compose.subject,
      snippet: compose.body.slice(0, 240),
      customerId: customer?.id || null,
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
      draftId: draft.id,
      messageId: draft.message?.id || null,
    });
  } catch (error) {
    console.error("MagniMail draft failed", error);
    const message = error instanceof Error ? error.message : "Impossible d'enregistrer le brouillon.";
    const status = message.includes("invalide") || message.includes("limite") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
