export type ComposePayload = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  draftId?: string;
  customerId?: string;
  quoteId?: string;
  invoiceId?: string;
  projectId?: string;
  creditNoteId?: string;
  paymentId?: string;
  attachments: Array<{ data: Buffer; filename: string; mimeType: string }>;
};

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function addresses(value: string) {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function parseComposeForm(form: FormData): Promise<ComposePayload> {
  const to = String(form.get("to") || "").trim();
  const cc = String(form.get("cc") || "").trim();
  const bcc = String(form.get("bcc") || "").trim();
  const subject = String(form.get("subject") || "").trim();
  const body = String(form.get("body") || "").trim();

  const allRecipients = [...addresses(to), ...addresses(cc), ...addresses(bcc)];
  if (!addresses(to).length || allRecipients.some((email) => !validEmail(email))) {
    throw new Error("Adresse e-mail destinataire invalide.");
  }
  if (!subject || subject.length > 180) throw new Error("Objet e-mail invalide.");
  if (!body || body.length > 50_000) throw new Error("Message e-mail invalide.");

  const attachments: ComposePayload["attachments"] = [];
  let total = 0;
  for (const entry of form.getAll("attachments")) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    total += entry.size;
    if (entry.size > 12 * 1024 * 1024 || total > 20 * 1024 * 1024) {
      throw new Error("Les pièces jointes dépassent la limite MagniMail de 20 Mo.");
    }
    const filename = entry.name.replace(/[\r\n"\\/]+/g, "_").slice(0, 180) || "piece-jointe";
    attachments.push({
      data: Buffer.from(await entry.arrayBuffer()),
      filename,
      mimeType: entry.type || "application/octet-stream",
    });
  }

  const optional = (key: string) => {
    const value = String(form.get(key) || "").trim();
    return value || undefined;
  };

  return {
    to,
    cc,
    bcc,
    subject,
    body,
    threadId: optional("threadId"),
    inReplyTo: optional("inReplyTo"),
    references: optional("references"),
    draftId: optional("draftId"),
    customerId: optional("customerId"),
    quoteId: optional("quoteId"),
    invoiceId: optional("invoiceId"),
    projectId: optional("projectId"),
    creditNoteId: optional("creditNoteId"),
    paymentId: optional("paymentId"),
    attachments,
  };
}

export function recipientEmails(value: string) {
  return addresses(value).map((item) => item.toLowerCase());
}
