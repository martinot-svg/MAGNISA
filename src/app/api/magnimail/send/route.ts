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

    if (!provider.capabilities.send) {
      return NextResponse.json({ error: "Ce fournisseur ne permet pas l'envoi de messages." }, { status: 501 });
    }

    // Le fournisseur vérifie l'identité de la boîte sélectionnée. Aucun champ
    // d'expéditeur arbitraire fourni par le navigateur n'est accepté.
    const sent = await provider.sendMessage({
      context,
      message: composeForMailProvider(compose),
    });

    // En cas d'indisponibilité de l'historique commercial, ne jamais présenter
    // comme échoué un courrier déjà accepté par le fournisseur : l'utilisateur
    // risquerait d'envoyer une seconde fois le même message.
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
        providerMessageId: sent.messageId,
        providerThreadId: sent.threadId,
        direction: "outgoing",
        fromEmail: connection.email,
        toEmails: recipientEmails(compose.to),
        ccEmails: recipientEmails(compose.cc),
        subject: compose.subject,
        snippet: compose.body.slice(0, 240),
        occurredAt: new Date().toISOString(),
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
      console.error("MGMail message sent, but CRM history sync failed", historyError);
    }

    return NextResponse.json({
      ok: true,
      messageId: sent.messageId,
      threadId: sent.threadId,
      from: connection.email,
    });
  } catch (error) {
    console.error("MGMail send failed", error);
    if (error instanceof Error && /invalide|limite|dépassent/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const detail = mailProviderHttpError(error);
    return NextResponse.json({ error: detail.error }, { status: detail.status });
  }
}
