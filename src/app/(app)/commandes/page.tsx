import { requirePermission, hasPermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";
import { cancelOrderAction, createRecurringServiceContractAction } from "@/server/actions/commercial";
import Link from "next/link";

async function quoteToOrder(fd: FormData) {
  "use server";
  const { supabase, organizationId } = await requireOrganization();
  const id = String(fd.get("quote_id") || "");
  const { error } = await supabase.rpc("convert_quote_to_order", { p_org: organizationId, p_quote: id });
  if (error) throw new Error(error.message);
  revalidatePath("/commandes");
}

export default async function Orders() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "sales.view");
  const canManage = await hasPermission(ctx, "orders.manage");
  const { supabase, organizationId } = ctx;
  const [{ data: org }, { data: quotes = [] }, { data: orders = [] }, { data: recurringLines = [] }] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("quotes").select("id,number,total,status,customers(name)").eq("organization_id", organizationId).eq("status", "accepted").order("created_at", { ascending: false }),
    supabase.from("orders").select("*,customers(name),invoices(id,number,status),order_lines(id,service_id,description,quantity,unit,unit_price,tax_rate,sort_order,services(name,service_type,recurrence_frequency))").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("recurring_service_contracts").select("order_line_id,status").eq("organization_id", organizationId).in("status", ["active", "suspended"]),
  ]);
  const c = org?.currency || "MGA";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Antananarivo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const billingDay = Math.min(28, Number(today.slice(8, 10)));
  const activeRecurringLines = new Set((recurringLines || []).map((r: any) => r.order_line_id));
  return <>
    <div className="pageHead"><div><p className="eyebrow">Engagement commercial</p><h1>Commandes</h1><p>Une commande conserve le lien entre le devis accepté, l'exécution de la prestation et la facture.</p></div><Link className="button" href="/prestations-recurrentes">Prestations récurrentes</Link></div>
    {quotes.length > 0 && <div className="card"><h2>Devis acceptés à transformer</h2><div className="tableWrap"><table><thead><tr><th>Devis</th><th>Client</th><th>Total</th><th></th></tr></thead><tbody>{quotes.map((q: any) => <tr key={q.id}><td>{q.number}</td><td>{q.customers?.name}</td><td>{money(Number(q.total), c)}</td><td className="right"><form action={quoteToOrder}><input type="hidden" name="quote_id" value={q.id}/><button className="button primary">Créer la commande</button></form></td></tr>)}</tbody></table></div></div>}
    <div className="section">{orders.length === 0 ? <EmptyState title="Aucune commande" description="Accepte un devis puis transforme-le en commande sans ressaisir les lignes."/> : <div className="tableWrap"><table><thead><tr><th>Commande</th><th>Client</th><th>Date</th><th>Statut</th><th>Total</th><th>Actions</th></tr></thead><tbody>{orders.map((o: any) => {
      const activeInvoice = o.invoices?.find((i: any) => i.status !== "cancelled");
      const cancellable = ["draft", "confirmed", "in_progress"].includes(o.status);
      const lines = (o.order_lines || []).filter((l: any) => l.service_id && !activeRecurringLines.has(l.id) && (Array.isArray(l.services) ? l.services[0]?.service_type : l.services?.service_type) === "recurring").sort((a: any, b: any) => a.sort_order - b.sort_order);
      const hasRecurring = (o.order_lines || []).some((l: any) => activeRecurringLines.has(l.id));
      const canConfigureRecurring = canManage && ["confirmed", "in_progress", "completed"].includes(o.status) && lines.length > 0;
      return <tr key={o.id}>
        <td><b>{o.number}</b></td><td>{o.customers?.name}</td><td>{o.order_date}</td><td><span className="badge">{o.status}</span></td><td>{money(Number(o.total), c)}</td>
        <td><div className="actions">
          {hasRecurring ? <Link className="button" href="/factures?filtre=draft">Voir les brouillons</Link> : activeInvoice ? <Link className="button" href={`/factures/${activeInvoice.id}`}>Voir la facture</Link> : cancellable && <Link className="button" href={`/factures/nouvelle?orderId=${o.id}`}>Facture</Link>}
          {cancellable && canManage && <form action={cancelOrderAction}><input type="hidden" name="order_id" value={o.id}/><input name="reason" placeholder="Motif d'annulation" minLength={3} required/><button className="button">Annuler</button></form>}
          {canConfigureRecurring && <details><summary className="button">Configurer la récurrence</summary><form action={createRecurringServiceContractAction} className="form" style={{minWidth:280,marginTop:12}}>
            <input type="hidden" name="order_id" value={o.id}/>
            <div className="field"><label>Ligne de commande</label><select name="order_line_id" required defaultValue=""><option value="" disabled>Choisir une prestation récurrente</option>{lines.map((l: any) => { const service = Array.isArray(l.services) ? l.services[0] : l.services; const frequency: Record<string, string> = { daily: "Quotidienne", weekly: "Hebdomadaire", monthly: "Mensuelle", quarterly: "Trimestrielle", semiannual: "Semestrielle", annual: "Annuelle", custom: `Tous les ${service?.custom_interval_days || 30} jours` }; return <option key={l.id} value={l.id}>{l.description} - {frequency[service?.recurrence_frequency] || "Récurrence"} - {money(Number(l.unit_price) * Number(l.quantity) * (1 + Number(l.tax_rate) / 100), c)}</option>; })}</select><small>Le type et la fréquence sont repris automatiquement du catalogue Services.</small></div>
            <div className="field"><label>Date de début</label><input type="date" name="start_date" defaultValue={today} required/></div>
            <div className="field"><label>Date de fin (facultative)</label><input type="date" name="end_date" min={today}/></div>
            <div className="field"><label>Jour de facturation (1 à 28)</label><input type="number" name="billing_day" min="1" max="28" defaultValue={billingDay} required/></div>
            <button className="button primary">Créer la prestation récurrente</button>
          </form></details>}
        </div></td>
      </tr>;
    })}</tbody></table></div>}</div>
  </>;
}
