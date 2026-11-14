import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeInternetAddress, sendResendInternetEmail } from "./internet-resend";
import { defaultPreavisRules, normalizePreavisRules } from "./preavis-config";
import { dueBillingPreavis, madagascarCivilDate } from "./scheduled";

type Admin = ReturnType<typeof createAdminClient>;
const MAX_SCAN = 1500;
const PAGE = 150;
const BATCH = 15;

function readConfigRules(value: unknown) {
  try {
    return normalizePreavisRules(value);
  } catch {
    return null;
  }
}

/** Aucune émission si l'activation EXPLICITE et la clé ne sont pas présentes. */
export function scheduledInternetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MGMAIL_AUTO_SEND_ENABLED === "true" && !!env.MGMAIL_RESEND_API_KEY;
}

async function isCurrentMemberAllowed(
  admin: Admin, org: string, mailboxId: string, userId: string,
): Promise<boolean> {
  const [member, mailbox, grants] = await Promise.all([
    admin.from("organization_members").select("user_id")
      .eq("organization_id", org).eq("user_id", userId)
      .eq("status", "active").maybeSingle(),
    admin.from("mgmail_internal_mailboxes")
      .select("id,owner_user_id,is_active,can_send,can_external_send")
      .eq("organization_id", org).eq("id", mailboxId).maybeSingle(),
    admin.from("mgmail_internal_mailbox_grants")
      .select("user_id,is_active,can_send,can_external_send")
      .eq("organization_id", org).eq("mailbox_id", mailboxId)
      .eq("user_id", userId).maybeSingle(),
  ]);
  if (member.error || mailbox.error || grants.error || !member.data ||
      !mailbox.data || !mailbox.data.is_active) return false;
  return (mailbox.data.owner_user_id === userId &&
    mailbox.data.can_send && mailbox.data.can_external_send) ||
    (!!grants.data && grants.data.is_active &&
      grants.data.can_send && grants.data.can_external_send);
}

/**
 * Planifie uniquement le préavis du jour pour les contrats encore actifs,
 * autorisés explicitement, avec un client et une identité de retour valides.
 * Le changement d'une échéance crée une nouvelle identité d'événement,
 * tandis qu'une même échéance/offset ne peut JAMAIS être dupliquée.
 */
