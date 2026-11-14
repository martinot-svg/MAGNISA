import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { normalizePublicEmail, parsePublicRecipients } from "./address";
import { verifyResendSignedEvent, ResendInternetTransport } from "./resend";
import { internetTransportReady } from "./types";

describe("Magnisa Inbox: public e-mail transport (not yet activated)", () => {
  it("never treats .mgmail addresses as public Internet senders",()=>{
    expect(()=>normalizePublicEmail("finance@mitalia.mgmail")).toThrow();
    expect(normalizePublicEmail("Finance@Mitalia.MG")).toBe("finance@mitalia.mg");
    expect(parsePublicRecipients("contact@entreprise.com; client@autre.fr"))
      .toEqual(["contact@entreprise.com","client@autre.fr"]);
  });
  it("rejects header injection and duplicate recipients",()=>{
    expect(()=>normalizePublicEmail("finance@entreprise.mg\nBcc:someone@other.com")).toThrow();
    expect(()=>parsePublicRecipients("a@example.org;a@example.org")).toThrow();
    expect(()=>parsePublicRecipients("")).toThrow();
    expect(()=>parsePublicRecipients(Array.from({length:11},(_,i)=>`a${i}@example.com`).join(","))).toThrow();
  });
  it("requires all four independent activation gates",()=>{
    const gates={
      domainOwnershipVerified:true,sendingProviderVerified:true,
      senderActivated:true,hasProviderCredentials:true,
    };
    expect(internetTransportReady(gates)).toBe(true);
    for (const key of Object.keys(gates) as Array<keyof typeof gates>) {
      expect(internetTransportReady({...gates,[key]:false})).toBe(false);
    }
  });
  it("authenticates signed provider events, rejecting body edits and stale delivery",()=>{
    const time=1794650000000, timestamp=String(time/1000);
    const body=JSON.stringify({type:"email.received",data:{email_id:"email_12345"}});
    const secret="whsec_"+Buffer.from("x".repeat(32)).toString("base64");
    const hmac=createHmac("sha256",Buffer.from("x".repeat(32)))
      .update(`event_123.${timestamp}.${body}`).digest("base64");
    const headers={id:"event_123",timestamp,signature:"v1,"+hmac};
    expect(verifyResendSignedEvent(body,headers,secret,time)).toBe(true);
    expect(verifyResendSignedEvent(body+" ",headers,secret,time)).toBe(false);
    expect(verifyResendSignedEvent(body,headers,secret,time+300001)).toBe(false);
    expect(verifyResendSignedEvent(body,headers,"wrong",time)).toBe(false);
  });
  it("send adapter reports API acceptance, not final delivery, with idempotency",async()=>{
    const transportFetch=vi.fn<typeof fetch>(async (endpoint,opts)=>{
      expect(endpoint).toBe("https://api.resend.com/emails");
      const headers=opts?.headers as Record<string,string>;
      expect(headers["Idempotency-Key"]).toMatch(/^orbit-/);
      expect(JSON.parse(String(opts?.body)).from).toBe("finance@entreprise.mg");
      return Response.json({id:"email_1234"});
    });
    const adapter=new ResendInternetTransport("test_key",transportFetch);
    const result=await adapter.send({
      from:"finance@entreprise.mg",to:["contact@externe.com"],
      subject:"Préavis",text:"La facture sera émise demain.",
      requestId:"f2fc69a9-e2ad-4079-8b4b-6c652a16fbab",
    });
    expect(result).toEqual({provider:"resend",providerMessageId:"email_1234",state:"accepted"});
    expect(transportFetch).toHaveBeenCalledTimes(1);
  });
  it("rejects unconfigured providers and rejected API responses",async()=>{
    const payload={
      from:"finance@entreprise.mg",to:["client@externe.com"],
      subject:"Bonjour",text:"Message",requestId:"f2fc69a9-e2ad-4079-8b4b-6c652a16fbab",
    };
    await expect(new ResendInternetTransport("").send(payload)).rejects.toThrow("non configuré");
    const rejected=new ResendInternetTransport("key",async()=>new Response("",{status:403}));
    await expect(rejected.send(payload)).rejects.toThrow("HTTP 403");
  });
  it("fetches inbound mail via authenticated provider API; does not trust webhook body",async()=>{
    const fetcher=vi.fn<typeof fetch>(async endpoint=>{
      expect(endpoint).toBe("https://api.resend.com/emails/receiving/email_12345");
      return Response.json({
        from:"Client <contact@client.mg>",to:["finance@entreprise.mg"],
        subject:"Retour sur facture",text:"Bonjour, le paiement a été effectué.",
      });
    });
    const adapter=new ResendInternetTransport("key",fetcher);
    expect(await adapter.fetchReceived("email_12345")).toEqual({
      from:"contact@client.mg",to:["finance@entreprise.mg"],
      subject:"Retour sur facture",text:"Bonjour, le paiement a été effectué.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
