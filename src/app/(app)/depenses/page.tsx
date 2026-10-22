import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { createExpense } from "@/server/actions/core";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";

export default async function Expenses() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "treasury.view");
  const { supabase, organizationId } = ctx;
  const [{ data: expenses = [] }, { data: accounts = [] }, { data: pcg = [] }, { data: suppliers = [] }, { data: org }] = await Promise.all([
    supabase.from("expenses").select("*").eq("organization_id", organizationId).order("expense_date", { ascending: false }),
    supabase.from("financial_accounts").select("id,name,type").eq("organization_id", organizationId).eq("is_active", true),
    supabase.from("pcg2005_accounts").select("code,label,kind").in("kind", ["expense", "asset"]).order("code"),
    supabase.from("suppliers").select("id,name").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);
  const currency = org?.currency || "MGA";

  return <>
    <div className="pageHead"><div><h1>Charges & dépenses</h1><p>La nature économique et le compte PCG sont déterminés avant la génération automatique de l’écriture.</p></div></div>
    <div className="twoCols">
      <section>
        {!expenses.length ? <EmptyState title="Aucune dépense" description="Aucune opération comptable n'a encore été enregistrée." /> :
          <div className="tableWrap"><table><thead><tr><th>Date</th><th>Compte</th><th>Nature</th><th>Description</th><th>Frais entreprise</th><th className="right">Montant</th></tr></thead><tbody>
            {expenses.map((e: any) => <tr key={e.id}><td>{e.expense_date}</td><td>{e.expense_account_code || e.category}</td><td>{e.expense_nature || "expense"}</td><td>{e.description}</td><td>{Number(e.fee_company_amount || 0) ? money(e.fee_company_amount, currency) : "-"}</td><td className="right">{money(e.amount, currency)}</td></tr>)}
          </tbody></table></div>}
      </section>
      <section className="card">
        <h2>Nouvelle dépense</h2>
        <form action={createExpense} className="form">
          <input type="hidden" name="idempotency_key" value={randomUUID()} />
          <div className="field"><label>Description</label><input name="description" required /></div>
          <div className="field"><label>Nature de l'opération</label><select name="expense_nature" defaultValue="expense" required><option value="expense">Charge courante</option><option value="fixed_asset">Immobilisation</option><option value="advance">Avance</option><option value="tax">Impôt ou taxe</option><option value="social">Obligation sociale</option><option value="other">Autre opération</option></select></div>
          <div className="field"><label>Compte PCG de débit</label><select name="category" required><option value="">Sélectionner</option>{pcg.map((a: any) => <option key={a.code} value={a.code}>{a.code} - {a.label}</option>)}</select><p className="muted">Le compte est contrôlé contre le plan PCG actif. Aucun code comptable n'est inventé par le formulaire.</p></div>
          <div className="grid2"><div className="field"><label>Montant</label><input name="amount" type="number" min="0.01" step="0.01" required /></div><div className="field"><label>Date</label><input name="expense_date" type="date" required /></div></div>
          <div className="field"><label>Fournisseur, si applicable</label><select name="supplier_id"><option value="">Aucun</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="field"><label>Référence justificatif</label><input name="document_reference" placeholder="Facture, reçu, transaction..." /></div>
          <div className="field"><label>Compte payé</label><select name="financial_account_id" required><option value="">Sélectionner</option>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}</select></div>
          <div className="field"><label>Prise en charge des frais</label><select name="fee_bearer" defaultValue="none"><option value="none">Aucun frais</option><option value="company">Entreprise</option><option value="client">Client</option><option value="shared">Partagé</option></select></div>
          <div className="grid2"><div className="field"><label>Frais totaux</label><input name="fee_amount" type="number" min="0" step="0.01" defaultValue="0" /></div><div className="field"><label>Part entreprise</label><input name="fee_company_amount" type="number" min="0" step="0.01" defaultValue="0" /></div><div className="field"><label>Part client</label><input name="fee_client_amount" type="number" min="0" step="0.01" defaultValue="0" /></div></div>
          <div className="field"><label>Durée d'utilisation, si immobilisation (mois)</label><input name="useful_life_months" type="number" min="1" step="1" /></div>
          <button className="button primary" disabled={!accounts.length || !pcg.length}>Enregistrer et comptabiliser</button>
        </form>
      </section>
    </div>
  </>;
}
