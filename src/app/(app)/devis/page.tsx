import { requirePermission } from "@/lib/permissions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { FormDialog } from "@/components/form-dialog";

async function createQuoteFromList(formData: FormData) {
  "use server";
  const { supabase, organizationId } = await requireOrganization();
  const customerId = String(formData.get("customer_id") || "");
  const serviceId = String(formData.get("service_id") || "");
  const quantity = Number(formData.get("quantity"));
  const discount = Number(formData.get("discount_pct") || 0);
  const validUntil = String(formData.get("valid_until") || "");
  const { data, error } = await supabase.rpc("create_quote_from_service", {
    p_org: organizationId,
    p_customer: customerId,
    p_service: serviceId,
    p_quantity: quantity,
    p_discount_pct: discount,
    p_valid_until: validUntil,
  });
  if (error) throw new Error(error.message);
  redirect(`/devis/${data}`);
}

export default async function Quotes() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "sales.view");
  const { supabase, organizationId } = ctx;
  const [{ data = [] }, { data: org }, { data: customers = [] }, { data: services = [] }] = await Promise.all([
    supabase.from("quotes").select("id,number,status,issue_date,valid_until,total,customers(name)").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("customers").select("id,name").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("services").select("id,name").eq("organization_id", organizationId).eq("is_active", true).order("name"),
  ]);
  return <>
    <div className="pageHead">
      <div><h1>Devis</h1><p>Brouillon, envoi, acceptation et conversion en facture.</p></div>
      <FormDialog title="Nouveau devis" buttonLabel="Nouveau devis">
        <form action={createQuoteFromList} className="form">
          <div className="field"><label>Client</label><select name="customer_id" required><option value="">Sélectionner</option>{customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label>Prestation</label><select name="service_id" required><option value="">Sélectionner</option>{services.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="grid2"><div className="field"><label>Quantité</label><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required /></div><div className="field"><label>Remise (%)</label><input name="discount_pct" type="number" min="0" max="100" step="0.01" defaultValue="0" /></div></div>
          <div className="field"><label>Valable jusqu'au</label><input name="valid_until" type="date" required /></div>
          <button className="button primary" disabled={!customers.length || !services.length}>Créer le devis</button>
          {(!customers.length || !services.length) && <p className="error">Crée au moins un client et une prestation avant de créer un devis.</p>}
        </form>
      </FormDialog>
    </div>
    {!data.length ? <EmptyState title="Aucun devis" description="Crée un devis à partir d'un client et de prestations existantes." /> : <div className="tableWrap"><table><thead><tr><th>Numéro</th><th>Client</th><th>Statut</th><th>Date</th><th className="right">Total</th><th></th></tr></thead><tbody>{data.map((q: any) => <tr key={q.id}><td>{q.number}</td><td>{q.customers?.name}</td><td><span className="badge">{q.status}</span></td><td>{q.issue_date}</td><td className="right">{money(q.total, org?.currency || "MGA")}</td><td><Link href={`/devis/${q.id}`}>Ouvrir</Link></td></tr>)}</tbody></table></div>}
  </>;
}
