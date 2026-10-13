import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { renderPdf } from "@/lib/pdf/document";
import { buildMimeMessage, getGmailAccess, sendGmailRaw } from "@/lib/google/gmail";
import { recordMailHistory } from "@/lib/magnimail/history";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const { type, id } = await params;
    if (!["quote", "invoice"].includes(type)) {
      return NextResponse.json({ error: "Type de document invalide." }, { status: 400 });
    }

    const ctx = await requireOrganization();
    await requirePermission(ctx, type === "quote" ? "sales.view" : "billing.view");
    const { supabase, organizationId, user } = ctx;

    const payload = (await request.json().catch((): null => null)) as
      { to?: string; subject?: string; body?: string } | null;

    const to = String(payload?.to || "").trim().toLowerCase();
    const subject = String(payload?.subject || "").trim();
    const body = String(payload?.body || "").trim();

    if (!validEmail(to)) {
      return NextResponse.json({ error: "Adresse e-mail destinataire invalide." }, { status: 400 });
    }
    if (!subject || subject.length > 180) {
      return NextResponse.json({ error: "Objet e-mail invalide." }, { status: 400 });
    }
    if (!body || body.length > 20_000) {
      return NextResponse.json({ error: "Message e-mail invalide." }, { status: 400 });
    }

    const isQuote = type === "quote";
    const table = isQuote ? "quotes" : "invoices";
    const lineTable = isQuote ? "quote_lines" : "invoice_lines";
    const fk = isQuote ? "quote_id" : "invoice_id";

    const [{ data: doc }, { data: lines }, { data: org }, { data: settings }, { data: template }] =
      await Promise.all([
        supabase
          .from(table)
          .select("*,customers(name,email)")
          .eq("organization_id", organizationId)
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from(lineTable)
          .select("*")
          .eq("organization_id", organizationId)
          .eq(fk, id)
          .order("sort_order"),
        supabase
          .from("organizations")
          .select("name,currency")
          .eq("id", organizationId)
          .single(),
        supabase
          .from("company_settings")
          .select("*")
          .eq("organization_id", organizationId)
          .maybeSingle(),
        supabase
          .from("document_templates")
          .select("configuration")
          .eq("organization_id", organizationId)
          .eq("document_type", type)
          .eq("is_default", true)
          .limit(1)
          .maybeSingle(),
      ]);

    if (!doc) {
      return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    }

    const pdfBuffer = await renderPdf({
      type: isQuote ? "DEVIS" : "FACTURE",
      number: doc.number,
      company: settings?.trade_name || settings?.legal_name || org?.name || "Entreprise",
      slogan: settings?.slogan,
      companyAddress: settings?.address,
      logoUrl: settings?.logo_url,
      taxId: settings?.tax_id,
      statId: settings?.stat_id,
      registryId: settings?.registry_id,
      bankDetails: settings?.bank_details,
      customer: doc.customers?.name || "Client",
      issueDate: doc.issue_date,
      dueDate: isQuote ? doc.valid_until : doc.due_date,
      lines: (lines || []).map((line: any) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unit_price),
        discountPct: Number(line.discount_pct),
        taxRate: Number(line.tax_rate),
        total: Number(line.line_total),
      })),
      subtotal: Number(doc.subtotal),
      discountTotal: Number(doc.discount_total || 0),
      taxTotal: Number(doc.tax_total),
      total: Number(doc.total),
      paidAmount: isQuote ? undefined : Number(doc.paid_amount || 0),
      balanceDue: isQuote ? undefined : Number(doc.balance_due || 0),
      currency: org?.currency || "MGA",
      paymentTerms: settings?.payment_terms,
      legalMentions: settings?.legal_mentions,
      template: template?.configuration || undefined,
    });

    const { connection, accessToken } = await getGmailAccess(organizationId, user.id);
    const raw = buildMimeMessage({
      from: connection.email,
      to,
      subject,
      body,
      pdf: Buffer.from(pdfBuffer),
      filename: `${doc.number}.pdf`,
    });

    const sent = await sendGmailRaw(accessToken, raw);

    await recordMailHistory({
      organizationId,
      connectionId: connection.id,
      provider: "google",
      providerMessageId: sent.id,
      providerThreadId: sent.threadId,
      direction: "outgoing",
      fromEmail: connection.email,
      toEmails: [to],
      subject,
      snippet: body.slice(0, 240),
      occurredAt: new Date().toISOString(),
      customerId: doc.customer_id || null,
      quoteId: isQuote ? doc.id : doc.quote_id || null,
      invoiceId: isQuote ? null : doc.id,
      attachmentNames: [`${doc.number}.pdf`],
      createdBy: user.id,
    });

    return NextResponse.json({
      ok: true,
      messageId: sent.id,
      from: connection.email,
    });
  } catch (error) {
    console.error("Document Gmail send failed", error);
    const message = error instanceof Error ? error.message : "Envoi impossible.";
    const status = message.includes("Aucun compte Gmail") || message.includes("connexion Gmail") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
