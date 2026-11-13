import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { matchCustomerByEmails, recordMailHistory } from "@/lib/magnimail/history";
import { parseComposeForm, recipientEmails } from "@/lib/magnimail/compose";
import { composeForMailProvider } from "@/lib/magnimail/providers/compose";
import { mailProviderHttpError, resolveUserMailProvider } from "@/lib/magnimail/providers/resolve";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireOrganization();
    const compose = await parseComposeForm(await request.formData());
    const { provider, context, connection } = await resolveUserMailProvider(
      ctx, request.nextUrl.searchParams.get("connectionId"),
    );

    if (!provider.capabilities.drafts) {
      return NextResponse.json({ error: "Ce fournisseur ne gère pas les brouillons." }, { status: 501 });
    }

    const draft = await provider.saveDraft({
      context,
      message: composeForMailProvider(compose),
      draftId: compose.draftId,
    });

    // A failure in the optional CRM history must not turn a saved draft into a
    // false error that prompts the user to create the same draft again.
    try {
      const recipients = [
        ...recipientEmails(compose.to),
        ...recipientEmails(compose.cc),
        ...recipientEmails(compose.bcc),
      ];
      const customer = compose.customerId
        ? { id: compose.customerId }
        : await matchCustomerByEmails(ctx.supabase, ctx.organizationId, recipients);

      await recordMailHistory({
        organizationId: ctx.organizationId,
        connectionId: connection.id,
        provider: provider.provider,
        providerMessageId: draft.messageId || `draft:${draft.draftId}`,
        providerThreadId: compose.threadId || null,
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
        createdBy: ctx.user.id,
      });
    } catch (historyError) {
      console.error("MGMail draft saved, but history sync failed", historyError);
    }

    return NextResponse.json({
      ok: true,
      draftId: draft.draftId,
      messageId: draft.messageId,
    });
  } catch (error) {
    console.error("MGMail draft failed", error);
    if (error instanceof Error && /invalide|limite|dépassent/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const detail = mailProviderHttpError(error);
    return NextResponse.json({ error: detail.error }, { status: detail.status });
  }
}
