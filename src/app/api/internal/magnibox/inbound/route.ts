import { NextRequest, NextResponse } from "next/server";
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
  if (Number(request.headers.get("content-length") || "0") > 150000)
    return NextResponse.json({ error: "Message entrant trop volumineux." }, { status: 413 });

  let raw: string;
  try {
    raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 150000)
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

  for (const { identity, recipient } of deliveries) {
    const saved = await admin.from("orbit_external_messages").insert({
      organization_id: identity.organization_id,
      identity_id: identity.id,
      direction: "incoming",
      status: "received",
      from_email: message.from,
      to_emails: [recipient],
      subject: message.subject,
      body_text: message.text,
      provider_email_id: message.messageId,
    });
    if (saved.error && saved.error.code !== "23505") return unavailable();
  }

  return NextResponse.json({ ok: true, accepted: deliveries.length }, { status: 202 });
}
