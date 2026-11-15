import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireOrganization } from "@/lib/current-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { MagniboxSmtpTransport, magniboxSmtpConfig } from "@/lib/orbit/transport/smtp";
import { allowPublicSend, enabledMagniboxInternetMail } from "@/lib/orbit/transport/gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(request: NextRequest) {
  if (!enabledMagniboxInternetMail() || !magniboxSmtpConfig()) {
    return reply("Le transport Internet MAGNIBOX n'est pas encore activé.", 503);
  }

  try {
    const ctx = await requireOrganization();
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply("Demande invalide.", 400);
    const value = payload as Record<string, unknown>;
    const draftId = typeof value.draftId === "string" ? value.draftId : "";
    const requestId = typeof value.requestId === "string" ? value.requestId : "";
    if (!UUID.test(draftId) || !UUID.test(requestId)) return reply("Référence de brouillon invalide.", 400);

    const admin = createAdminClient();
    const draftResult = await admin.from("orbit_external_messages")
      .select("id,organization_id,identity_id,created_by,direction,status,request_key,from_email,to_emails,subject,body_text")
      .eq("id", draftId).eq("organization_id", ctx.organizationId)
      .eq("created_by", ctx.user.id).eq("direction", "outgoing").maybeSingle();
    if (draftResult.error) return reply("Brouillon indisponible.", 503);
    const draft = draftResult.data;
    if (!draft) return reply("Brouillon introuvable.", 404);

    const identityResult = await ctx.supabase.from("orbit_public_identities")
      .select("id,organization_id,domain_request_id,address_request_id,email_address,provider,status,provider_verified_at,provider_domain_ref")
      .eq("id", draft.identity_id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (identityResult.error) return reply("Identité expéditrice indisponible.", 503);
    const identity = identityResult.data;
    if (!identity) return reply("Identité expéditrice non autorisée.", 403);

    const access = await ctx.supabase.rpc("orbit_can_public_mail_access", {
      p_org: ctx.organizationId, p_identity: identity.id, p_action: "send",
    });
    if (access.error || access.data !== true) return reply("Vous n'avez pas le droit d'envoyer depuis cette adresse.", 403);

    const [domain, address] = await Promise.all([
      admin.from("mgmail_domain_requests").select("status")
        .eq("id", identity.domain_request_id).eq("organization_id", ctx.organizationId).maybeSingle(),
      admin.from("mgmail_public_address_requests").select("status")
        .eq("id", identity.address_request_id).eq("organization_id", ctx.organizationId).maybeSingle(),
    ]);
    const allowed = allowPublicSend(identity, ctx.organizationId, {
      enabled: enabledMagniboxInternetMail(),
      hasCredentials: !!magniboxSmtpConfig(),
      domainVerified: !domain.error && domain.data?.status === "verified",
      addressApproved: !address.error && address.data?.status === "approved",
      recipientAuthorized: access.data === true,
    });
    if (!allowed) return reply("Domaine ou adresse non validés pour l'envoi Internet.", 403);

    // Resolve retries before touching attachment storage. A committed SMTP
    // reservation must never be sent again, even if retention later removes a file.
    if (draft.status !== "draft") {
      if (draft.request_key !== requestId) return reply("Ce brouillon a déjà été soumis avec une autre référence.", 409);
      return NextResponse.json({
        ok: draft.status !== "uncertain" && draft.status !== "failed",
        alreadySubmitted: true, id: draftId, state: draft.status,
      }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
    }

    const files = await admin.from("orbit_external_message_attachments")
      .select("id,storage_path,display_name,byte_size,detected_mime_type,sha256,scan_status")
      .eq("organization_id", ctx.organizationId).eq("message_id", draftId);
    if (files.error) return reply("Pièces jointes indisponibles.", 503);
    if ((files.data ?? []).some(file => file.scan_status !== "available")) {
      return reply("Les pièces jointes doivent toutes avoir reçu un verdict antivirus positif avant l'envoi.", 409);
    }
    if ((files.data ?? []).length > 5) return reply("Trop de pièces jointes.", 400);

    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    let totalBytes = 0;
    for (const file of files.data ?? []) {
      if (file.byte_size < 1 || file.byte_size > 30 * 1024 * 1024) return reply("Taille de pièce jointe invalide.", 400);
      totalBytes += file.byte_size;
      if (totalBytes > 150 * 1024 * 1024) return reply("Taille totale des pièces jointes dépassée.", 400);
      const stored = await admin.storage.from("magnibox-attachments").download(file.storage_path);
      if (stored.error || !stored.data) return reply("Lecture sécurisée d'une pièce jointe impossible.", 503);
      const content = Buffer.from(await stored.data.arrayBuffer());
      if (content.length !== file.byte_size || createHash("sha256").update(content).digest("hex") !== file.sha256) {
        return reply("Intégrité d'une pièce jointe non vérifiée.", 400);
      }
      const filename = file.display_name.replace(/[^\w .()\-]/g, "_").slice(0, 120) || "attachment.bin";
      attachments.push({ filename, content, contentType: file.detected_mime_type });
    }

    const dailyLimit = Math.max(1, Math.min(20, Number(process.env.MAGNIBOX_OUTBOUND_DAILY_LIMIT) || 10));
    const reserved = await admin.rpc("orbit_reserve_magnibox_draft_send", {
      p_organization_id: ctx.organizationId,
      p_draft_id: draftId,
      p_identity_id: identity.id,
      p_created_by: ctx.user.id,
      p_request_key: requestId,
      p_daily_limit: dailyLimit,
    });
    if (reserved.error || !reserved.data?.[0]) {
      if (reserved.error?.message?.includes("quota")) return reply("Le quota quotidien d'envoi de cette boîte est atteint.", 429);
      if (reserved.error?.message?.includes("not fully scanned")) return reply("Les pièces jointes ne sont pas encore validées par l'antivirus.", 409);
      if (reserved.error?.code === "55000") return reply("Ce brouillon a déjà été soumis ou sa référence ne correspond pas à la demande.", 409);
      if (reserved.error?.code === "42501") return reply("Brouillon ou identité non autorisé.", 403);
      return reply("Impossible de réserver l'envoi du brouillon.", 503);
    }

    const reservation = reserved.data[0] as { message_id: string; should_send: boolean };
    if (!reservation.should_send) {
      const current = await admin.from("orbit_external_messages")
        .select("status,provider_email_id").eq("id", draftId)
        .eq("organization_id", ctx.organizationId).maybeSingle();
      return NextResponse.json({
        ok: current.data?.status !== "uncertain" && current.data?.status !== "failed",
        alreadySubmitted: true, id: draftId, state: current.data?.status ?? "sending",
        providerMessageId: current.data?.provider_email_id ?? null,
      }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
    }

    try {
      const result = await new MagniboxSmtpTransport().send({
        from: draft.from_email,
        to: draft.to_emails,
        subject: draft.subject,
        text: draft.body_text,
        requestId,
        attachments,
      });
      const saved = await admin.from("orbit_external_messages").update({
        status: "accepted", provider_email_id: result.providerMessageId,
        last_error: null, updated_at: new Date().toISOString(),
      }).eq("organization_id", ctx.organizationId).eq("id", draftId)
        .eq("status", "sending").eq("request_key", requestId).select("id").maybeSingle();
      if (saved.error || !saved.data) {
        return NextResponse.json({
          ok: false, id: draftId, state: "uncertain",
          error: "Le serveur SMTP a accepté le message, mais son statut local n'a pas pu être confirmé. Ne le renvoyez pas.",
        }, { status: 202 });
      }
      return NextResponse.json({
        ok: true, id: draftId, state: "accepted", providerMessageId: result.providerMessageId,
        message: "Message accepté par le serveur SMTP MAGNIBOX. La livraison finale reste à confirmer.",
      }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
    } catch {
      await admin.from("orbit_external_messages").update({
        status: "uncertain",
        last_error: "Envoi non confirmé — vérifier la file SMTP MAGNIBOX avant toute nouvelle tentative.",
        updated_at: new Date().toISOString(),
      }).eq("organization_id", ctx.organizationId).eq("id", draftId)
        .eq("status", "sending").eq("request_key", requestId);
      return NextResponse.json({
        ok: false, id: draftId, state: "uncertain",
        error: "Le serveur SMTP n'a pas confirmé l'envoi. Consultez l'historique avant toute nouvelle tentative.",
      }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
    }
  } catch {
    return reply("Envoi du brouillon MAGNIBOX indisponible.", 503);
  }
}
