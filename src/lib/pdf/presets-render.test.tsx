import {describe,it,expect} from "vitest";
import React from "react";
import {renderToBuffer} from "@react-pdf/renderer";
import {DOCUMENT_PRESETS} from "../document-presets";
import {renderPdf} from "./document";
import {renderPayslipPdf} from "./payslip";
import {Report} from "./report";
import {mkdirSync,writeFileSync} from "node:fs";

const results:Array<{id:string;type:string;bytes:number;pdfHeader:boolean;pdfEof:boolean;ok:boolean;error?:string}>=[];
const exampleLines=Array.from({length:32},(_,i)=>({description:"Ligne de test "+(i+1)+" - prestation avec accents é è à ô",quantity:1,unitPrice:12500,discountPct:0,taxRate:0,total:12500}));
async function renderPreset(p:typeof DOCUMENT_PRESETS[number]):Promise<Buffer>{
 const conf=p.configuration;
 if(p.type==="invoice"||p.type==="quote"){
  return renderPdf({type:p.type==="invoice"?"FACTURE":"DEVIS",number:"TEST-EXCLUSIVEMENT",company:"ENTREPRISE DE TEST - NON OFFICIEL",customer:"CLIENT FICTIF POUR TEST TECHNIQUE",issueDate:"2026-01-01",dueDate:null,lines:exampleLines,subtotal:400000,discountTotal:0,taxTotal:0,total:400000,currency:"MGA",template:conf,legalMentions:"Document de test sans valeur légale."});
 }
 if(p.type==="payslip"){
  return renderPayslipPdf({company:"ENTREPRISE DE TEST - NON OFFICIEL",employee:"SALARIÉ FICTIF POUR TEST TECHNIQUE",number:"TEST-EXCLUSIVEMENT",period:"2026-01",currency:"MGA",status:"calculated",values:{base_salary:400000,gross_pay:400000,net_pay:400000},template:conf});
 }
 return renderToBuffer(Report({company:"ENTREPRISE DE TEST - NON OFFICIEL",currency:"MGA",m:{revenue:400000,receipts:250000,expenses:100000,receivables:150000,cash_available:150000,overdue_invoice_count:0},template:conf}));
}
describe("Rendu PDF réel des 32 modèles originaux (données fictives uniquement en mémoire)",()=>{
 for(const preset of DOCUMENT_PRESETS){
  it(preset.id+" : génère un PDF valide",async()=>{
   try{
    const pdf=await renderPreset(preset);
    const pdfHeader=pdf.subarray(0,5).toString("latin1")==="%PDF-";
    const pdfEof=pdf.subarray(Math.max(0,pdf.length-1024)).toString("latin1").includes("%%EOF");
    const ok=pdfHeader&&pdfEof&&pdf.length>1000;
    results.push({id:preset.id,type:preset.type,bytes:pdf.length,pdfHeader,pdfEof,ok});
    expect(ok).toBe(true);
   }catch(error){
    results.push({id:preset.id,type:preset.type,bytes:0,pdfHeader:false,pdfEof:false,ok:false,error:String(error)});
    throw error;
   }
  },45000);
 }
 it("inscrit les résultats vérifiables des 32 rendus",()=>{
  mkdirSync("test-results",{recursive:true});
  writeFileSync("test-results/document-presets-pdf.json",JSON.stringify({kind:"technical-PDF-generation-only",generatedAt:new Date().toISOString(),results},null,2));
  expect(results.length).toBe(32);
  expect(results.every(x=>x.ok)).toBe(true);
 });
});