export async function queueDueBillingPreavis(admin: Admin, now: Date): Promise<number> {
  const today = madagascarCivilDate(now);
  let queued = 0;
  for (let start = 0; start < MAX_SCAN; start += PAGE) {
    const page = await admin.from("mgmail_preavis_delivery_configs")
      .select("organization_id,recurring_contract_id,identity_id,configured_by")
      .eq("enabled", true).eq("recipient_confirmed", true)
      .order("organization_id").order("recurring_contract_id")
      .range(start, start + PAGE - 1);
    if (page.error) throw new Error("Chargement des autorisations de préavis impossible.");
    const items = page.data || [];
    if (!items.length) break;

    const ids = [...new Set(items.map((row) => row.recurring_contract_id))];
    const orgIds = [...new Set(items.map((row) => row.organization_id))];
    const identityIds = [...new Set(items.map((row) => row.identity_id))];
    const [contractsResult, identitiesResult, policiesResult, orgsResult] = await Promise.all([
      admin.from("recurring_service_contracts")
        .select("id,organization_id,customer_id,description,next_billing_date,end_date,status")
        .in("id", ids).eq("status", "active"),
      admin.from("mgmail_external_identities")
        .select("id,organization_id,email_address,mailbox_id,status,provider,receive_enabled")
        .in("id", identityIds).eq("status", "active").eq("provider", "resend"),
      admin.from("mgmail_preavis_policies")
        .select("organization_id,recurring_contract_id,enabled,rules")
        .in("organization_id", orgIds),
      admin.from("organizations").select("id,name").in("id", orgIds),
    ]);
    if (contractsResult.error || identitiesResult.error || policiesResult.error || orgsResult.error) {
      throw new Error("Données de facturation MGMail inaccessibles.");
    }
    const contracts = contractsResult.data || [];
    const customerIds = [...new Set(contracts.map((contract) => contract.customer_id))];
    const customersResult = await admin.from("customers")
      .select("id,organization_id,name,email,is_active").in("id", customerIds);
    if (customersResult.error) throw new Error("Consultation clients MGMail impossible.");

    // Une facture déjà préparée pour l'échéance rend le préavis inutile.
    const invoicesResult = await admin.from("invoices")
      .select("organization_id,recurring_contract_id,service_period_start")
      .in("recurring_contract_id", ids);
    if (invoicesResult.error) throw new Error("Vérification des factures déjà émises impossible.");
    const invoiceKeys = new Set((invoicesResult.data || []).map((invoice) =>
      `${invoice.organization_id}:${invoice.recurring_contract_id}:${invoice.service_period_start}`));

    const contractsById = new Map(contracts.map((c) => [c.id, c]));
    const customersById = new Map((customersResult.data || []).map((c) => [c.id, c]));
    const identitiesById = new Map((identitiesResult.data || []).map((i) => [i.id, i]));
    const orgsById = new Map((orgsResult.data || []).map((o) => [o.id, o]));
    const policyByKey = new Map((policiesResult.data || []).map((p) => [
      `${p.organization_id}:${p.recurring_contract_id || "default"}`, p,
    ]));

    for (const config of items) {
      const contract = contractsById.get(config.recurring_contract_id);
      const identity = identitiesById.get(config.identity_id);
      if (!contract || !identity ||
          contract.organization_id !== config.organization_id ||
          identity.organization_id !== config.organization_id ||
          !identity.receive_enabled ||
          (contract.end_date && contract.next_billing_date > contract.end_date)) continue;
      const customer = customersById.get(contract.customer_id);
      const org = orgsById.get(config.organization_id);
      if (!customer?.is_active || customer.organization_id !== config.organization_id ||
          !customer.email || !org?.name) continue;
      const policy = policyByKey.get(`${config.organization_id}:${contract.id}`)
        || policyByKey.get(`${config.organization_id}:default`);
      if (policy && !policy.enabled) continue;
      const rules = policy ? readConfigRules(policy.rules) : defaultPreavisRules();
      if (!rules) continue;
      const hasInvoice = invoiceKeys.has(
        `${config.organization_id}:${contract.id}:${contract.next_billing_date}`);
      let due;
      try {
        due = dueBillingPreavis({
          today, billingDate: contract.next_billing_date,
          contractStatus: contract.status,
          rules, companyName: org.name,
          customerName: customer.name || "client",
          serviceName: contract.description,
          recipient: customer.email,
          alreadyIssued: hasInvoice,
        });
      } catch {
        // L'adresse du client ou le contrat est malformé ; ne jamais expédier.
        continue;
      }
      for (const reminder of due) {
        const { error } = await admin.from("mgmail_external_messages").insert({
          organization_id: config.organization_id,
          identity_id: identity.id,
          direction: "outgoing", source_kind: "billing_preavis",
          status: "queued", scheduled_at: now.toISOString(),
          from_email: normalizeInternetAddress(identity.email_address),
          to_emails: [reminder.recipient],
          subject: reminder.subject, body_text: reminder.body,
          recurring_contract_id: contract.id,
          preavis_billing_date: contract.next_billing_date,
          preavis_days_before: reminder.daysBefore,
          created_by: config.configured_by,
        });
        if (error && error.code !== "23505") {
          throw new Error("Impossible de dédupliquer les préavis MGMail.");
        }
        if (!error) queued++;
      }
    }
    if (items.length < PAGE) break;
  }
  return queued;
}

