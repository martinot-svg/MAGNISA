export const DEFAULT_EMAIL_TEMPLATES = [
  {
    key: "quote_send",
    name: "Envoi de devis",
    subject: "Devis {{numero}}",
    body: "Bonjour {{client}},\n\nVeuillez trouver ci-joint notre devis {{numero}}.\n\nNous restons à votre disposition pour toute question.\n\nCordialement.",
  },
  {
    key: "invoice_send",
    name: "Envoi de facture",
    subject: "Facture {{numero}}",
    body: "Bonjour {{client}},\n\nVeuillez trouver ci-joint la facture {{numero}}.\n\nCordialement.",
  },
  {
    key: "invoice_reminder",
    name: "Relance facture impayée",
    subject: "Relance — facture {{numero}}",
    body: "Bonjour {{client}},\n\nSauf erreur de notre part, la facture {{numero}} reste à régler.\n\nMerci de nous confirmer la date prévue de règlement.\n\nCordialement.",
  },
  {
    key: "payment_confirmation",
    name: "Confirmation de paiement",
    subject: "Confirmation de paiement — {{numero}}",
    body: "Bonjour {{client}},\n\nNous confirmons la bonne réception de votre règlement concernant {{numero}}.\n\nMerci pour votre confiance.\n\nCordialement.",
  },
  {
    key: "thanks",
    name: "Remerciement",
    subject: "Merci pour votre confiance",
    body: "Bonjour {{client}},\n\nNous vous remercions pour votre confiance et restons à votre disposition.\n\nCordialement.",
  },
  {
    key: "free_message",
    name: "Message libre",
    subject: "",
    body: "Bonjour {{client}},\n\n\n\nCordialement.",
  },
] as const;

export type EmailTemplateKey = (typeof DEFAULT_EMAIL_TEMPLATES)[number]["key"];

export function renderEmailTemplate(
  value: string,
  data: Record<string, string | number | null | undefined>,
) {
  return value.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => {
    const replacement = data[key];
    return replacement == null ? "" : String(replacement);
  });
}

export async function getEmailTemplate(
  supabase: any,
  organizationId: string,
  key: EmailTemplateKey,
) {
  const fallback = DEFAULT_EMAIL_TEMPLATES.find((item) => item.key === key)!;
  const { data } = await supabase
    .from("email_templates")
    .select("template_key,name,subject_template,body_template,is_active")
    .eq("organization_id", organizationId)
    .eq("template_key", key)
    .eq("is_active", true)
    .maybeSingle();

  return data
    ? {
        key: data.template_key as EmailTemplateKey,
        name: data.name,
        subject: data.subject_template,
        body: data.body_template,
      }
    : fallback;
}
