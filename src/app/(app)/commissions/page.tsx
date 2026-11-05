import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import {
  addProspectContributor,
  calculateProspectCommission,
  recordCommissionPayment,
  reviewProspectCommission,
  saveCommissionPolicy,
} from "@/server/actions/commissions";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
const roleLabels: Record<string, string> = {
  originator: "Apporteur", qualifier: "Qualificateur", negotiator: "Négociateur", closer: "Convertisseur",
};

export default async function CommissionsPage() {
  const ctx = await requireOrganization();
  const [canOwn, canTeam, canManagePolicy, canCalculate, canApprove, canPay, canContribute] = await Promise.all([
    hasPermission(ctx, "commissions.view_own"),
    hasPermission(ctx, "commissions.view_team"),
    hasPermission(ctx, "commissions.policy.manage"),
    hasPermission(ctx, "commissions.calculate"),
    hasPermission(ctx, "commissions.approve"),
    hasPermission(ctx, "commissions.pay"),
    hasPermission(ctx, "commissions.contribute"),
  ]);
  if (!canOwn && !canTeam && !canManagePolicy) redirect("/dashboard?access=denied");

  const [{ data: policies = [] }, { data: calculations = [] }, { data: prospects = [] }] = await Promise.all([
    ctx.supabase.from("commission_policies")
      .select("id,name,is_active,calculation_basis,commission_rate,fixed_basis_amount,currency,effective_from,effective_until,commission_policy_rules(contribution_type,share_percentage)")
      .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }),
    ctx.supabase.from("commission_calculations")
      .select("id,prospect_id,customer_id,basis_amount,commission_total,currency,status,calculated_at,policy_snapshot,commission_allocations(id,user_id,contribution_type,share_percentage,amount,commission_payments(id,amount,paid_at,payment_reference))")
      .eq("organization_id", ctx.organizationId).order("calculated_at", { ascending: false }).limit(100),
    ctx.supabase.from("prospects").select("id,name,status,converted_customer_id")
      .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }),
  ]);
  const pending = calculations.filter((item: any) => item.status === "calculated");
  const approved = calculations.filter((item: any) => item.status === "approved");

  return (
    <>
      <div className="pageHead"><div><h1>Primes et commissions</h1><p>Attribution des contributions, calcul selon la politique active et validation par la finance.</p></div></div>
      <div className="section">
        <div className="grid grid-3">
          <div className="card"><div className="muted">Politiques actives</div><strong className="metric">{policies.filter((p: any) => p.is_active).length}</strong></div>
          <div className="card"><div className="muted">En attente de finance</div><strong className="metric">{pending.length}</strong></div>
          <div className="card"><div className="muted">Calculs validés</div><strong className="metric">{approved.length}</strong></div>
        </div>
      </div>

      {canManagePolicy && <div className="section">
        <h2>Politiques de primes</h2>
        <p className="muted">La politique détermine la base financière, le taux de prime et les parts des contributeurs. Chaque calcul conserve une copie figée de la politique. Les parts des rôles absents sont redistribuées proportionnellement entre les rôles représentés.</p>
        <form action={saveCommissionPolicy} className="form card">
          <div className="field"><label>Nom de la politique</label><input name="name" required minLength={2} /></div>
          <div className="field"><label>Description</label><input name="description" /></div>
          <div className="grid grid-3">
            <div className="field"><label>Base financière</label><select name="calculation_basis" required defaultValue="order_total"><option value="order_total">Montant total d'une commande</option><option value="invoice_paid_amount">Montant encaissé d'une facture</option><option value="fixed_amount">Montant fixe défini par la politique</option></select></div>
            <div className="field"><label>Taux de prime (%)</label><input name="commission_rate" type="number" min="0.0001" max="100" step="0.0001" defaultValue="100" required /></div>
            <div className="field"><label>Montant fixe de base</label><input name="fixed_basis_amount" type="number" min="0.01" step="0.01" placeholder="Uniquement pour base fixe" /></div>
            <div className="field"><label>Devise</label><input name="currency" defaultValue="MGA" pattern="[A-Z]{3}" required /></div>
            <div className="field"><label>Applicable à partir du</label><input name="effective_from" type="date" required /></div>
            <div className="field"><label>Fin de validité</label><input name="effective_until" type="date" /></div>
          </div>
          <h3>Répartition des 100 % entre les rôles</h3>
          <div className="grid grid-4">
            {Object.entries(roleLabels).map(([key, label]) => <div className="field" key={key}><label>{label} (%)</label><input name={key} type="number" min="0.0001" max="100" step="0.0001" placeholder="0" /></div>)}
          </div>
          <label className="inline"><input type="checkbox" name="is_active" /> Activer cette politique dès sa date de début</label>
          <button className="button primary">Enregistrer la politique</button>
        </form>
        <div className="tableWrap"><table><thead><tr><th>Politique</th><th>Base</th><th>Taux</th><th>Répartition</th><th>État</th></tr></thead><tbody>
          {policies.map((policy: any) => <tr key={policy.id}>
            <td><strong>{policy.name}</strong><div className="muted">{policy.id}</div></td>
            <td>{policy.calculation_basis === "order_total" ? "Commande" : policy.calculation_basis === "invoice_paid_amount" ? "Encaissement facture" : "Montant fixe"}</td>
            <td>{policy.commission_rate}%</td>
            <td>{(policy.commission_policy_rules || []).map((rule: any) => roleLabels[rule.contribution_type] + " " + rule.share_percentage + "%").join(" · ")}</td>
            <td><span className="badge">{policy.is_active ? "Active" : "Inactive"}</span></td>
          </tr>)}
        </tbody></table></div>
      </div>}

      {canContribute && <div className="section">
        <h2>Déclarer une contribution</h2>
        <p className="muted">Tout membre actif autorisé peut déclarer sa propre contribution. Cette déclaration ne crée pas automatiquement une prime.</p>
        <form action={addProspectContributor} className="form card">
          <div className="field"><label>Prospect</label><select name="prospect_id" required defaultValue=""><option value="" disabled>Choisir un prospect</option>{prospects.map((prospect: any) => <option key={prospect.id} value={prospect.id}>{prospect.name} · {prospect.status}</option>)}</select></div>
          <div className="field"><label>Rôle joué</label><select name="contribution_type" required defaultValue="qualifier"><option value="originator">Apporteur</option><option value="qualifier">Qualificateur</option><option value="negotiator">Négociateur</option><option value="closer">Convertisseur</option></select></div>
          <div className="field"><label>Précision sur la contribution</label><textarea name="notes" rows={2} maxLength={1000} /></div>
          <button className="button">Enregistrer ma contribution</button>
        </form>
      </div>}

      {canCalculate && <div className="section">
        <h2>Calculer une prime</h2>
        <p className="muted">Le calcul est autorisé uniquement après conversion du prospect. La base est lue dans la commande, la facture ou la politique fixe, jamais acceptée comme un montant libre saisi.</p>
        <form action={calculateProspectCommission} className="form card">
          <div className="field"><label>Prospect converti</label><select name="prospect_id" required defaultValue=""><option value="" disabled>Choisir un prospect converti</option>{prospects.filter((prospect: any) => prospect.converted_customer_id).map((prospect: any) => <option key={prospect.id} value={prospect.id}>{prospect.name}</option>)}</select></div>
          <div className="field"><label>Politique</label><select name="policy_id" required defaultValue=""><option value="" disabled>Choisir une politique</option>{policies.filter((p: any) => p.is_active).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="field"><label>Type de pièce source (selon la politique)</label><select name="source_document_type" defaultValue=""><option value="">Aucune, base fixe</option><option value="order">Commande</option><option value="invoice">Facture</option></select></div>
          <div className="field"><label>Identifiant de la pièce source</label><input name="source_document_id" placeholder="UUID commande ou facture" /></div>
          <button className="button primary">Calculer et soumettre à la finance</button>
        </form>
      </div>}

      <div className="section">
        <h2>{canTeam ? "Toutes les primes" : "Mes primes"}</h2>
        {!calculations.length ? <p className="muted">Aucun calcul de prime enregistré.</p> : <div className="tableWrap"><table>
          <thead><tr><th>Prospect</th><th>Base</th><th>Prime</th><th>État</th><th>Contributeurs et paiements</th><th>Action</th></tr></thead>
          <tbody>{calculations.map((item: any) => <tr key={item.id}>
            <td><strong>{item.prospect_id}</strong><div className="muted">Client : {item.customer_id}</div></td>
            <td>{money(Number(item.basis_amount), item.currency)}</td>
            <td>{money(Number(item.commission_total), item.currency)}</td>
            <td><span className="badge">{item.status === "calculated" ? "En attente finance" : item.status === "approved" ? "Validée" : "Rejetée"}</span></td>
            <td>{(item.commission_allocations || []).filter((a: any) => canTeam || a.user_id === ctx.user.id).map((allocation: any) => {
              const paid = (allocation.commission_payments || []).reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
              const balance = Number(allocation.amount) - paid;
              return <div key={allocation.id} style={{ marginBottom: 10 }}>
                <strong>{roleLabels[allocation.contribution_type]}</strong> · {allocation.user_id.slice(0, 8)} · {allocation.share_percentage} %
                <div>{money(Number(allocation.amount), item.currency)} · payé {money(paid, item.currency)} · reste {money(balance, item.currency)}</div>
                {canPay && item.status === "approved" && balance > 0 && <form action={recordCommissionPayment} className="inline">
                  <input type="hidden" name="allocation_id" value={allocation.id} />
                  <input name="amount" type="number" min="0.01" max={balance} step="0.01" defaultValue={balance} required aria-label="Montant payé" />
                  <input name="paid_at" type="date" required aria-label="Date de paiement" />
                  <input name="reference" placeholder="Référence du paiement" required aria-label="Référence" />
                  <button className="button small">Enregistrer paiement</button>
                </form>}
              </div>;
            })}</td>
            <td>{canApprove && item.status === "calculated" ? <div style={{ display: "grid", gap: 8 }}>
              <form action={reviewProspectCommission}><input type="hidden" name="calculation_id" value={item.id} /><input type="hidden" name="decision" value="approve" /><button className="button primary small">Valider</button></form>
              <form action={reviewProspectCommission}><input type="hidden" name="calculation_id" value={item.id} /><input type="hidden" name="decision" value="reject" /><input name="reason" placeholder="Motif obligatoire" required /><button className="button danger small">Rejeter</button></form>
            </div> : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>
    </>
  );
}
