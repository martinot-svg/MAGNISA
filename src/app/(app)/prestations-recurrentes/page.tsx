import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission, hasPermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { setRecurringServiceStatusAction } from "@/server/actions/commercial";

const frequencyLabel: Record<string, string> = {
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  semiannual: "Semestrielle",
  annual: "Annuelle",
};
const statusLabel: Record<string, string> = {
  active: "Active",
  suspended: "Suspendue",
  cancelled: "Résiliée",
  ended: "Terminée",
};

export default async function RecurringServices() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "sales.view");
  const canManage = await hasPermission(ctx, "orders.manage");
  const { supabase, organizationId } = ctx;
  const [{ data: contracts = [] }, { data: org }] = await Promise.all([
    supabase.from("recurring_service_contracts")
      .select("id,order_id,customer_id,description,quantity,unit,unit_price,tax_rate,frequency,start_date,end_date,billing_day,next_billing_date,status,suspension_reason,cancellation_reason,customers(name),orders(number),services(name)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);
  const currency = org?.currency || "MGA";
  const activeCount = contracts.filter((c: any) => c.status === "active").length;
  const dueCount = contracts.filter((c: any) => c.status === "active" && c.next_billing_date <= new Date().toISOString().slice(0, 10)).length;

  return <>
    <div className="pageHead">
      <div><p className="eyebrow">Ventes</p><h1>Prestations récurrentes</h1><p>Contrats de services périodiques et préparation des factures en brouillon.</p></div>
      <Link className="button" href="/commandes">Voir les commandes</Link>
    </div>
    <div className="grid3 section">
      <div className="card"><div className="muted">Prestations actives</div><div className="metric">{activeCount}</div></div>
      <div className="card"><div className="muted">Échéances à préparer</div><div className="metric">{dueCount}</div></div>
      <div className="card"><div className="muted">Mode de facturation</div><div className="metric" style={{fontSize:20}}>Brouillon à valider</div></div>
    </div>
    {!contracts.length ? <EmptyState title="Aucune prestation récurrente" description="Ouvre Commandes et configure une récurrence depuis une commande confirmée."/> :
      <div className="tableWrap section"><table><thead><tr><th>Prestation / client</th><th>Commande</th><th>Fréquence</th><th>Période</th><th>Prochaine échéance</th><th>Statut</th><th className="right">Montant par période</th>{canManage && <th>Actions</th>}</tr></thead><tbody>
        {contracts.map((c: any) => <tr key={c.id}>
          <td><strong>{c.description || c.services?.name}</strong><br/><span className="muted">{c.customers?.name || "Client"}</span></td>
          <td><Link href="/commandes">{c.orders?.number || "Commande"}</Link></td>
          <td>{frequencyLabel[c.frequency] || c.frequency}</td>
          <td>{c.start_date} au {c.end_date || "sans date de fin"}</td>
          <td>{c.status === "active" ? c.next_billing_date : "-"}</td>
          <td><span className="badge">{statusLabel[c.status] || c.status}</span>{c.suspension_reason && c.status === "suspended" && <p className="muted">{c.suspension_reason}</p>}{c.cancellation_reason && <p className="muted">{c.cancellation_reason}</p>}</td>
          <td className="right">{money(Number(c.quantity) * Number(c.unit_price) * (1 + Number(c.tax_rate) / 100), currency)}</td>
          {canManage && <td><div className="actions">
            {c.status === "active" && <form action={setRecurringServiceStatusAction}><input type="hidden" name="contract_id" value={c.id}/><input type="hidden" name="status" value="suspended"/><input name="reason" placeholder="Motif de suspension" minLength={3} required/><button className="button">Suspendre</button></form>}
            {c.status === "suspended" && <form action={setRecurringServiceStatusAction}><input type="hidden" name="contract_id" value={c.id}/><input type="hidden" name="status" value="active"/><button className="button">Reprendre</button></form>}
            {["active","suspended"].includes(c.status) && <form action={setRecurringServiceStatusAction}><input type="hidden" name="contract_id" value={c.id}/><input type="hidden" name="status" value="cancelled"/><input name="reason" placeholder="Motif de résiliation" minLength={3} required/><button className="button">Résilier</button></form>}
          </div></td>}
        </tr>)}
      </tbody></table></div>}
    <div className="card section"><h2>Comment fonctionne la facturation</h2><p>À l'ouverture du module Factures, MAGNISA prépare les échéances arrivées à date en brouillons. Ces brouillons restent modifiables et ne sont pas émis automatiquement.</p><p className="muted">Chaque facture garde la commande d'origine, la période de service et une trace d'audit. Une échéance ne peut pas générer deux factures actives.</p><Link className="button primary" href="/factures?filtre=draft">Voir les factures en brouillon</Link></div>
  </>;
}
