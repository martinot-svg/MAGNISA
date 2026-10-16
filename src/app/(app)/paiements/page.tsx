import { randomUUID } from "node:crypto";
import { PaymentEntryForm } from "@/components/payment-entry-form";
import { requirePermission } from "@/lib/permissions";
import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";import { recordPayment } from "@/server/actions/core";import { EmptyState } from "@/components/empty-state";import { money } from "@/lib/money";
export default async function Payments(){const ctx=await requireOrganization();await requirePermission(ctx,"treasury.view");const {supabase,organizationId}=ctx;const [{data:payments=[]},{data:invoices=[]},{data:accounts=[]},{data:org}]=await Promise.all([supabase.from("payments").select("id,reference,amount,method,paid_at,status,invoice_id,customer_id,invoices(number),customers(name,email)").eq("organization_id",organizationId).order("paid_at",{ascending:false}),supabase.from("invoices").select("id,number,balance_due,customers(name)").eq("organization_id",organizationId).in("status",["issued","partially_paid","overdue"]).gt("balance_due",0),supabase.from("financial_accounts").select("id,name,type").eq("organization_id",organizationId).eq("is_active",true),supabase.from("organizations").select("currency").eq("id",organizationId).single()]);return <><div className="pageHead"><div><h1>Paiements</h1><p>Un paiement confirmé réduit la créance et augmente le compte financier choisi.</p></div></div><div className="twoCols"><section>{!payments.length?<EmptyState title="Aucun paiement" description="Les paiements apparaîtront ici lorsqu'ils seront réellement enregistrés."/>:<div className="tableWrap"><table><thead><tr><th>Date</th><th>Facture</th><th>Client</th><th>Mode</th><th className="right">Montant</th><th>Action</th></tr></thead><tbody>{payments.map((p:any)=><tr key={p.id}><td>{p.paid_at}</td><td>{p.invoices?.number}</td><td>{p.customers?.name}</td><td>{p.method}</td><td className="right">{money(p.amount,org?.currency||"MGA")}</td><td>{p.customers?.email&&<Link className="button" href={`/magnimail?composeTo=${encodeURIComponent(p.customers.email)}&customerId=${p.customer_id}&templateKey=payment_confirmation&numero=${encodeURIComponent(p.invoices?.number||p.reference||"paiement")}&paymentId=${p.id}&invoiceId=${p.invoice_id||""}`}>Confirmer par e-mail</Link>}</td></tr>)}</tbody></table></div>}</section><section className="card"><h2>Enregistrer un paiement</h2><PaymentEntryForm
  action={recordPayment}
  requestKey={randomUUID()}
  currency={org?.currency || "MGA"}
  invoices={invoices.map((i: any) => ({
    id: i.id,
    number: i.number,
    balance_due: Number(i.balance_due),
    customerName: i.customers?.name || "Client",
  }))}
  accounts={accounts.map((a: any) => ({
    id: a.id,
    name: a.name,
    type: a.type,
  }))}
/></section></div></>}
