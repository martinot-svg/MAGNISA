import { requireOrganization } from "@/lib/current-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeInternetAddress, parseInternetRecipients, sendResendInternetEmail } from "./internet-resend";

export type SendInternetInput = {
  identityId: string;
  to: string;
  subject: string;
  body: string;
  requestKey: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sendMGMailInternet(input: SendInternetInput) {
  const ctx = await requireOrganization();
  if (!UUID.test(input.identityId) || !UUID.test(input.requestKey)) {
    throw new Error("Identifiant d'envoi invalide.");
  }
  const to = parseInternetRecipients(input.to);
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || subject.length > 180 || !body || body.length > 50000) {
    throw new Error("Objet ou message invalide.");
  }

  // The identity has been activated by an operator with a verified sending
  // domain. It cannot be created or activated by an ordinary browser session.
  const { data: identity, error: identityError } = await ctx.supabase
    .from("mgmail_external_identities")
    .select("id,organization_id,mailbox_id,email_address,status,provider")
    .eq("id", input.identityId)
    .eq("organization_id", ctx.organizationId)
    .eq("status", "active")
    .maybeSingle();
  if (identityError || !identity || identity.provider !== "resend") {
    throw new Error("Aucune adresse Internet MGMail active et autorisée pour cette entreprise.");
  }
  const { data: permitted, error: permissionError } = await ctx.supabase
    .rpc("mgmail_can_external_access", {
      p_org: ctx.organizationId,
      p_mailbox: identity.mailbox_id,
      p_action: "send",
    });
  if (permissionError || permitted !== true) {
    throw new Error("Vous n'êtes pas autorisé à envoyer des e-mails externes depuis cette boîte.");
  }
  const fromEmail = normalizeInternetAddress(identity.email_address);
  const admin = createAdminClient();

  // UNIQUE(identity_id,request_key) + an atomic queued -> sending transition
  // prevent concurrent form submissions from sending the same message twice.
  let { data: item, error: insertError } = await admin
    .from("mgmail_external_messages")
    .insert({
      organization_id: ctx.organizationId,
      identity_id: identity.id,
      direction: "outgoing",
      status: "queued",
      from_email: fromEmail,
      to_emails: to,
      subject,
      body_text: body,
      request_key: input.requestKey,
      created_by: ctx.user.id,
    })
    .select("id,status,created_by")
    .single();

  if (insertError?.code === "23505") {
    const previous = await admin.from("mgmail_external_messages")
      .select("id,status,created_by")
      .eq("identity_id", identity.id)
      .eq("request_key", input.requestKey)
      .maybeSingle();
    if (previous.error || !previous.data || previous.data.created_by !== ctx.user.id) {
      throw new Error("Cette demande d'envoi est déjà utilisée.");
    }
    item = previous.data;
    insertError = null;
  }
  if (insertError || !item) {
    throw new Error("Impossible d'enregistrer cette demande d'envoi.");
  }

  if (item.status !== "queued") {
    return { id: item.id as string, status: item.status as string };
  }

  const claimed = await admin.from("mgmail_external_messages")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", item.id).eq("status", "queued").select("id").maybeSingle();
  if (claimed.error) throw new Error("Impossible de réserver cette tentative d'envoi.");
  if (!claimed.data) return { id: item.id as string, status: "sending" };

  const apiKey = process.env.MGMAIL_RESEND_API_KEY;
  if (!apiKey) {
    await admin.from("mgmail_external_messages")
      .update({
        status: "failed", last_error: "Canal Internet MGMail non configuré.",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
    return { id: item.id as string, status: "failed" };
  }

  try {
    const delivered = await sendResendInternetEmail({
      apiKey, from: fromEmail, to, subject, body, requestId: item.id,
    });
    const { error } = await admin.from("mgmail_external_messages")
      .update({
        status: "accepted", provider_email_id: delivered.id,
        last_error: null, updated_at: new Date().toISOString(),
      }).eq("id", item.id).eq("status", "sending");
    if (error) throw new Error("Confirmation fournisseur non enregistrée.");
    return { id: item.id as string, status: "accepted" };
  } catch (err) {
    // A timeout or storage failure does not establish that the message was
    // NOT delivered. Do not blindly resend with a different token.
    const definitive = err instanceof Error && /envoi refusé \(HTTP/.test(err.message);
    const status = definitive ? "failed" : "uncertain";
    await admin.from("mgmail_external_messages")
      .update({
        status,
        last_error: definitive ? "Le fournisseur a refusé le message." :
          "Résultat d'expédition non confirmé ; vérifier avant tout nouvel envoi.",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id).eq("status", "sending");
    return { id: item.id as string, status };
  }
}
