import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { createExpense } from "@/server/actions/core";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";

export default async function Expenses(){
  const ctx=await requireOrganization();
  await requirePermission(ctx,"treasury.view");
  const {supabase,organizationId}=ctx;
  const [{data:expenses=[]},{data:accounts=[]},{data:expenseAccounts=[]},{data:org}]=await Promise.all([
    supabase.from("expenses").select("*").eq("organization_id",organizationId).order("expense_date",{ascending:false}),
    supabase.from("financial_accounts").select("id,name").eq("organization_id",organizationId).eq("is_active",true),
    supabase.from("pcg2005_accounts").select("code,label").eq("kind","expense").order("code"),
    supabase.from("organizations").select("currency").eq("id",organizationId).single()
  ]);
  return <>
    <div className="pageHead"><div><h1>Charges & dépenses</h1><p>Chaque dépense payée est comptabilisée avec le compte de charge PCG sélectionné et le compte de trésorerie réellement utilisé.</p></div></div>
    <div className="twoCols">
      <section>{!expenses.length?<EmptyState title="Aucune dépense" description="Aucun montant artificiel n'est affiché."/>:<div className="tableWrap"><table><thead><tr><th>Date</th><th>Compte</th><th>Description</th><th className="right">Montant</th></tr></thead><tbody>{expenses.map((e:any)=><tr key={e.id}><td>{e.expense_date}</td><td>{e.expense_account_code||e.category}</td><td>{e.description}</td><td className="right">{money(e.amount,org?.currency||"MGA")}</td></tr>)}</tbody></table></div>}</section>
      <section className="card"><h2>Nouvelle dépense</h2>
        <form action={createExpense} className="form">
          <input type="hidden" name="idempotency_key" value={randomUUID()}/>
          <div className="field"><label>Description</label><input name="description" required/></div>
          <div className="field"><label>Compte de charge PCG 2005</label><select name="category" required><option value="">Sélectionner</option>{expenseAccounts.map((a:any)=><option key={a.code} value={a.code}>{a.code} - {a.label}</option>)}</select><p className="muted">MAGNISA n'invente plus une imputation à partir du texte libre. Le compte choisi est celui utilisé dans l'écriture.</p></div>
          <div className="field"><label>Montant</label><input name="amount" type="number" min="0.01" step="0.01" required/></div>
          <div className="field"><label>Date</label><input name="expense_date" type="date" required/></div>
          <div className="field"><label>Compte payé</label><select name="financial_account_id" required><option value="">Sélectionner</option>{accounts.map((a:any)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div className="field"><label>Durée d'utilisation estimée (mois, uniquement si une immobilisation est enregistrée)</label><input name="useful_life_months" type="number" min="12" max="120" step="1"/><p className="muted">Les immobilisations doivent être traitées dans le registre des immobilisations. Ce champ n'impute pas automatiquement une charge en immobilisation.</p></div>
          <button className="button primary" disabled={!accounts.length||!expenseAccounts.length}>Enregistrer</button>
        </form>
      </section>
    </div>
  </>
}
