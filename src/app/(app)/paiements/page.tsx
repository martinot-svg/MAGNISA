import { randomUUID } from "node:crypto";
import { PaymentEntryForm } from "@/components/payment-entry-form";
import { FormDialog } from "@/components/form-dialog";
import { requirePermission } from "@/lib/permissions";
import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { recordCustomerPaymentV2 } from "@/server/actions/accounting";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { operatorLabel, normalizeMobileMoneyOperator } from "@/lib/mobile-money-tariffs";

export default async function Payments({searchParams}:{searchParams:Promise<{enregistrement?:string}>}){
 const {enregistrement}=await searchParams; const ctx=await requireOrganization(); await requirePermission(ctx,"treasury.view"); const {supabase,organizationId}=ctx;
 const [{data:payments=[]},{data:invoices=[]},{data:accounts=[]},{data:org}]=await Promise.all([
  supabase.from("payments").select("id,magnisa_reference,reference,amount,method,paid_at,status,invoice_id,customer_id,mobile_operator,mobile_money_fee_amount,mobile_money_fee_reimbursement,mobile_money_fee_bearer,invoices(number),customers(name,email)").eq("organization_id",organizationId).order("paid_at",{ascending:false}),
  supabase.from("invoices").select("id,number,balance_due,customers(name)").eq("organization_id",organizationId).in("status",["issued","partially_paid","overdue"]).gt("balance_due",0),
  supabase.from("financial_accounts").select("id,name,type,details,mvola_account_category").eq("organization_id",organizationId).eq("is_active",true),
  supabase.from("organizations").select("currency").eq("id",organizationId).single()
 ]);
 const paymentForm=<PaymentEntryForm key={randomUUID()} action={recordCustomerPaymentV2} requestKey={randomUUID()} currency={org?.currency||"MGA"} invoices={invoices.map((i:any)=>({id:i.id,number:i.number,balance_due:Number(i.balance_due),customerName:i.customers?.name||"Client"}))} accounts={accounts.map((a:any)=>({id:a.id,name:a.name,type:a.type,category:a.mvola_account_category||a.details?.account_type||null}))}/>;
 return <><div className="pageHead"><div><h1>Paiements</h1><p>Un paiement confirmé réduit la créance et augmente le compte financier choisi.</p></div><div className="actions"><FormDialog title="Enregistrer un paiement" buttonLabel="+ Enregistrer un paiement">{paymentForm}</FormDialog></div></div>
 {enregistrement==="succes"&&<div className="card" role="status"><strong>Paiement enregistré avec succès.</strong> Le formulaire a été réinitialisé pour un nouveau paiement.</div>}
 <div className="section"><section>{!payments.length?<EmptyState title="Aucun paiement" description="Les paiements apparaîtront ici lorsqu'ils seront réellement enregistrés."/>:<div className="tableWrap"><table><thead><tr><th>Date</th><th>Facture</th><th>Client</th><th>Mode</th><th>Opérateur</th><th>Référence MAGNISA</th><th>Référence externe / reçu</th><th className="right">Facture réglée</th><th className="right">Frais Mobile Money</th><th className="right">Total reçu</th><th>Action</th></tr></thead><tbody>{payments.map((p:any)=>{const op=normalizeMobileMoneyOperator(p.mobile_operator);const reimb=Number(p.mobile_money_fee_reimbursement||0);return <tr key={p.id}><td>{p.paid_at}</td><td>{p.invoices?.number}</td><td>{p.customers?.name}</td><td>{p.method}</td><td>{op?operatorLabel(op):"-"}</td><td><code>{p.magnisa_reference||"-"}</code></td><td>{p.reference||"-"}</td><td className="right">{money(p.amount,org?.currency||"MGA")}</td><td className="right">{reimb?money(reimb,org?.currency||"MGA"):p.mobile_money_fee_amount?money(p.mobile_money_fee_amount,org?.currency||"MGA"):"-"}</td><td className="right">{money(Number(p.amount)+reimb,org?.currency||"MGA")}</td><td>{p.customers?.email&&<Link className="button" href={`/magnimail?composeTo=${encodeURIComponent(p.customers.email)}&customerId=${p.customer_id}&templateKey=payment_confirmation&numero=${encodeURIComponent(p.invoices?.number||p.reference||"paiement")}&paymentId=${p.id}&invoiceId=${p.invoice_id||""}`}>Confirmer par e-mail</Link>}</td></tr>})}</tbody></table></div>}</section></div></>;
}
