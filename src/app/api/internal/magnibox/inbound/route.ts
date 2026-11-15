import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseMagniboxInboundPayload, verifyMagniboxInboundSignature } from "@/lib/orbit/transport/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable() {
  return NextResponse.json({ ok: false, error: "Passerelle de réception MAGNIBOX indisponible." }, { status: 503 });
}

/** Signed private bridge from the MAGNIBOX-owned SMTP edge after filtering. */
export async function POST(request: NextRequest) {
  const secret = process.env.MAGNIBOX_INBOUND_WEBHOOK_SECRET;
  if (process.env.MAGNIBOX_EXTERNAL_MAIL_ENABLED !== "true" || !secret) return unavailable();
  if (Number(request.headers.get("content-length") || "0") > 28 * 1024 * 1024)
    return NextResponse.json({ error: "Message entrant trop volumineux." }, { status: 413 });

  let raw: string;
  try {
    raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 28 * 1024 * 1024)
      return NextResponse.json({ error: "Message entrant trop volumineux." }, { status: 413 });
  } catch {
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
      .select("id,organization_id,domain_request_id,address_request_id,email_address,provider,status,receive_enabled,provider_verified_at,provider_domain_ref")
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
      const [domain, address] = await Promise.all([
        admin.from("mgmail_domain_requests").select("status")
          .eq("id", identity.domain_request_id).eq("organization_id", identity.organization_id).maybeSingle(),
        admin.from("mgmail_public_address_requests").select("status")
          .eq("id", identity.address_request_id).eq("organization_id", identity.organization_id).maybeSingle(),
      ]);
      if (domain.error || address.error) return unavailable();
      if (domain.data?.status !== "verified" || address.data?.status !== "approved")
        return NextResponse.json({ error: "Destinataire non disponible." }, { status: 422 });
      deliveries.push({ identity, recipient });
    }
  } catch { return unavailable(); }

  let accepted = 0;
  for (const { identity, recipient } of deliveries) {
    const saved = await admin.from("orbit_external_messages").insert({
      organization_id: identity.organization_id, identity_id: identity.id, direction: "incoming",
      status: "received", from_email: message.from, to_emails: [recipient], subject: message.subject,
      body_text: message.text, provider_email_id: message.messageId,
    }).select("id").maybeSingle();
    if (saved.error?.code === "23505") { accepted += 1; continue; }
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
