import { createAdminClient } from "@/lib/supabase/admin";

export type MailHistoryInput = {
  organizationId: string;
  connectionId?: string | null;
  provider?: "google" | "microsoft";
  providerMessageId: string;
  providerThreadId?: string | null;
  direction: "incoming" | "outgoing" | "draft";
  fromEmail?: string | null;
  toEmails?: string[];
  ccEmails?: string[];
  subject?: string | null;
  snippet?: string | null;
  occurredAt?: string | null;
  customerId?: string | null;
  quoteId?: string | null;
  invoiceId?: string | null;
  projectId?: string | null;
  creditNoteId?: string | null;
  paymentId?: string | null;
  attachmentNames?: string[];
  createdBy?: string | null;
};

export async function recordMailHistory(input: MailHistoryInput) {
  const admin = createAdminClient();
  const { error } = await admin.from("email_history").upsert({
    organization_id: input.organizationId,
    connection_id: input.connectionId || null,
    provider: input.provider || "google",
    provider_message_id: input.providerMessageId,
    provider_thread_id: input.providerThreadId || null,
    direction: input.direction,
    from_email: input.fromEmail || null,
    to_emails: input.toEmails || [],
    cc_emails: input.ccEmails || [],
    subject: input.subject || null,
    snippet: input.snippet || null,
    occurred_at: input.occurredAt || new Date().toISOString(),
    customer_id: input.customerId || null,
    quote_id: input.quoteId || null,
    invoice_id: input.invoiceId || null,
    project_id: input.projectId || null,
    credit_note_id: input.creditNoteId || null,
    payment_id: input.paymentId || null,
    attachment_names: input.attachmentNames || [],
    created_by: input.createdBy || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,provider,provider_message_id" });
  if (error) throw new Error(error.message);
}

export async function matchCustomerByEmails(
  supabase: any,
  organizationId: string,
  emails: string[],
): Promise<{ id: string; name: string; email: string } | null> {
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return null;
  const { data = [], error } = await supabase
    .from("customers")
    .select("id,name,email")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .not("email", "is", null);
  if (error) throw new Error(error.message);
  return (
    (data as Array<{ id: string; name: string; email: string }>).find((c) =>
      wanted.has(String(c.email || "").trim().toLowerCase()),
    ) || null
  );
}
