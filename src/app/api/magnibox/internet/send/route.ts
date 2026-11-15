import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireOrganization } from "@/lib/current-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { MagniboxSmtpTransport, magniboxSmtpConfig } from "@/lib/orbit/transport/smtp";
import { allowPublicSend, enabledMagniboxInternetMail, normalizeOutgoingMessage } from "@/lib/orbit/transport/gates";
import { isMagniboxInboundContentLengthTooLarge, MagniboxInboundBodyTooLargeError, readMagniboxBoundedBody } from "@/lib/orbit/transport/inbound";

export const runtime = "nodejs";

function reply(error: string,status: number) {
  return NextResponse.json({ok:false,error},{status});
}

/**
 * A route for real public-address mail — NOT internal .mgmail and NOT Gmail.
 * It is disabled by default and never accepts the claimed sender or org from
 * the body. The authenticated membership and BOTH grant layers are checked.
 */
export async function POST(request: NextRequest) {
  if (!enabledMagniboxInternetMail() || !magniboxSmtpConfig()) {
    return reply("Le transport Internet Magnibox n'est pas encore activé.",503);
  }
  let rawBody: string;
  try {
    if (isMagniboxInboundContentLengthTooLarge(request.headers.get("content-length"), 100000))
      return reply("Message trop volumineux.",413);
    rawBody = await readMagniboxBoundedBody(request.body, 100000);
  } catch (error) {
    if (error instanceof MagniboxInboundBodyTooLargeError) return reply("Message trop volumineux.",413);
    return reply("Corps de requête invalide.",400);
  }

  try {
    const ctx=await requireOrganization();
    let input: ReturnType<typeof normalizeOutgoingMessage>;
    let attachmentIds: string[] = [];
    try {
      const payload = JSON.parse(rawBody) as unknown;
      input=normalizeOutgoingMessage(payload);
      const rawAttachments = payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).attachmentIds : undefined;
      if (rawAttachments !== undefined) {
        if (!Array.isArray(rawAttachments) || rawAttachments.length > 5
          || !rawAttachments.every(value => typeof value === "string"
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
          || new Set(rawAttachments).size !== rawAttachments.length) throw new Error("Invalid attachments");
        attachmentIds = rawAttachments;
      }
    } catch {
      return reply("Identité, destinataires ou contenu de message invalides.",400);
    }
    const {data:identity,error:identityError}=await ctx.supabase
      .from("orbit_public_identities")
      .select("id,organization_id,domain_request_id,address_request_id,email_address,provider,status,provider_verified_at,provider_domain_ref")
      .eq("id",input.identityId)
      .eq("organization_id",ctx.organizationId).maybeSingle();
    if(identityError) return reply("Le service de messagerie publique n'est pas encore disponible.",503);
    if(!identity) return reply("Adresse expéditrice non autorisée.",403);
    const access=await ctx.supabase.rpc("orbit_can_public_mail_access",{
      p_org:ctx.organizationId,p_identity:identity.id,p_action:"send",
    });
    if(access.error||access.data!==true)
      return reply("Vous n'avez pas le droit d'envoyer depuis cette adresse.",403);

    // The caller can never write an active identity or provider approval.
    // Read those proofs through a privileged server connection only AFTER
    // checking the user, organization, sender identity and send permission.
    const admin=createAdminClient();
    const [domain,address]=await Promise.all([
      admin.from("mgmail_domain_requests").select("status")
        .eq("id",identity.domain_request_id)
        .eq("organization_id",ctx.organizationId).maybeSingle(),
      admin.from("mgmail_public_address_requests").select("status")
        .eq("id",identity.address_request_id)
        .eq("organization_id",ctx.organizationId).maybeSingle(),
    ]);
    const allowed=allowPublicSend(identity,ctx.organizationId,{
      enabled:enabledMagniboxInternetMail(),
      hasCredentials:!!magniboxSmtpConfig(),
      domainVerified:!domain.error&&domain.data?.status==="verified",
      addressApproved:!address.error&&address.data?.status==="approved",
      recipientAuthorized:access.data===true,
    });

    if(!allowed) return reply("Domaine ou boîte expéditrice non validés pour l'envoi Internet.",403);

    // Only previously received, malware-scanned files in this exact mailbox
    // may be forwarded. Browser-supplied paths, names and MIME types are ignored.
    const outgoingAttachments: Array<{filename:string;content:Buffer;contentType:string}> = [];
    if (attachmentIds.length) {
      const visible = await ctx.supabase.from("orbit_external_message_attachments")
        .select("id,message_id,storage_path,display_name,byte_size,detected_mime_type,sha256")
        .in("id", attachmentIds).eq("scan_status", "available");
      if (visible.error || (visible.data ?? []).length !== attachmentIds.length)
        return reply("Une ou plusieurs pièces jointes ne sont pas disponibles.",400);
      const sourceMessages = await ctx.supabase.from("orbit_external_messages")
        .select("id,identity_id,direction")
        .in("id", (visible.data ?? []).map(item => item.message_id))
        .eq("organization_id", ctx.organizationId).eq("identity_id", identity.id)
        .eq("direction", "incoming");
      if (sourceMessages.error || (sourceMessages.data ?? []).length !== new Set((visible.data ?? []).map(item => item.message_id)).size)
        return reply("Les pièces jointes ne proviennent pas de cette boîte.",403);
      const adminForFiles = createAdminClient();
      let totalBytes = 0;
      for (const item of visible.data ?? []) {
        if (item.byte_size < 1 || item.byte_size > 30 * 1024 * 1024) return reply("Taille de pièce jointe invalide.",400);
        totalBytes += item.byte_size;
        if (totalBytes > 150 * 1024 * 1024) return reply("Taille totale des pièces jointes dépassée.",400);
        const downloaded = await adminForFiles.storage.from("magnibox-attachments").download(item.storage_path);
        if (downloaded.error || !downloaded.data) return reply("Lecture sécurisée des pièces jointes impossible.",503);
        const content = Buffer.from(await downloaded.data.arrayBuffer());
        if (content.length !== item.byte_size || createHash("sha256").update(content).digest("hex") !== item.sha256) return reply("Intégrité d'une pièce jointe non vérifiée.",400);
        const filename = item.display_name.replace(/[^\\w .()\\-]/g, "_").slice(0,120) || "attachment.bin";
        outgoingAttachments.push({filename,content,contentType:item.detected_mime_type});
      }
    }

    // Repeated requests return the existing result, before evaluating quotas.
    // A reused key with a different payload or author is a conflict, never
    // permission to overwrite a previously requested message.
    const prior=await admin.from("orbit_external_messages")
      .select("id,status,provider_email_id,created_by,to_emails,subject,body_text")
      .eq("organization_id",ctx.organizationId).eq("identity_id",identity.id)
      .eq("request_key",input.requestId).maybeSingle();
    if(prior.error)return reply("Impossible de consulter l'historique d'envoi.",503);
    if(prior.data){
      const same=prior.data.created_by===ctx.user.id
        && prior.data.subject===input.subject
        && prior.data.body_text===input.text
        && JSON.stringify(prior.data.to_emails)===JSON.stringify(input.to);
      if(!same)return reply("Cette référence de demande correspond déjà à un autre message.",409);
      return NextResponse.json({
        ok:prior.data.status!=="uncertain",
        alreadySubmitted:true,state:prior.data.status,
        id:prior.data.id,providerMessageId:prior.data.provider_email_id,
      },{status:202});
    }

    // The database's unique (identity_id, request_key) index protects against
    // retries submitting the same mail twice. Never automatically retry an
    // ambiguous provider/network failure.
    // Reserve quota and create the pending row under one transaction-scoped
    // organization/identity lock. Concurrent sends cannot pass the same count.
    const dailyLimit=Math.max(1,Math.min(20,Number(process.env.MAGNIBOX_OUTBOUND_DAILY_LIMIT)||10));
    const pending=await admin.rpc("orbit_reserve_magnibox_outbound",{
      p_organization_id:ctx.organizationId,
      p_identity_id:identity.id,
      p_from_email:identity.email_address,
      p_to_emails:input.to,
      p_subject:input.subject,
      p_body_text:input.text,
      p_request_key:input.requestId,
      p_created_by:ctx.user.id,
      p_daily_limit:dailyLimit,
    });
    if(pending.error||!pending.data) {
      if(pending.error?.code==="23505") {
        const existing=await admin.from("orbit_external_messages")
          .select("id,status,provider_email_id,created_by,to_emails,subject,body_text")
          .eq("organization_id",ctx.organizationId)
          .eq("identity_id",identity.id)
          .eq("request_key",input.requestId).maybeSingle();
        if(existing.data){
          if(existing.data.created_by!==ctx.user.id
            ||existing.data.subject!==input.subject
            ||existing.data.body_text!==input.text
            ||JSON.stringify(existing.data.to_emails)!==JSON.stringify(input.to))
            return reply("La référence d'envoi existe déjà pour un autre message.",409);
          return NextResponse.json({
            ok:existing.data.status!=="uncertain",alreadySubmitted:true,
            state:existing.data.status,id:existing.data.id,
            providerMessageId:existing.data.provider_email_id,
          },{status:202});
        }
      }
      if(pending.error?.message?.includes("quota")) return reply("Le quota quotidien d'envoi de cette boîte est atteint.",429);
      return reply("Impossible de réserver le quota et d'enregistrer la demande d'envoi.",503);
    }
    const id=pending.data;
    try {
      const transport=new MagniboxSmtpTransport();
      const result=await transport.send({
        from:identity.email_address,to:input.to,subject:input.subject,
        text:input.text,requestId:input.requestId,attachments:outgoingAttachments,
      });
      const saved=await admin.from("orbit_external_messages").update({
        status:"accepted",provider_email_id:result.providerMessageId,
        last_error:null,updated_at:new Date().toISOString(),
      }).eq("organization_id",ctx.organizationId).eq("id",id)
        .eq("status","sending").select("id").maybeSingle();
      if(saved.error||!saved.data) return NextResponse.json({
        ok:false,id,state:"uncertain",
        error:"Envoi accepté par le serveur SMTP MAGNIBOX, confirmation locale indisponible. Ne renvoyez pas le message.",
      },{status:202});
      return NextResponse.json({
        ok:true,id,state:"accepted",providerMessageId:result.providerMessageId,
        message:"Accepté par le serveur SMTP MAGNIBOX, livraison finale non confirmée.",
      },{status:202});
    } catch {
      await admin.from("orbit_external_messages").update({
        status:"uncertain",last_error:"Envoi non confirmé — vérifier la file SMTP MAGNIBOX avant toute nouvelle tentative.",
        updated_at:new Date().toISOString(),
      }).eq("organization_id",ctx.organizationId).eq("id",id).eq("status","sending");
      return NextResponse.json({
        ok:false,id,state:"uncertain",
        error:"Le serveur SMTP MAGNIBOX n'a pas confirmé l'envoi. Contrôlez l'historique avant de réessayer.",
      },{status:202});
    }
  } catch {
    return reply("Envoi Magnibox indisponible. Aucune réussite ne doit être supposée.",503);
  }
}
