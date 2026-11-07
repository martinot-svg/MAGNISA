import { describe, expect, it } from "vitest";
import { suggestPcgCode } from "./suggest-pcg-code";

describe("suggestPcgCode", () => {
  it("suggests account 581 for internal funds in transit", () => {
    expect(suggestPcgCode("Fonds en transit", "TRANSIT:d2234dba-bfa7-484e-b6bb-20d72ca9202b")).toBe("581");
  });

  it("suggests account 218 for durable IT equipment", () => {
    expect(suggestPcgCode("Matériel informatique", "EQUIPMENT:computer")).toBe("218");
  });

  it("suggests account 471 for identified Mvola reclassification cases", () => {
    expect(suggestPcgCode("Remboursement Mvola à reclasser", "OTHER")).toBe("471");
  });

  it("does not guess when the source account is ambiguous", () => {
    expect(suggestPcgCode("Autres opérations", "MISC:123")).toBe("");
  });
});