async function billingNoticeStillValid(
  admin: Admin,
  message: {
    organization_id: string;
    identity_id: string;
    recurring_contract_id: string | null;
    preavis_billing_date: string | null;
    preavis_days_before: number | null;
    to_emails: string[];
    subject: string;
    body_text: string;
  },
  today: string,
): Promise<boolean> {
  if (!message.recurring_contract_id || !message.preavis_billing_date ||
      !message.preavis_days_before) return false;
  const [config, contract, policyResult, orgResult] = await Promise.all([
    admin.from("mgmail_preavis_delivery_configs").select("identity_id,enabled,recipient_confirmed")
      .eq("organization_id", message.organization_id)
      .eq("recurring_contract_id", message.recurring_contract_id).maybeSingle(),
    admin.from("recurring_service_contracts")
      .select("id,customer_id,description,status,next_billing_date,end_date")
      .eq("organization_id", message.organization_id)
      .eq("id", message.recurring_contract_id).maybeSingle(),
    admin.from("mgmail_preavis_policies").select("recurring_contract_id,enabled,rules")
      .eq("organization_id", message.organization_id),
    admin.from("organizations").select("name")
      .eq("id", message.organization_id).maybeSingle(),
  ]);
  if (config.error || contract.error || policyResult.error || orgResult.error ||
      !config.data?.enabled || !config.data?.recipient_confirmed ||
      config.data.identity_id !== message.identity_id ||
      contract.data?.status !== "active" ||
      contract.data.next_billing_date !== message.preavis_billing_date ||
      (contract.data.end_date && contract.data.next_billing_date > contract.data.end_date) ||
      !orgResult.data?.name) return false;

  const [customer, invoice] = await Promise.all([
    admin.from("customers").select("name,email,is_active")
      .eq("organization_id", message.organization_id)
      .eq("id", contract.data.customer_id).maybeSingle(),
    admin.from("invoices").select("id")
      .eq("organization_id", message.organization_id)
      .eq("recurring_contract_id", contract.data.id)
      .eq("service_period_start", message.preavis_billing_date).limit(1),
  ]);
  if (customer.error || invoice.error || !customer.data?.is_active ||
      !customer.data.email || (invoice.data || []).length > 0) return false;

  const policies = policyResult.data || [];
  const policy = policies.find((item) => item.recurring_contract_id === contract.data.id)
    || policies.find((item) => item.recurring_contract_id === null);
  if (policy && !policy.enabled) return false;
  const rules = policy ? readConfigRules(policy.rules) : defaultPreavisRules();
  if (!rules) return false;

  try {
    return dueBillingPreavis({
      today, billingDate: contract.data.next_billing_date,
      contractStatus: contract.data.status,
      rules, companyName: orgResult.data.name,
      customerName: customer.data.name || "client",
      serviceName: contract.data.description,
      recipient: customer.data.email,
    }).some((notice) =>
      notice.daysBefore === message.preavis_days_before &&
      notice.subject === message.subject && notice.body === message.body_text &&
      message.to_emails.length === 1 && message.to_emails[0] === notice.recipient);
  } catch {
    return false;
  }
}

