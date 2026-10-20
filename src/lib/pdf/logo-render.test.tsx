import {describe,it,expect} from "vitest";
import {mkdirSync,writeFileSync} from "node:fs";
import {renderToBuffer} from "@react-pdf/renderer";
import {renderPdf} from "./document";
import {renderPayslipPdf} from "./payslip";
import {Report} from "./report";

const logo="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAA8CAIAAABATAfQAAAAmklEQVR42u3dsREAERBAUcyVQHlo7Vx714TcCESi92KBWX82FXN9A+wkI0AciANxIA7EgTgQB+JAHIgDVs/Jof/rN+9U2vAwNgfiQByIA3EgDiNAHIgDcSAOxIE4EAfiQByIA8SBOBAH4kAciANxIA7EgThAHIgDcSAOxIE4EAfiQByIA6LPeLA5EAfiQByIA3EgDsSBOBAHrCZp4gWbgAIojgAAAABJRU5ErkJggg==";
const types=["quote","invoice","payslip","report"] as const;
async function make(type:typeof types[number],showLogo:boolean){
 const template={showLogo,primaryColor:"#245cce",fontFamily:"Helvetica"};
 if(type==="quote"||type==="invoice")return renderPdf({type:type==="invoice"?"FACTURE":"DEVIS",number:"LOGO-QA",company:"ENTREPRISE DE TEST",customer:"TEST",issueDate:"2026-01-01",lines:[{description:"TEST",quantity:1,unitPrice:500,discountPct:0,taxRate:0,total:500}],subtotal:500,taxTotal:0,total:500,currency:"MGA",logoUrl:logo,template});
 if(type==="payslip")return renderPayslipPdf({company:"ENTREPRISE DE TEST",employee:"TEST",number:"LOGO-QA",period:"2026-01",currency:"MGA",status:"calculated",values:{net_pay:500},logoUrl:logo,template});
 return renderToBuffer(Report({company:"ENTREPRISE DE TEST",currency:"MGA",m:{},logoUrl:logo,template}));
}
describe("Insertion et désactivation du logo par type de document",()=>{
 for(const type of types)for(const showLogo of [true,false]){
  it(type+" / "+(showLogo?"logo actif":"logo masqué"),async()=>{
   const buffer=await make(type,showLogo);
   expect(buffer.subarray(0,5).toString()).toBe("%PDF-");
   const pdfText=buffer.toString("latin1");
   expect(pdfText.includes("/Subtype /Image")).toBe(showLogo);
   mkdirSync("test-results/logos",{recursive:true});
   writeFileSync("test-results/logos/"+type+"-"+(showLogo?"active":"hidden")+".pdf",buffer);
  },45000);
 }
});
