#!/usr/bin/env node
// Privileged, explicit provisioning. This does not register or purchase domains.
// Never place service_role keys or provider API keys in the browser or in Git.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i < 0 ? null : args[i + 1] || null;
};
const id = value("--request-id");
const providerId = value("--provider-domain-id");
const execute = args.includes("--execute");
const consent = args.includes("--ownership-confirmed");
const operatorRef = process.env.MGMAIL_OPERATOR_REFERENCE?.trim();
const evidence = process.env.MGMAIL_OWNERSHIP_EVIDENCE_REFERENCE?.trim();
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendKey = process.env.MGMAIL_RESEND_API_KEY;
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID.test(id || "") || !/^[a-zA-Z0-9_-]{5,128}$/.test(providerId || "") ||
    !operatorRef || operatorRef.length > 128 || !evidence ||
    evidence.length > 128 || !supabaseUrl || !serviceKey || !resendKey || !consent) {
  throw new Error("Paramètres manquants : --request-id UUID --provider-domain-id ID --ownership-confirmed, secrets serveur et preuves de propriété obligatoires.");
}
if (!execute) {
  process.stdout.write("Mode prévisualisation : aucune activation ni achat. Ajouter --execute après contrôle du dossier et des DNS.\n");
}

const db = createClient(supabaseUrl, serviceKey,
  { auth: { autoRefreshToken: false, persistSession: false } });
const required = (response, label) => {
  if (response.error || !response.data) throw new Error(label + ": " + (response.error?.message || "absent"));
  return response.data;
};

const request = required(await db.from("mgmail_public_address_requests")
  .select("id,organization_id,mailbox_id,email_address,status")
  .eq("id", id).single(), "Demande d'adresse MGMail");
if (request.status === "rejected") throw new Error("Demande d'adresse refusée.");

const domain = request.email_address.split("@")[1];
const domainRequest = required(await db.from("mgmail_domain_requests")
  .select("id,organization_id,domain_name,status")
  .eq("organization_id", request.organization_id)
  .eq("domain_name", domain).single(), "Demande de domaine");
if (domainRequest.status === "rejected") throw new Error("Domaine refusé.");
required(await db.from("mgmail_internal_mailboxes").select("id")
  .eq("organization_id", request.organization_id)
  .eq("id", request.mailbox_id).eq("is_active", true).single(), "Boîte interne valide");

// The provider must already know and have verified the owned domain.
// No POST to /domains or DNS mutation is performed by this script.
const domainResponse = await fetch(`https://api.resend.com/domains/${encodeURIComponent(providerId)}`, {
  headers: { Authorization: `Bearer ${resendKey}` },
  signal: AbortSignal.timeout(15000),
});
if (!domainResponse.ok) throw new Error(`Fournisseur : échec de la vérification du domaine (HTTP ${domainResponse.status}).`);
const info = await domainResponse.json();
const verifiedRecords = new Set((Array.isArray(info.records) ? info.records : [])
  .filter((record) => record.status === "verified")
  .map((record) => String(record.record).toLowerCase()));
if (info.id !== providerId || info.name !== domain || info.status !== "verified" ||
    info.capabilities?.sending !== "enabled" ||
    info.capabilities?.receiving !== "enabled" ||
    !verifiedRecords.has("dkim") || !verifiedRecords.has("spf") ||
    !verifiedRecords.has("receiving")) {
  throw new Error("Domaine non vérifié pour l'envoi ET la réception, ou nom de domaine différent.");
}

const existing = await db.from("mgmail_verified_domains")
  .select("id,organization_id,provider_domain_id")
  .eq("domain_name", domain).maybeSingle();
if (existing.error) throw existing.error;
if (existing.data && (existing.data.organization_id !== request.organization_id ||
    existing.data.provider_domain_id !== providerId)) {
  throw new Error("Domaine déjà attribué à une autre entreprise ou à un autre compte fournisseur.");
}
const conflicting = await db.from("mgmail_external_identities")
  .select("id,organization_id,mailbox_id")
  .eq("email_address", request.email_address).maybeSingle();
if (conflicting.error) throw conflicting.error;
if (conflicting.data && (conflicting.data.organization_id !== request.organization_id ||
    conflicting.data.mailbox_id !== request.mailbox_id)) {
  throw new Error("Adresse déjà attribuée à une autre boîte ou entreprise.");
}
process.stdout.write(JSON.stringify({
  domain, address: request.email_address,
  organization_id: request.organization_id, mailbox_id: request.mailbox_id,
  provider_domain_verified: true, operator_ref: operatorRef,
  ownership_evidence_recorded: true, execution: execute,
}) + "\n");
if (!execute) process.exit(0);

// All failures before the final identity activation fail closed. A partially
// provisioned row remains pending and does not authorize Internet mail.
const verifiedId = existing.data?.id || randomUUID();
required(await db.from("mgmail_verified_domains").upsert({
  id: verifiedId, organization_id: request.organization_id,
  domain_name: domain, provider: "resend", provider_domain_id: providerId,
  sending_verified: true, receiving_verified: true, ownership_approved: true,
  operator_reference: `${operatorRef} / ${evidence}`.slice(0,128),
  provider_checked_at: new Date().toISOString(),
}, { onConflict: "domain_name" }).select("id").single(), "Preuve fournisseur");
let identityId = conflicting.data?.id;
if (!identityId) {
  identityId = required(await db.from("mgmail_external_identities").insert({
    organization_id: request.organization_id,
    mailbox_id: request.mailbox_id, email_address: request.email_address,
    status: "pending", provider: "resend", receive_enabled: false,
  }).select("id").single(), "Création de l'identité en attente").id;
}
required(await db.from("mgmail_external_identities").update({
  verified_domain_id: verifiedId, status: "active", receive_enabled: true,
}).eq("id", identityId).eq("organization_id", request.organization_id)
  .select("id").single(), "Activation sous garde-fou SQL");
required(await db.from("mgmail_domain_requests").update({status:"approved"})
  .eq("id",domainRequest.id).eq("organization_id",request.organization_id)
  .select("id").single(),"Approbation du domaine");
required(await db.from("mgmail_public_address_requests").update({status:"approved"})
  .eq("id",request.id).eq("organization_id",request.organization_id)
  .select("id").single(),"Approbation de l'adresse");
process.stdout.write("Identité MGMail activée après vérification du domaine chez Resend. Aucun e-mail de test n'a été expédié.\n");
