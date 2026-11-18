import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { eligibleApprovedMailboxAddress } from "@/lib/orbit/transport/gates";
import { isMagniboxInboundContentLengthTooLarge, MagniboxInboundBodyTooLargeError, parseMagniboxInboundPayload, readMagniboxInboundBody, verifyMagniboxInboundSignature, MAGNIBOX_INBOUND_MAX_REQUEST_BYTES } from "@/lib/orbit/transport/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable() {
  return NextResponse.json({ ok: false, error: "Passerelle de réception MAGNIBOX indisponible." }, { status: 503 });
}

/** Signed private bridge from the MAGNIBOX-owned SMTP edge after filtering. */
export async function POST(request: NextRequest) {
  const secret = process.env.MAGNIBOX_INBOUND_WEBHOOK_SECRET;
  if (process.env.MAGNIBOX_EXTERNAL_MAIL_ENABLED !== "true" || !secret) return unavailable();
  const declaredLength = request.headers.get("content-length");
  if (isMagniboxInboundContentLengthTooLarge(declaredLength, MAGNIBOX_INBOUND_MAX_REQUEST_BYTES))
    return NextResponse.json({ error: "Message entrant trop volumineux." }, { status: 413 });

  let raw: string;
  try {
    raw = await readMagniboxInboundBody(request.body, MAGNIBOX_INBOUND_MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof MagniboxInboundBodyTooLargeError)
      return NextResponse.json({ error: "Message entrant trop volumineux." }, { status: 413 });
    return NextResponse.json({ error: "Corps entrant invalide." }, { status: 400 });
  }
  if (!verifyMagniboxInboundSignature(raw, request.headers.get("x-magnibox-timestamp"),
    request.headers.get("x-magnibox-signature"), secret)) {
    return NextResponse.json({ error: "Signature de la passerelle invalide." }, { status: 401 });
  }

  let message: ReturnType<typeof parseMagniboxInboundPayload>;
  try { message = parseMagniboxInboundPayload(JSON.parse(raw)); }
  catch { return NextResponse.json({ error: "Enveloppe de courrier invalide." }, { status: 400 }); }

  const admin = createAdminClient();
  const deliveries: Array<{ identity: NonNullable<Awaited<ReturnType<typeof lookupIdentity>>>; recipient: string }> = [];
  async function lookupIdentity(recipient: string) {
    const lookup = await admin.from("orbit_public_identities")
      .select("id,organization_id,domain_request_id,address_request_id,mailbox_id,email_address,provider,status,receive_enabled,provider_verified_at,provider_domain_ref")
      .eq("email_address", recipient).eq("provider", "smtp")
      .eq("status", "active").eq("receive_enabled", true).maybeSingle();
    if (lookup.error) throw new Error("identity_lookup_failed");
    return lookup.data;
  }

  // Resolve and validate every RCPT before writing any copy. A partial delivery
  // would otherwise make the MTA acknowledge recipients that MAGNIBOX discarded.
  try {
    for (const recipient of message.to) {
      const identity = await lookupIdentity(recipient);
      if (!identity || !identity.provider_verified_at || !identity.provider_domain_ref?.trim())
        return NextResponse.json({ error: "Destinataire non disponible." }, { status: 422 });
      const [mailbox, domain, address] = await Promise.all([
        admin.from("mgmail_internal_mailboxes").select("id,is_active")
          .eq("id", identity.mailbox_id)
          .eq("organization_id", identity.organization_id).maybeSingle(),
        admin.from("mgmail_domain_requests").select("domain_name,status")
          .eq("id", identity.domain_request_id).eq("organization_id", identity.organization_id).maybeSingle(),
        admin.from("mgmail_public_address_requests").select("email_address,status")
          .eq("id", identity.address_request_id).eq("organization_id", identity.organization_id).maybeSingle(),
      ]);
      if (domain.error || address.error || mailbox.error) return unavailable();
      const normalizedRecipient = recipient.trim().toLowerCase();
      if (!eligibleApprovedMailboxAddress({
        recipient: normalizedRecipient,
        identityEmail: identity.email_address,
        approvedEmail: address.data?.email_address,
        verifiedDomain: domain.data?.domain_name,
        mailboxActive: mailbox.data?.is_active === true,
        domainVerified: domain.data?.status === "verified",
        addressApproved: address.data?.status === "approved",
      })) return NextResponse.json({ error: "Destinataire non disponible." }, { status: 422 });
      deliveries.push({ identity, recipient: normalizedRecipient });
    }
  } catch { return unavailable(); }

  let accepted = 0;
  for (const { identity, recipient } of deliveries) {
    const saved = await admin.from("orbit_external_messages").insert({
      organization_id: identity.organization_id, identity_id: identity.id, direction: "incoming",
      status: "received", from_email: message.from, to_emails: [recipient], subject: message.subject,
      body_text: message.text, provider_email_id: message.messageId,
    }).select("id").maybeSingle();
    if (saved.error?.code === "23505") {
      // A replay is idempotent only when the stored envelope is byte-for-byte
      // equivalent at the normalized message-field level. Never acknowledge a
      // provider ID that collides with different content for this mailbox.
      const prior = await admin.from("orbit_external_messages")
        .select("id,from_email,to_emails,subject,body_text")
        .eq("identity_id", identity.id).eq("direction", "incoming")
        .eq("provider_email_id", message.messageId).maybeSingle();
      if (prior.error) return unavailable();
      const sameEnvelope = !!prior.data
        && prior.data.from_email === message.from
        && JSON.stringify(prior.data.to_emails) === JSON.stringify([recipient])
        && prior.data.subject === message.subject
        && prior.data.body_text === message.text;
      if (!sameEnvelope) return NextResponse.json(
        { error: "Identifiant de message déjà utilisé avec un contenu différent." },
        { status: 409 },
      );

      // The message row and object storage are not one database transaction.
      // Confirm every attachment was persisted before acknowledging a replay.
      const priorAttachments = await admin.from("orbit_external_message_attachments")
        .select("display_name,byte_size,sha256")
        .eq("message_id", prior.data.id)
        .eq("organization_id", identity.organization_id);
      if (priorAttachments.error) return unavailable();
      const expectedAttachments = message.attachments.map(attachment => {
        const bytes = Buffer.from(attachment.contentBase64, "base64");
        return {
          display_name: attachment.fileName,
          byte_size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }).sort((a, b) => a.display_name.localeCompare(b.display_name) || a.sha256.localeCompare(b.sha256));
      const storedAttachments = (priorAttachments.data ?? [])
        .map(attachment => ({
          display_name: attachment.display_name,
          byte_size: attachment.byte_size,
          sha256: attachment.sha256,
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name) || a.sha256.localeCompare(b.sha256));
      if (JSON.stringify(storedAttachments) !== JSON.stringify(expectedAttachments)) return unavailable();
      accepted += 1;
      continue;
    }
    if (saved.error || !saved.data?.id) return unavailable();
    const uploadedPaths: string[] = [];
    try {
      for (const attachment of message.attachments) {
        const bytes = Buffer.from(attachment.contentBase64, "base64");
        const storagePath = identity.organization_id + "/" + saved.data.id + "/" + randomUUID();
        const uploaded = await admin.storage.from("magnibox-attachments").upload(storagePath, bytes, { contentType: "application/octet-stream", upsert: false });
        if (uploaded.error) throw new Error("attachment_storage_failed");
        uploadedPaths.push(storagePath);
        const metadata = await admin.from("orbit_external_message_attachments").insert({
          organization_id: identity.organization_id, message_id: saved.data.id, storage_path: storagePath,
          display_name: attachment.fileName, detected_mime_type: "application/octet-stream", byte_size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"), scan_status: "quarantined",
        });
        if (metadata.error) throw new Error("attachment_metadata_failed");
      }
    } catch {
      if (uploadedPaths.length) await admin.storage.from("magnibox-attachments").remove(uploadedPaths);
      await admin.from("orbit_external_messages").delete().eq("id", saved.data.id).eq("organization_id", identity.organization_id);
      return unavailable();
    }
    accepted += 1;
  }
  return NextResponse.json({ ok: true, accepted, quarantinedAttachments: message.attachments.length }, { status: 202 });
}
