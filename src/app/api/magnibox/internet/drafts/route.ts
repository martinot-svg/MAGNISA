import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireOrganization();
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ ok: false, error: "Brouillon invalide." }, { status: 400 });
    }
    const value = payload as Record<string, unknown>;
    const identityId = typeof value.identityId === "string" ? value.identityId : "";
    const to = Array.isArray(value.to) ? value.to : [];
    const subject = typeof value.subject === "string" ? value.subject.trim() : "";
    const bodyText = typeof value.text === "string" ? value.text : "";
    if (!UUID.test(identityId) || to.length < 1 || to.length > 10
      || !to.every(item => typeof item === "string" && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(item))
      || subject.length < 1 || subject.length > 180 || !bodyText.trim() || bodyText.length > 50000) {
      return NextResponse.json({ ok: false, error: "Destinataires ou contenu du brouillon invalides." }, { status: 400 });
    }

    const identity = await ctx.supabase.from("orbit_public_identities")
      .select("id,organization_id,domain_request_id,address_request_id,email_address,provider,status")
      .eq("id", identityId).eq("organization_id", ctx.organizationId).maybeSingle();
    if (identity.error) return NextResponse.json({ ok: false, error: "Boîte indisponible." }, { status: 503 });
    if (!identity.data) return NextResponse.json({ ok: false, error: "Boîte non autorisée." }, { status: 403 });
    const access = await ctx.supabase.rpc("orbit_can_public_mail_access", {
      p_org: ctx.organizationId, p_identity: identityId, p_action: "send",
    });
    if (access.error || access.data !== true || identity.data.status !== "active" || identity.data.provider !== "smtp") {
      return NextResponse.json({ ok: false, error: "Droit de rédaction refusé." }, { status: 403 });
    }

    const admin = createAdminClient();
    const [domain, address] = await Promise.all([
      admin.from("mgmail_domain_requests").select("status").eq("id", identity.data.domain_request_id)
        .eq("organization_id", ctx.organizationId).maybeSingle(),
      admin.from("mgmail_public_address_requests").select("status").eq("id", identity.data.address_request_id)
        .eq("organization_id", ctx.organizationId).maybeSingle(),
    ]);
    if (domain.error || address.error) return NextResponse.json({ ok: false, error: "Validation de boîte indisponible." }, { status: 503 });
    if (domain.data?.status !== "verified" || address.data?.status !== "approved") {
      return NextResponse.json({ ok: false, error: "Domaine ou adresse non validés." }, { status: 403 });
    }

    const inserted = await admin.from("orbit_external_messages").insert({
      organization_id: ctx.organizationId, identity_id: identityId, direction: "outgoing",
      status: "draft", from_email: identity.data.email_address, to_emails: to,
      subject, body_text: bodyText, created_by: ctx.user.id, request_key: null,
    }).select("id,status,created_at").single();
    if (inserted.error || !inserted.data) return NextResponse.json({ ok: false, error: "Création du brouillon impossible." }, { status: 503 });
    return NextResponse.json({ ok: true, draft: inserted.data }, {
      status: 201, headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Session MAGNIBOX indisponible." }, { status: 401 });
  }
}
