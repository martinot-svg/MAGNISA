import {describe,it,expect} from "vitest";
import {buildTldCatalog,getMatchingSuffix,parseIanaTlds,MG_SUFFIXES} from "./tld-catalog";
const fixture="# Version 2026111400\n"+["com","mg","org","net","tech","digital","finance","store","school","agency",...Array.from({length:1000},(_,i)=>"z"+String(i).padStart(4,"0"))].join("\n");
describe("Catalogue officiel Magnibox",()=>{
 it("rejette une liste non officielle ou tronquée",()=>{
   expect(()=>parseIanaTlds("com\nmg")).toThrow();
   expect(parseIanaTlds(fixture)).toContain("mg");
 });
 it("classe les vraies extensions sans inventer de TLD",()=>{
   const entries=buildTldCatalog(parseIanaTlds(fixture));
   for (const [suffix,category] of [[".com","international"],[".tech","technologie"],[".finance","finance"],[".store","commerce"],[".agency","professionnel"],[".school","sectoriel"],[".mg","madagascar"]]) {
     expect(entries.find(x=>x.suffix===suffix)?.category).toBe(category);
   }
   expect(entries.find(x=>x.suffix===".com.mg")?.type).toBe("suffixe_compose");
   expect(entries.find(x=>x.suffix===".net.mg")?.status).toBe("non_verifie");
   expect(entries.find(x=>x.suffix===".gov.mg")?.status).toBe("restreint");
   expect(entries.every(x=>x.registrationAvailability==="non_verifiee")).toBe(true);
 });
 it("ne présente pas une zone de second niveau comme TLD de la racine",()=>{
   const entries=buildTldCatalog(parseIanaTlds(fixture));
   expect(MG_SUFFIXES).toContain("com.mg");
   expect(entries.filter(x=>x.type==="tld"&&x.suffix===".com.mg")).toHaveLength(0);
   expect(getMatchingSuffix("societe.com.mg",entries).suffix).toBe(".com.mg");
   expect(getMatchingSuffix("societe.tech",entries).suffix).toBe(".tech");
   expect(()=>getMatchingSuffix("societe.inconnue",entries)).toThrow();
   expect(()=>getMatchingSuffix("societe..mg",entries)).toThrow();
 });
});
