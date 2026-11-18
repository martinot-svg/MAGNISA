import {describe,it,expect} from "vitest";
import {normalizeMagniboxTenantLabel,suggestMagniboxTenantLabel} from "./platform-domains";

describe("MAGNIBOX free platform domain labels",()=>{
  it("normalizes accepted labels without changing their public identity",()=>{
    expect(normalizeMagniboxTenantLabel("mitalia-2026")).toBe("mitalia-2026");
  });
  it("rejects dots, at-signs, underscores, whitespace and oversized labels",()=>{
    for(const value of ["a","bad.name","bad@name","bad_name","two words","a".repeat(46),""]) {
      expect(()=>normalizeMagniboxTenantLabel(value)).toThrow();
    }
  });
  it("suggests an ASCII tenant label from a company name",()=>{
    expect(suggestMagniboxTenantLabel("Mitalia Digital & Services")).toBe("mitalia-digital-services");
    expect(suggestMagniboxTenantLabel("École")).toBe("ecole");
    expect(suggestMagniboxTenantLabel("")).toBe("entreprise");
  });
});