async function deliverOne(
  admin: Admin,
  message: {
    id: string; identity_id: string; organization_id: string;
    from_email: string; to_emails: string[];
    subject: string; body_text: string; created_by: string | null;
    source_kind: string; recurring_contract_id: string | null;
    preavis_billing_date: string | null; preavis_days_before: number | null;
    scheduled_at: string | null;
  },
  now: Date, apiKey: string,
  transport: typeof fetch,
): Promise<"accepted" | "cancelled" | "uncertain"> {
  const today = madagascarCivilDate(now);
  const identity = await admin.from("mgmail_external_identities")
    .select("id,mailbox_id,email_address,status,provider,receive_enabled")
    .eq("id", message.identity_id).eq("organization_id", message.organization_id)
    .maybeSingle();
  let authorized = !identity.error && !!identity.data &&
    identity.data.status === "active" && identity.data.provider === "resend" &&
    identity.data.email_address === message.from_email;

  // No old reminder or stale/manual send after a prolonged outage.
  if (!message.scheduled_at || now.getTime() -
      new Date(message.scheduled_at).getTime() > 24 * 3600000) authorized = false;

  if (authorized && message.source_kind === "billing_preavis") {
    authorized = !!identity.data?.receive_enabled && await billingNoticeStillValid(admin, message, today);
  } else if (authorized && message.source_kind === "scheduled") {
    authorized = !!message.created_by && !!identity.data &&
      await isCurrentMemberAllowed(
        admin, message.organization_id, identity.data.mailbox_id,
        message.created_by);
  } else {
    authorized = false;
  }

  // The update is atomic. Only a job currently queued can be claimed.
  if (!authorized) {
    await admin.from("mgmail_external_messages").update({
      status: "cancelled",
      last_error: "Conditions d'envoi non remplies ou autorisation retirée.",
      updated_at: now.toISOString(),
    }).eq("id", message.id).eq("status", "queued");
    return "cancelled";
  }
  const claimed = await admin.from("mgmail_external_messages")
    .update({ status: "sending", updated_at: now.toISOString() })
    .eq("id", message.id).eq("status", "queued")
    .lte("scheduled_at", now.toISOString()).select("id").maybeSingle();
  if (claimed.error || !claimed.data) return "cancelled";

  try {
    const response = await sendResendInternetEmail({
      apiKey, from: message.from_email, to: message.to_emails,
      subject: message.subject, body: message.body_text,
      requestId: message.id,
    }, transport);
    const saved = await admin.from("mgmail_external_messages")
      .update({
        status: "accepted", provider_email_id: response.id,
        last_error: null, updated_at: new Date().toISOString(),
      }).eq("id", message.id).eq("status", "sending").select("id").maybeSingle();
    if (saved.error || !saved.data) throw new Error("Confirmation fournisseur non enregistrée.");
    return "accepted";
  } catch {
    // An ambiguous timeout may still mean that the external provider accepted
    // the message: never retry blindly or send an untracked duplicate.
    await admin.from("mgmail_external_messages").update({
      status: "uncertain",
      last_error: "Résultat non confirmé : vérifier l'envoi avant toute relance.",
      updated_at: new Date().toISOString(),
    }).eq("id", message.id).eq("status", "sending");
    return "uncertain";
  }
}

export async function runMGMailScheduledDispatch(
  options: {
    now?: Date;
    admin?: Admin;
    transport?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const env = options.env || process.env;
  if (!scheduledInternetEnabled(env)) {
    return { enabled: false, queuedPreavis: 0, accepted: 0, cancelled: 0, uncertain: 0 };
  }
  const now = options.now || new Date();
  const admin = options.admin || createAdminClient();
  const queuedPreavis = await queueDueBillingPreavis(admin, now);
  const result = await admin.from("mgmail_external_messages")
    .select("id,organization_id,identity_id,from_email,to_emails,subject,body_text,created_by,source_kind,recurring_contract_id,preavis_billing_date,preavis_days_before,scheduled_at")
    .eq("direction", "outgoing").eq("status", "queued")
    .not("scheduled_at", "is", null).lte("scheduled_at", now.toISOString())
    .order("scheduled_at").limit(BATCH);
  if (result.error) throw new Error("Impossible de consulter les e-mails programmés.");
  const tally = { enabled: true, queuedPreavis, accepted: 0, cancelled: 0, uncertain: 0 };
  const messages = result.data || [];
  // Throttle conservatively: avoid bursts against a free-tier mail provider.
  for (let start = 0; start < messages.length; start += 2) {
    const statuses = await Promise.all(messages.slice(start, start + 2).map((message) =>
      deliverOne(admin, message, now, env.MGMAIL_RESEND_API_KEY!, options.transport || fetch)));
    for (const state of statuses) tally[state]++;
    if (start + 2 < messages.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1100));
    }
  }
  return tally;
}
