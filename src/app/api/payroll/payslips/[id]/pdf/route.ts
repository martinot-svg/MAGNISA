import {canDocumentAction} from "@/lib/document-permissions";
import {NextResponse} from "next/server";
import {loadPayslip} from "@/lib/payroll/payslip-document";
import {renderPayslipPdf} from "@/lib/pdf/payslip";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 try{const {id}=await params;const result=await loadPayslip(id);if(!result)return new NextResponse("Bulletin introuvable",{status:404});if(!(await canDocumentAction(result.ctx,"documents.export","payslip")))return new NextResponse("Accès interdit",{status:403});
 const pdf=await renderPayslipPdf(result.data);
 return new NextResponse(pdf as BodyInit,{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${result.data.number}.pdf"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch(e){console.error("Payslip PDF failed",e);return new NextResponse("Document indisponible",{status:500})}
}
