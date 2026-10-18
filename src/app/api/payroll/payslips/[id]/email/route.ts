import {NextRequest,NextResponse} from "next/server";
import {loadPayslip} from "@/lib/payroll/payslip-document";
import {requirePermission} from "@/lib/permissions";
import {renderPayslipPdf} from "@/lib/pdf/payslip";
import {buildMimeMessage,getGmailAccess,sendGmailRaw} from "@/lib/google/gmail";
import {recordMailHistory} from "@/lib/magnimail/history";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
 const {id}=await params;const result=await loadPayslip(id);if(!result)return NextResponse.json({error:"Bulletin introuvable"},{status:404});
 await requirePermission(result.ctx,"payroll.manage");
 if(!["validated","partially_paid","paid"].includes(result.slip.status))return NextResponse.json({error:"Le bulletin doit être validé avant envoi."},{status:409});
 const p=(await request.json()) as {to?:string;subject?:string;body?:string};
 const to=String(p.to||"").trim().toLowerCase(),subject=String(p.subject||"").trim(),body=String(p.body||"").trim();
 if(!result.email||to!==result.email.trim().toLowerCase())return NextResponse.json({error:"L'envoi est réservé à l'adresse e-mail du salarié enregistrée."},{status:403});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!subject||subject.length>180||!body||body.length>20000)return NextResponse.json({error:"E-mail invalide."},{status:400});
 const pdf=await renderPayslipPdf(result.data);
 const {connection,accessToken}=await getGmailAccess(result.ctx.organizationId,result.ctx.user.id);
 const sent=await sendGmailRaw(accessToken,buildMimeMessage({from:connection.email,to,subject,body,pdf:Buffer.from(pdf),filename:result.data.number+".pdf"}));
 await recordMailHistory({organizationId:result.ctx.organizationId,connectionId:connection.id,provider:"google",providerMessageId:sent.id,providerThreadId:sent.threadId,direction:"outgoing",fromEmail:connection.email,toEmails:[to],subject,snippet:body.slice(0,240),occurredAt:new Date().toISOString(),attachmentNames:[result.data.number+".pdf"],createdBy:result.ctx.user.id});
 return NextResponse.json({ok:true});
 }catch(e){console.error("Payslip delivery failed",e);return NextResponse.json({error:"Envoi impossible. Vérifie la connexion Gmail et les autorisations."},{status:500})}
}
