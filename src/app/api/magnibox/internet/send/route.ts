import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { ResendInternetTransport } from "@/lib/orbit/transport/resend";
import { allowPublicSend, enabledMagniboxInternetMail, normalizeOutgoingMessage } from "@/lib/orbit/transport/gates";

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
  if (!enabledMagniboxInternetMail() || !process.env.RESEND_API_KEY) {
    return reply("Le transport Internet Magnibox n'est pas encore activé.",503);
  }
  if (Number(request.headers.get("content-length")||"0")>100000)
    return reply("Message trop volumineux.",413);

  try {
    const ctx=await requireOrganization();
    let input: ReturnType<typeof normalizeOutgoingMessage>;
    try {
      input=normalizeOutgoingMessage(await request.json());
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
      hasCredentials:!!process.env.RESEND_API_KEY,
      domainVerified:!domain.error&&domain.data?.status==="verified",
      addressApproved:!address.error&&address.data?.status==="approved",
      recipientAuthorized:access.data===true,
    });
    if(!allowed) return reply("Domaine ou boîte expéditrice non validés pour l'envoi Internet.",403);

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

    // Conservative free-tier guard. A later atomic quota in the database is
    // necessary before providing unlimited or high-volume delivery.
    const since=new Date(Date.now()-24*60*60*1000).toISOString();
    const quota=await admin.from("orbit_external_messages")
      .select("id",{count:"exact",head:true})
      .eq("organization_id",ctx.organizationId)
      .eq("identity_id",identity.id).eq("direction","outgoing")
      .gte("created_at",since);
    if(quota.error) return reply("Le quota de courrier ne peut pas être vérifié.",503);
    const dailyLimit=Math.max(1,Math.min(20,Number(process.env.MAGNIBOX_OUTBOUND_DAILY_LIMIT)||10));
    if((quota.count??0)>=dailyLimit)
      return reply("Le quota quotidien d'envoi de cette boîte est atteint.",429);

    // The database's unique (identity_id, request_key) index protects against
    // retries submitting the same mail twice. Never automatically retry an
    // ambiguous provider/network failure.
    const pending=await admin.from("orbit_external_messages").insert({
      organization_id:ctx.organizationId,identity_id:identity.id,
      direction:"outgoing",status:"sending",
      from_email:identity.email_address,to_emails:input.to,
      subject:input.subject,body_text:input.text,
      request_key:input.requestId,created_by:ctx.user.id,
    }).select("id").single();
    if(pending.error) {
      if(pending.error.code==="23505") {
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
      return reply("Impossible d'enregistrer la demande d'envoi.",503);
    }
    const id=pending.data?.id;
    try {
      const transport=new ResendInternetTransport(process.env.RESEND_API_KEY);
      const result=await transport.send({
        from:identity.email_address,to:input.to,subject:input.subject,
        text:input.text,requestId:input.requestId,
      });
      const saved=await admin.from("orbit_external_messages").update({
        status:"accepted",provider_email_id:result.providerMessageId,
        last_error:null,updated_at:new Date().toISOString(),
      }).eq("organization_id",ctx.organizationId).eq("id",id)
        .eq("status","sending").select("id").maybeSingle();
      if(saved.error||!saved.data) return NextResponse.json({
        ok:false,id,state:"uncertain",
        error:"Envoi accepté par le fournisseur, confirmation locale indisponible. Ne renvoyez pas le message.",
      },{status:202});
      return NextResponse.json({
        ok:true,id,state:"accepted",providerMessageId:result.providerMessageId,
        message:"Accepté par le fournisseur, livraison finale non confirmée.",
      },{status:202});
    } catch {
      await admin.from("orbit_external_messages").update({
        status:"uncertain",last_error:"Envoi non confirmé — contrôler chez le fournisseur avant nouvelle tentative.",
        updated_at:new Date().toISOString(),
      }).eq("organization_id",ctx.organizationId).eq("id",id).eq("status","sending");
      return NextResponse.json({
        ok:false,id,state:"uncertain",
        error:"Le fournisseur n'a pas confirmé l'envoi. Contrôlez l'historique avant de réessayer.",
      },{status:202});
    }
  } catch {
    return reply("Envoi Magnibox indisponible. Aucune réussite ne doit être supposée.",503);
  }
}
