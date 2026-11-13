import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchResendReceivedEmail,
  verifyResendWebhookSignature,
} from "@/lib/magnimail/internet-resend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResendEvent = {
  type?: string;
  data?: { email_id?: string };
};

export async function POST(request: NextRequest) {
  const secret = process.env.MGMAIL_RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.MGMAIL_RESEND_API_KEY;
  if (!secret || !apiKey) {
    return NextResponse.json({ error: "Réception MGMail non configurée." }, { status: 503 });
  }
  const rawBody = await request.text();
  if (rawBody.length > 100000 ||
      !verifyResendWebhookSignature(rawBody, {
        id: request.headers.get("svix-id"),
        timestamp: request.headers.get("svix-timestamp"),
        signature: request.headers.get("svix-signature"),
      }, secret)) {
    return NextResponse.json({ error: "Signature de webhook invalide." }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "Événement malformé." }, { status: 400 });
  }
  const providerId = event.data?.email_id;
  if (!providerId || typeof providerId !== "string" || providerId.length > 128) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const admin = createAdminClient();
    if (event.type === "email.received") {
      // The provider webhook only contains metadata. Retrieve the actual
      // message from the authenticated provider API, not from caller input.
      const received = await fetchResendReceivedEmail(apiKey, providerId);
      const addresses = [...new Set(received.to)];
      const { data: identities, error: lookupError } = await admin
        .from("mgmail_external_identities")
        .select("id,organization_id,email_address")
        .eq("status", "active")
        .eq("receive_enabled", true)
        .in("email_address", addresses);
      if (lookupError) throw new Error("Recherche des boîtes de réception impossible.");
      let stored = 0;
      for (const identity of identities || []) {
        const result = await admin.from("mgmail_external_messages").insert({
          organization_id: identity.organization_id,
          identity_id: identity.id,
          direction: "incoming",
          status: "received",
          from_email: received.from,
          to_emails: addresses,
          subject: received.subject,
          body_text: received.text,
          provider_email_id: providerId,
        });
        if (result.error && result.error.code !== "23505") {
          throw new Error("Stockage du message reçu impossible.");
        }
        if (!result.error) stored++;
      }
      return NextResponse.json({ ok: true, stored });
    }

    const statuses: Record<string, string> = {
      "email.delivered": "delivered",
      "email.bounced": "bounced",
      "email.failed": "failed",
      "email.suppressed": "failed",
    };
    const status = statuses[event.type || ""];
    if (status) {
      // Update only rows created by our outbound service, and only after a
      // signed event. Never interpret provider acceptance as final delivery.
      const { error } = await admin.from("mgmail_external_messages")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("direction", "outgoing")
        .eq("provider_email_id", providerId);
      if (error) throw new Error("Mise à jour de livraison impossible.");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: true, ignored: true });
  } catch (error) {
    console.error("MGMail internet webhook processing failed",
      error instanceof Error ? error.message : "unknown");
    // A 5xx response instructs the provider to retry. Idempotency ensures
    // already-recorded recipients do not receive duplicate inbox messages.
    return NextResponse.json({ error: "Traitement MGMail échoué." }, { status: 500 });
  }
}
