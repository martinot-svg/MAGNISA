import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ResendInternetTransport, verifyResendSignedEvent } from "@/lib/orbit/transport/resend";
import { eligiblePublicRecipient, enabledMagniboxInternetMail } from "@/lib/orbit/transport/gates";

export const runtime="nodejs";
type ResendEvent={
  type?:unknown;
  data?:{ email_id?:unknown };
};

function ack() { return NextResponse.json({ok:true}); }
function unavailable() {
  return NextResponse.json({error:"Réception Magnibox non configurée."},{status:503});
}

/**
 * Public provider callback. Every event is authenticated with a time-bound,
 * raw-body Svix signature BEFORE any tenant lookup or privileged database call.
 * This handler is deliberately inert until the platform transport is enabled.
 */
export async function POST(request: NextRequest) {
  const secret=process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  const key=process.env.RESEND_API_KEY;
  if(!enabledMagniboxInternetMail()||!secret||!key)return unavailable();
  if(Number(request.headers.get("content-length")||"0")>100000)
    return NextResponse.json({error:"Webhook trop volumineux."},{status:413});
  let raw:string;
  try {
    raw=await request.text();
    if(raw.length>100000)return NextResponse.json({error:"Webhook trop volumineux."},{status:413});
  }catch{
    return NextResponse.json({error:"Corps du webhook invalide."},{status:400});
  }
  const verified=verifyResendSignedEvent(raw,{
    id:request.headers.get("svix-id"),
    timestamp:request.headers.get("svix-timestamp"),
    signature:request.headers.get("svix-signature"),
  },secret);
  if(!verified)return NextResponse.json({error:"Signature du fournisseur invalide."},{status:401});

  let event:ResendEvent;
  try{event=JSON.parse(raw) as ResendEvent;}catch{
    return NextResponse.json({error:"Événement invalide."},{status:400});
  }
  const mailId=event.data?.email_id;
  if(typeof mailId!=="string"||!/^[-A-Za-z0-9_]{5,128}$/.test(mailId))return ack();

  // No organization or address from the signed *notification* is trusted;
  // for incoming messages retrieve the body and recipients from the provider.
  if(event.type==="email.received"){
    let received: Awaited<ReturnType<ResendInternetTransport["fetchReceived"]>>;
    try{
      received=await new ResendInternetTransport(key).fetchReceived(mailId);
    }catch{return unavailable();}
    const recipients=[...new Set(received.to)];
    if(!recipients.length)return ack();
    const admin=createAdminClient();
    const candidates=await admin.from("orbit_public_identities")
      .select("id,organization_id,domain_request_id,address_request_id,email_address,provider,status,receive_enabled,provider_verified_at,provider_domain_ref")
      .in("email_address",recipients)
      .eq("provider","resend").eq("status","active").eq("receive_enabled",true);
    if(candidates.error)return unavailable();
    for(const identity of candidates.data??[]){
      if(!recipients.some(addr=>eligiblePublicRecipient(identity,addr)))continue;
      const [d,a]=await Promise.all([
        admin.from("mgmail_domain_requests").select("status")
          .eq("organization_id",identity.organization_id)
          .eq("id",identity.domain_request_id).maybeSingle(),
        admin.from("mgmail_public_address_requests").select("status")
          .eq("organization_id",identity.organization_id)
          .eq("id",identity.address_request_id).maybeSingle(),
      ]);
      if(d.error||a.error)return unavailable();
      if(d.data?.status!=="verified"||a.data?.status!=="approved")continue;
      const inserted=await admin.from("orbit_external_messages").insert({
        organization_id:identity.organization_id,identity_id:identity.id,
        direction:"incoming",status:"received",
        from_email:received.from,to_emails:received.to,
        subject:received.subject,body_text:received.text,provider_email_id:mailId,
      });
      // Unique identity+direction+provider_id makes duplicate deliveries safe.
      if(inserted.error&&inserted.error.code!=="23505")return unavailable();
    }
    return ack();
  }

  // Provider acknowledgements are not a request from the authenticated user.
  // The verified provider ID is the only valid message selector here.
  const next:Record<string,string>={
    "email.delivered":"delivered",
    "email.bounced":"bounced",
    "email.failed":"failed",
    "email.delivery_delayed":"uncertain",
  };
  const status=typeof event.type==="string"?next[event.type]:undefined;
  if(!status)return ack();
  const admin=createAdminClient();
  const allowed=status==="bounced"?["accepted","sending","uncertain","delivered"]:
    status==="uncertain"?["accepted","sending"]:
    ["accepted","sending","uncertain"];
  const updated=await admin.from("orbit_external_messages")
    .update({status,updated_at:new Date().toISOString()})
    .eq("provider_email_id",mailId).eq("direction","outgoing")
    .in("status",allowed);
  if(updated.error)return unavailable();
  return ack();
}
