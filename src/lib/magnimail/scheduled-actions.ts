import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeInternetAddress } from "./internet-resend";
import { validateScheduledContent } from "./scheduled";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function scheduleMGMailInternet(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const identityId = String(form.get("identityId") || "");
  const requestKey = String(form.get("requestKey") || "");
  if (!UUID.test(identityId) || !UUID.test(requestKey)) {
    throw new Error("Identifiants de programmation invalides.");
  }
  const payload = validateScheduledContent({
    to: String(form.get("to") || ""),
    subject: String(form.get("subject") || ""),
    body: String(form.get("body") || ""),
    when: String(form.get("when") || ""),
  });

  const { data: identity, error } = await ctx.supabase
    .from("mgmail_external_identities")
    .select("id,mailbox_id,email_address,status")
    .eq("id", identityId).eq("organization_id", ctx.organizationId)
    .eq("status", "active").maybeSingle();
  if (error || !identity) {
    throw new Error("Adresse MGMail Internet indisponible ou non vérifiée.");
  }
  const { data: allowed, error: grantError } = await ctx.supabase
    .rpc("mgmail_can_external_access", {
      p_org: ctx.organizationId,
      p_mailbox: identity.mailbox_id,
      p_action: "send",
    });
  if (grantError || allowed !== true) {
    throw new Error("Vous ne disposez pas du droit d'envoi externe sur cette boîte.");
  }

  const admin = createAdminClient();
  const { error: insertError } = await admin.from("mgmail_external_messages")
    .insert({
      organization_id: ctx.organizationId,
      identity_id: identity.id,
      direction: "outgoing",
      source_kind: "scheduled",
      status: "queued",
      scheduled_at: payload.scheduledAt,
      from_email: normalizeInternetAddress(identity.email_address),
      to_emails: payload.to,
      subject: payload.subject,
      body_text: payload.body,
      request_key: requestKey,
      created_by: ctx.user.id,
    });
  if (insertError && insertError.code !== "23505") {
    throw new Error("Impossible de programmer cet e-mail dans MGMail.");
  }
  revalidatePath("/magnimail/externe");
}

export async function cancelScheduledMGMail(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const messageId = String(form.get("messageId") || "");
  if (!UUID.test(messageId)) throw new Error("Programmation invalide.");

  // Atomic cancellation: a message already claimed by the worker cannot
  // be cancelled, nor can one employee cancel another employee's mailing.
  const admin = createAdminClient();
  const { data: cancelled, error } = await admin.from("mgmail_external_messages")
    .update({ status: "failed", last_error: "Envoi programmé annulé par son auteur.",
      updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organizationId)
    .eq("id", messageId)
    .eq("created_by", ctx.user.id)
    .eq("source_kind", "scheduled")
    .eq("status", "queued")
    .select("id").maybeSingle();
  if (error || !cancelled) {
    throw new Error("Ce message est déjà en cours, envoyé ou non autorisé.");
  }
  revalidatePath("/magnimail/externe");
}

export async function configureMGMailBillingPreavis(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  if (!await hasPermission(ctx, "orders.manage") ||
      !await hasPermission(ctx, "users.manage")) {
    throw new Error("Seuls les responsables habilités peuvent activer les préavis externes.");
  }
  const contractId = String(form.get("contractId") || "");
  const identityId = String(form.get("identityId") || "");
  if (!UUID.test(contractId) || !UUID.test(identityId)) {
    throw new Error("Contrat ou adresse de préavis invalide.");
  }
  const enabled = form.get("enabled") === "on";
  const recipientConfirmed = form.get("recipientConfirmed") === "on";
  if (enabled && !recipientConfirmed) {
    throw new Error("Confirmez le destinataire du client avant toute activation.");
  }
  const [contractResult, identityResult] = await Promise.all([
    ctx.supabase.from("recurring_service_contracts")
      .select("id,customer_id,status").eq("organization_id", ctx.organizationId)
      .eq("id", contractId).maybeSingle(),
    ctx.supabase.from("mgmail_external_identities")
      .select("id,mailbox_id,status")
      .eq("organization_id", ctx.organizationId)
      .eq("id", identityId).eq("status", "active").maybeSingle(),
  ]);
  if (contractResult.error || !contractResult.data ||
      identityResult.error || !identityResult.data ||
      (enabled && contractResult.data.status !== "active")) {
    throw new Error("Contrat actif ou adresse Internet vérifiée introuvable.");
  }
  const { data: authorized, error: permissionError } = await ctx.supabase
    .rpc("mgmail_can_external_access", {
      p_org: ctx.organizationId,
      p_mailbox: identityResult.data.mailbox_id,
      p_action: "send",
    });
  if (permissionError || authorized !== true) {
    throw new Error("Envoi Internet non autorisé depuis cette boîte.");
  }
  if (enabled) {
    const { data: customer, error: customerError } = await ctx.supabase
      .from("customers").select("email,is_active")
      .eq("organization_id", ctx.organizationId)
      .eq("id", contractResult.data.customer_id).maybeSingle();
    if (customerError || !customer || !customer.is_active || !customer.email) {
      throw new Error("Le client doit être actif et disposer d'une adresse e-mail valide.");
    }
    normalizeInternetAddress(customer.email);
  }
  const { error } = await ctx.supabase.from("mgmail_preavis_delivery_configs")
    .upsert({
      organization_id: ctx.organizationId,
      recurring_contract_id: contractId,
      identity_id: identityId,
      enabled,
      recipient_confirmed: recipientConfirmed,
      configured_by: ctx.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,recurring_contract_id" });
  if (error) throw new Error("Impossible d'enregistrer l'autorisation de préavis MGMail.");
  revalidatePath("/magnimail/preavis");
}
