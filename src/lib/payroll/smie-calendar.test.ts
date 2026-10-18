import {describe,it,expect} from "vitest";
import {smieDeadlines} from "./smie-calendar";
describe("Déclarations trimestrielles SMIE",()=>{
 it("produit quatre trimestres pour 2026",()=>expect(smieDeadlines(2026)).toHaveLength(4));
 it("fixe T1 en avril 2026",()=>expect(smieDeadlines(2026)[0]).toMatchObject({windowStart:"2026-04-01",windowEnd:"2026-04-30"}));
 it("fixe T4 en janvier suivant",()=>expect(smieDeadlines(2026)[3]).toMatchObject({windowStart:"2027-01-01",windowEnd:"2027-01-31"}));
 it("gère les années bissextiles",()=>expect(smieDeadlines(2028)[0].period).toContain("2028-03-31"));
 it("rejette une année invalide",()=>expect(()=>smieDeadlines(NaN)).toThrow());
});
