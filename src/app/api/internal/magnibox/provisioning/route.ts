import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isMagniboxInboundContentLengthTooLarge, MagniboxInboundBodyTooLargeError, readMagniboxBoundedBody } from "@/lib/orbit/transport/inbound";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  collectMagniboxProvisioningRows,
  signMagniboxProvisioningResponse,
  verifyMagniboxProvisioningRequest,
} from "@/lib/orbit/transport/provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 2048;

/**
 * Read-only, signed snapshot for the MAGNIBOX MTA recipient map synchronizer.
 * Never returns tenant IDs, mailbox credentials, or unapproved addresses.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.MAGNIBOX_PROVISIONING_WEBHOOK_SECRET;
  if (process.env.MAGNIBOX_EXTERNAL_MAIL_ENABLED !== "true" || !secret) {
    return NextResponse.json({ error: "Provisionnement MAGNIBOX désactivé." }, { status: 503 });
  }
  if (isMagniboxInboundContentLengthTooLarge(request.headers.get("content-length"), MAX_REQUEST_BYTES)) {
    return NextResponse.json({ error: "Requête trop volumineuse." }, { status: 413 });
  }

  let raw: string;
  try {
    // Enforce the limit while streaming, including chunked requests without Content-Length.
    raw = await readMagniboxBoundedBody(request.body, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof MagniboxInboundBodyTooLargeError) {
      return NextResponse.json({ error: "Requête trop volumineuse." }, { status: 413 });
    }
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }
  if (!verifyMagniboxProvisioningRequest(
    raw,
    request.headers.get("x-magnibox-timestamp"),
    request.headers.get("x-magnibox-signature"),
    secret,
  )) {
    return NextResponse.json({ error: "Signature de provisionnement invalide." }, { status: 401 });
  }

  try {
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input as Record<string, unknown>).length !== 0) {
      return NextResponse.json({ error: "Requête de provisionnement invalide." }, { status: 400 });
    }

    const admin = createAdminClient();
    // Supabase/PostgREST may cap a single response below the directory size.
    // Explicitly page through every row and fail closed above the MTA's 10k limit.
    const identities = await collectMagniboxProvisioningRows(async (from, to) => {
      const page = await admin.from("orbit_public_identities")
        .select("organization_id,domain_request_id,address_request_id,mailbox_id,email_address,provider,status,receive_enabled,provider_verified_at,provider_domain_ref")
        .eq("provider", "smtp")
        .eq("status", "active")
        .eq("receive_enabled", true)
        .not("provider_verified_at", "is", null)
        .range(from, to);
      if (page.error) throw new Error("identity_snapshot_failed");
      return page.data ?? [];
    });

    const valid: Array<{ email: string; domain: string }> = [];
    for (let start = 0; start < identities.length; start += 50) {
      const batch = identities.slice(start, start + 50);
      const checked = await Promise.all(batch.map(async identity => {
        if (!identity.provider_domain_ref?.trim() || !identity.email_address?.trim()) return null;
        const [mailbox, domain, address] = await Promise.all([
          admin.from("mgmail_internal_mailboxes").select("id,is_active")
            .eq("id", identity.mailbox_id)
            .eq("organization_id", identity.organization_id).maybeSingle(),
          admin.from("mgmail_domain_requests").select("domain_name,status")
            .eq("id", identity.domain_request_id)
            .eq("organization_id", identity.organization_id).maybeSingle(),
          admin.from("mgmail_public_address_requests").select("email_address,status")
            .eq("id", identity.address_request_id)
            .eq("organization_id", identity.organization_id).maybeSingle(),
        ]);
        if (domain.error || address.error || mailbox.error) throw new Error("mailbox_validation_failed");
        if (!mailbox.data?.is_active || domain.data?.status !== "verified" || address.data?.status !== "approved") return null;
        const email = identity.email_address.trim().toLowerCase();
        const domainName = domain.data.domain_name?.trim().toLowerCase();
        if (!domainName || email.split("@").length !== 2 || email.split("@")[1] !== domainName) return null;
        if (address.data.email_address?.trim().toLowerCase() !== email) return null;
        return { email, domain: domainName };
      }));
      valid.push(...checked.filter((item): item is { email: string; domain: string } => item !== null));
    }

    const recipients = [...new Set(valid.map(x => x.email))].sort();
    const domains = [...new Set(valid.map(x => x.domain))].sort();
    const generatedAt = new Date().toISOString();
    const snapshot = {
      generatedAt,
      domains,
      recipients,
      revision: createHash("sha256").update(JSON.stringify({ domains, recipients })).digest("hex"),
    };
    const body = JSON.stringify(snapshot);
    const timestamp = String(Math.floor(Date.now() / 1000));
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
        "x-magnibox-timestamp": timestamp,
        "x-magnibox-signature": signMagniboxProvisioningResponse(body, timestamp, secret),
        "x-magnibox-revision": snapshot.revision,
      },
    });
  } catch {
    return NextResponse.json({ error: "Provisionnement MAGNIBOX indisponible." }, { status: 503 });
  }
}
