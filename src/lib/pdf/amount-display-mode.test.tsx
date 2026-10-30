import {describe,it,expect} from "vitest";
import {renderPdf} from "./document";
const base={
 type:"DEVIS" as const,number:"DEV-TEST",company:"Entreprise de test",customer:"Client de test",
 issueDate:"2026-10-30",dueDate:"2026-11-29",
 lines:[{description:"Prestation A",quantity:2,unitPrice:10000,discountPct:10,taxRate:20,total:21600}],
 subtotal:18000,discountTotal:2000,taxTotal:3600,total:21600,currency:"MGA"
};
describe("Affichage HT/TTC des documents commerciaux",()=>{
 for(const mode of ["ht","ttc","both","none"] as const){
  it(`génère un PDF valide en mode ${mode}`,async()=>{
   const pdf=await renderPdf({...base,template:{amountDisplayMode:mode,showAmountInWords:true}});
   expect(pdf.subarray(0,5).toString("latin1")).toBe("%PDF-");
   expect(pdf.subarray(Math.max(0,pdf.length-1024)).toString("latin1")).toContain("%%EOF");
  });
 }
});
