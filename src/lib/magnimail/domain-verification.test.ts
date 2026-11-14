import { describe, expect, it, vi } from "vitest";
import {
  assertMGMailActivation,
  inspectResendDomain,
  normalizeMGMailDomain,
  publicAddressDomain,
} from "./domain-verification";

const VERIFIED = {
  id:"domain_verified_test",name:"monentreprise.mg",status:"verified",
  capabilities:{sending:"enabled",receiving:"enabled"},
  records:[
    {record:"DKIM",status:"verified"},
    {record:"SPF",status:"verified"},
    {record:"Receiving",status:"verified"},
  ],
};

describe("MGMail — preuve d'un domaine Internet réel",()=>{
  it("accepte une adresse nominative uniquement sur un vrai domaine",()=>{
    expect(normalizeMGMailDomain(" MonEntreprise.MG ")).toBe("monentreprise.mg");
    expect(publicAddressDomain("FRANCKY@MonEntreprise.MG")).toBe("monentreprise.mg");
  });
  it.each(["mycompany.mgmail","mycompany.mail","example..org","-bad.com","localhost","bad domain.com"])
    ("refuse les domaines invalides et alias internes : %s",(domain)=>{
      expect(()=>normalizeMGMailDomain(domain)).toThrow();
    });
  it("interroge uniquement l'API fournisseur en lecture et exige l'ID exact",async()=>{
    const fetcher=vi.fn<typeof fetch>(async (_url,options)=>{
      expect(_url).toBe("https://api.resend.com/domains/domain_verified_test");
      expect(options?.method).toBe("GET");
      return Response.json(VERIFIED);
    });
    const result=await inspectResendDomain("re_test","domain_verified_test","monentreprise.mg",fetcher);
    expect(result).toMatchObject({
      domain:"monentreprise.mg",sendingVerified:true,receivingVerified:true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(()=>assertMGMailActivation("finance@monentreprise.mg",result,true)).not.toThrow();
  });
  it("refuse un autre domaine même lorsque Resend le considère vérifié",async()=>{
    await expect(inspectResendDomain("re_test","domain_verified_test","mitalia.digital",
      async()=>Response.json(VERIFIED))).rejects.toThrow(/identité exacte/);
  });
  it("ne confond pas vérification partielle et activation",async()=>{
    const result=await inspectResendDomain("re_test","domain_verified_test","monentreprise.mg",
      async()=>Response.json({...VERIFIED,status:"partially_verified"}));
    expect(result.sendingVerified).toBe(false);
    expect(result.receivingVerified).toBe(false);
    expect(()=>assertMGMailActivation("finance@monentreprise.mg",result,true)).toThrow();
  });
  it("refuse une réception dont le MX n'est pas vérifié",async()=>{
    const result=await inspectResendDomain("re_test","domain_verified_test","monentreprise.mg",
      async()=>Response.json({...VERIFIED,records:VERIFIED.records.map(r=>
        r.record==="Receiving"?{...r,status:"pending"}:r)}));
    expect(result.sendingVerified).toBe(true);
    expect(result.receivingVerified).toBe(false);
    expect(()=>assertMGMailActivation("finance@monentreprise.mg",result,true)).toThrow();
    expect(()=>assertMGMailActivation("finance@monentreprise.mg",result,false)).not.toThrow();
  });
  it("n'expose aucune possibilité d'activer en cas de fournisseur indisponible",async()=>{
    await expect(inspectResendDomain("re_test","domain_verified_test","monentreprise.mg",
      async()=>new Response("",{status:401}))).rejects.toThrow(/HTTP 401/);
  });
});
