import { describe, expect, it } from "vitest";
import {
  diagnoseOrbitDomainDNS, isOrbitDomainProof, orbitDnsHost, orbitDnsValue,
  validateOrbitDkimSelector,
} from "./domain-dns";

const token = "a".repeat(64);
describe("Magnisa Inbox: public DNS ownership and diagnostics", () => {
  it("requires exact, unpredictable TXT proof on the domain's dedicated host", () => {
    expect(orbitDnsHost("ENTREPRISE.MG")).toBe("_magnisa-verify.entreprise.mg");
    expect(orbitDnsValue(token)).toBe("magnisa-orbit=" + token);
    expect(isOrbitDomainProof([["magnisa-orbit=", token]],token)).toBe(true);
    expect(isOrbitDomainProof([["magnisa-orbit=" + token + "bad"]],token)).toBe(false);
    expect(isOrbitDomainProof([["prefix" + "magnisa-orbit=" + token]],token)).toBe(false);
    expect(isOrbitDomainProof([["magnisa-orbit=" + "b".repeat(64)]],token)).toBe(false);
    expect(() => orbitDnsValue("user-guessable")).toThrow();
  });
  it("checks public MX/SPF/DMARC/DKIM independently from the ownership record", async () => {
    const lookedUp: string[] = [];
    const answers: Record<string,string[][]> = {
      "_magnisa-verify.entreprise.mg": [["magnisa-orbit=",token]],
      "entreprise.mg": [["v=spf1 mx -all"]],
      "_dmarc.entreprise.mg": [["v=DMARC1; p=reject"]],
      "mail._domainkey.entreprise.mg": [["v=DKIM1; k=rsa; p=public-key"]],
    };
    const check = await diagnoseOrbitDomainDNS("entreprise.mg",token,"mail",{
      txt: async name => { lookedUp.push(name); return answers[name] ?? []; },
      mx: async () => [{exchange:"mail.entreprise.mg",priority:10}],
    });
    expect(check).toEqual({ownership:"confirmed",mx:"present",spf:"present",dmarc:"present",dkim:"present"});
    expect(lookedUp).toContain("_magnisa-verify.entreprise.mg");
    expect(lookedUp).toContain("mail._domainkey.entreprise.mg");
  });
  it("does not confuse a missing DNS record or null MX with transport readiness",async()=>{
    const check=await diagnoseOrbitDomainDNS("entreprise.com",token,undefined,{
      txt:async()=>{throw Object.assign(new Error("No records"),{code:"ENODATA"});},
      mx:async()=>[{exchange:".",priority:0}],
    });
    expect(check).toEqual({
      ownership:"absent",mx:"absent",spf:"absent",dmarc:"absent",dkim:"not_checked",
    });
  });
  it("does not treat a DNS timeout as a failed ownership claim",async()=>{
    const check=await diagnoseOrbitDomainDNS("entreprise.com",token,undefined,{
      txt:async()=>{throw Object.assign(new Error("DNS temporary"),{code:"ETIMEOUT"});},
      mx:async()=>{throw Object.assign(new Error("DNS temporary"),{code:"ETIMEOUT"});},
    });
    expect(check.ownership).toBe("unavailable");
    expect(check.mx).toBe("unavailable");
    expect(check.spf).toBe("unavailable");
  });
  it("detects duplicate SPF records and invalid DKIM selectors",async()=>{
    const check=await diagnoseOrbitDomainDNS("entreprise.org",token,undefined,{
      txt:async host=>host==="entreprise.org" ? [["v=spf1 mx -all"],["v=spf1 include:example.org ~all"]]:[],
      mx:async()=>[],
    });
    expect(check.spf).toBe("invalid");
    expect(() => validateOrbitDkimSelector("../secret")).toThrow();
  });
});
