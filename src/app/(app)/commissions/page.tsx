import { FormDialog } from "@/components/form-dialog";
import { randomUUID } from "node:crypto";
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
  const [canOwn, canTeam, canManagePolicy, canCalculate, canApprove, canPayRole, canRecordExpense, canViewOrders, canViewInvoices] = await Promise.all([
    hasPermission(ctx, "commissions.view_own"),
    hasPermission(ctx, "commissions.view_team"),
    hasPermission(ctx, "commissions.policy.manage"),
    hasPermission(ctx, "commissions.calculate"),
    hasPermission(ctx, "commissions.approve"),
    hasPermission(ctx, "commissions.pay"),
    hasPermission(ctx, "expenses.record"),
    hasPermission(ctx, "sales.view"),
    hasPermission(ctx, "billing.view"),
  ]);
  const canPay = canPayRole && canRecordExpense;
  if (!canOwn && !canTeam && !canManagePolicy) redirect("/dashboard?access=denied");

  const [{ data: organization }, { data: financeMembers = [] }, { data: expenseAccounts = [] }] = await Promise.all([
    ctx.supabase.from("organizations").select("currency").eq("id", ctx.organizationId).single(),
    ctx.supabase.from("organization_members").select("role")
      .eq("organization_id", ctx.organizationId).eq("status", "active"),
    ctx.supabase.from("pcg2005_accounts").select("code,label").eq("kind", "expense").order("code"),
  ]);
  const hasFinanceApprover = (financeMembers ?? []).some((member: { role: string }) =>
    member.role === "finance_manager" || member.role === "accountant"
  );
  let assignableMembers: Array<{ user_id: string; role: string; email: string }> = [];
  if (canManagePolicy) {
    const { data, error } = await ctx.supabase.rpc("list_commission_assignable_members", {
      p_org: ctx.organizationId,
    });
    if (error) throw new Error("Impossible de charger les membres autorisés.");
    assignableMembers = data ?? [];
  }
  let paymentAccounts: Array<{ id: string; name: string; type: string }> = [];
  if (canPay) {
    const { data, error } = await ctx.supabase.from("financial_accounts")
      .select("id,name,type").eq("organization_id", ctx.organizationId)
      .eq("is_active", true).order("name");
    if (error) throw new Error("Impossible de charger les comptes de trésorerie.");
    paymentAccounts = data ?? [];
  }

  const [{ data: policies = [] }, { data: calculations = [] }, { data: prospects = [] }] = await Promise.all([
    ctx.supabase.from("commission_policies")
      .select("id,name,is_active,calculation_basis,tax_basis,commission_rate,fixed_basis_amount,currency,expense_account_code,effective_from,effective_until,commission_policy_rules(contribution_type,share_percentage)")
      .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }),
    ctx.supabase.from("commission_calculations")
      .select("id,prospect_id,customer_id,basis_amount,commission_total,currency,status,calculated_at,policy_snapshot,commission_allocations(id,user_id,contribution_type,share_percentage,amount,commission_payments(id,amount,paid_at,payment_reference,expense_id,expense_reference))")
      .eq("organization_id", ctx.organizationId).order("calculated_at", { ascending: false }).limit(100),
    ctx.supabase.from("prospects").select("id,name,status,converted_customer_id")
      .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }),
  ]);
  const pending = calculations.filter((item: any) => item.status === "calculated");
  const awaitingPayment = calculations.filter((item: any) => item.status === "approved" || item.status === "partially_paid");
  const paid = calculations.filter((item: any) => item.status === "paid");
  const convertedCustomerIds = Array.from(new Set(
    (prospects ?? []).map((prospect: any) => prospect.converted_customer_id).filter(Boolean)
  )) as string[];
  const prospectNameByCustomer = new Map<string, string>(
    (prospects ?? []).filter((prospect: any) => prospect.converted_customer_id)
      .map((prospect: any) => [prospect.converted_customer_id, prospect.name] as [string, string])
  );
  let eligibleOrders: any[] = [];
  let eligibleInvoices: any[] = [];
  if (canCalculate && convertedCustomerIds.length > 0 && canViewOrders) {
    const { data, error } = await ctx.supabase.from("orders")
      .select("id,number,customer_id,subtotal,total,order_date")
      .eq("organization_id", ctx.organizationId).eq("status", "confirmed")
      .in("customer_id", convertedCustomerIds).order("order_date", { ascending: false });
    if (error) throw new Error("Impossible de charger les commandes confirmées.");
    eligibleOrders = data ?? [];
  }
  if (canCalculate && convertedCustomerIds.length > 0 && canViewInvoices) {
    const { data, error } = await ctx.supabase.from("invoices")
      .select("id,number,customer_id,subtotal,discount_total,paid_amount,issue_date")
      .eq("organization_id", ctx.organizationId).eq("status", "paid")
      .lte("balance_due", 0).gt("paid_amount", 0)
      .in("customer_id", convertedCustomerIds).order("issue_date", { ascending: false });
    if (error) throw new Error("Impossible de charger les factures entièrement soldées.");
    eligibleInvoices = data ?? [];
  }

  return (
    <>
      <div className="pageHead"><div><h1>Primes et commissions</h1><p>Attribution des contributions, calcul selon la politique active et validation par la finance.</p></div></div>
      {canManagePolicy && !hasFinanceApprover && <div className="section">
        <p className="muted">Aucun membre Finance actif n'est actuellement habilité à approuver ou enregistrer les paiements de commissions. Attribue le rôle Finance manager ou Comptable à un membre autorisé avant la première validation.</p>
      </div>}
      <div className="section">
        <div className="grid grid-4">
          <div className="card"><div className="muted">Politiques actives</div><strong className="metric">{policies.filter((p: any) => p.is_active).length}</strong></div>
          <div className="card"><div className="muted">En attente de finance</div><strong className="metric">{pending.length}</strong></div>
          <div className="card"><div className="muted">À payer / partiellement payées</div><strong className="metric">{awaitingPayment.length}</strong></div>
          <div className="card"><div className="muted">Entièrement payées</div><strong className="metric">{paid.length}</strong></div>
        </div>
      </div>

      {canPay && <p className="muted">N'enregistre ici qu'un décaissement déjà réellement effectué. MAGNISA créera la dépense, le mouvement de trésorerie et l'écriture comptable à partir du compte sélectionné.</p>}
      {canManagePolicy && <div className="section">
        <h2>Politiques de primes</h2>
        <p className="muted">La politique détermine la base financière, l'assiette HT ou TTC, le taux, les parts des contributeurs et le compte PCG de charge. HT est proposé par défaut ; choisis TTC si le contrat de commission le prévoit. Chaque calcul conserve une copie figée de ces paramètres. Une prime fondée sur une facture exige que cette facture soit entièrement soldée. Le compte PCG choisi servira à comptabiliser chaque décaissement.</p>
        <FormDialog title="Configurer la politique de commissions" buttonLabel="Enregistrer la politique"><form action={saveCommissionPolicy} className="form card">
          <div className="field"><label>Nom de la politique</label><input name="name" required minLength={2} /></div>
          <div className="field"><label>Description</label><input name="description" /></div>
          <div className="grid grid-3">
            <div className="field"><label>Base financière</label><select name="calculation_basis" required defaultValue="order_total"><option value="order_total">Commande confirmée</option><option value="invoice_paid_amount">Facture entièrement encaissée</option><option value="fixed_amount">Montant fixe défini par la politique</option></select></div>
            <div className="field"><label>Assiette</label><select name="tax_basis" required defaultValue="net"><option value="net">Hors taxes (HT)</option><option value="gross">Toutes taxes comprises (TTC)</option></select></div>
            <div className="field"><label>Taux de prime (%)</label><input name="commission_rate" type="number" min="0.0001" max="100" step="0.0001" placeholder="Définir le taux contractuel" required /></div>
            <div className="field"><label>Montant fixe de base</label><input name="fixed_basis_amount" type="number" min="0.01" step="0.01" placeholder="Uniquement pour base fixe" /></div>
            <div className="field"><label>Devise de l'entreprise</label><input value={organization?.currency ?? "Non disponible"} readOnly /></div>
            <div className="field"><label>Compte PCG de charge</label><select name="expense_account_code" required defaultValue=""><option value="" disabled>Choisir un compte de charge</option>{(expenseAccounts ?? []).map((account: any) => <option key={account.code} value={account.code}>{account.code} · {account.label}</option>)}</select><small className="muted">622 pour un intermédiaire externe ; 641 pour un salarié. Vérifie le statut contractuel du bénéficiaire.</small></div>
            <div className="field"><label>Applicable à partir du</label><input name="effective_from" type="date" required /></div>
            <div className="field"><label>Fin de validité</label><input name="effective_until" type="date" /></div>
          </div>
          <h3>Répartition des 100 % entre les rôles</h3>
          <div className="grid grid-4">
            {Object.entries(roleLabels).map(([key, label]) => <div className="field" key={key}><label>{label} (%)</label><input name={key} type="number" min="0.0001" max="100" step="0.0001" placeholder="0" /></div>)}
          </div>
          <label className="inline"><input type="checkbox" name="is_active" /> Activer cette politique dès sa date de début</label>
          <button className="button primary">Enregistrer la politique</button>
        </form></FormDialog>
        <div className="tableWrap"><table><thead><tr><th>Politique</th><th>Base</th><th>Taux</th><th>Compte de charge</th><th>Répartition</th><th>État</th></tr></thead><tbody>
          {policies.map((policy: any) => <tr key={policy.id}>
            <td><strong>{policy.name}</strong><div className="muted">{policy.id}</div></td>
            <td>{policy.calculation_basis === "order_total" ? "Commande" : policy.calculation_basis === "invoice_paid_amount" ? "Facture soldée" : "Montant fixe"} · {policy.tax_basis === "gross" ? "TTC" : "HT"}</td>
            <td>{policy.commission_rate}%</td>
            <td>{policy.expense_account_code} · {(expenseAccounts ?? []).find((account: any) => account.code === policy.expense_account_code)?.label ?? "Compte PCG"}</td>
            <td>{(policy.commission_policy_rules || []).map((rule: any) => roleLabels[rule.contribution_type] + " " + rule.share_percentage + "%").join(" · ")}</td>
            <td><span className="badge">{policy.is_active ? "Active" : "Inactive"}</span></td>
          </tr>)}
        </tbody></table></div>
      </div>}

      {canManagePolicy && <div className="section">
        <h2>Affecter une contribution</h2>
        <p className="muted">Seuls les responsables autorisés peuvent affecter un membre actif à un prospect. Le créateur d'un prospect est automatiquement enregistré comme apporteur.</p>
        <FormDialog title="Affecter un contributeur au prospect" buttonLabel="Affecter le contributeur"><form action={addProspectContributor} className="form card">
          <div className="field"><label>Prospect</label><select name="prospect_id" required defaultValue=""><option value="" disabled>Choisir un prospect</option>{prospects.map((prospect: any) => <option key={prospect.id} value={prospect.id}>{prospect.name} · {prospect.status}</option>)}</select></div>
          <div className="field"><label>Membre actif</label><select name="user_id" required defaultValue=""><option value="" disabled>Choisir un membre</option>{assignableMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.email} · {member.role}</option>)}</select></div>
          <div className="field"><label>Contribution</label><select name="contribution_type" required defaultValue="qualifier"><option value="originator">Apporteur</option><option value="qualifier">Qualificateur</option><option value="negotiator">Négociateur</option><option value="closer">Convertisseur</option></select></div>
          <div className="field"><label>Précision sur la contribution</label><textarea name="notes" rows={2} maxLength={1000} /></div>
          <button className="button">Affecter le contributeur</button>
        </form></FormDialog>
      </div>}

      {canCalculate && <div className="section">
        <h2>Calculer une prime</h2>
        <p className="muted">Le calcul est autorisé uniquement après conversion du prospect. La base est lue dans la commande, la facture ou la politique fixe, jamais acceptée comme un montant libre saisi.</p>
        <FormDialog title="Calculer la commission du prospect" buttonLabel="Calculer la commission"><form action={calculateProspectCommission} className="form card">
          <input type="hidden" name="request_key" value={randomUUID()} />
          <div className="field"><label>Prospect converti</label><select name="prospect_id" required defaultValue=""><option value="" disabled>Choisir un prospect converti</option>{prospects.filter((prospect: any) => prospect.converted_customer_id).map((prospect: any) => <option key={prospect.id} value={prospect.id}>{prospect.name}</option>)}</select></div>
          <div className="field"><label>Politique</label><select name="policy_id" required defaultValue=""><option value="" disabled>Choisir une politique</option>{policies.filter((p: any) => p.is_active).map((p: any) => <option key={p.id} value={p.id}>{p.name} · {p.calculation_basis === "order_total" ? "Commande" : p.calculation_basis === "invoice_paid_amount" ? "Facture" : "Fixe"} · {p.tax_basis === "gross" ? "TTC" : "HT"}</option>)}</select></div>
          <div className="field"><label>Pièce source (selon la politique)</label><select name="source_document" defaultValue="">
            <option value="">Aucune pièce · base fixe</option>
            <optgroup label="Commandes confirmées">
              {eligibleOrders.map((order: any) => <option key={order.id} value={`order:${order.id}`}>
                Commande {order.number} · {prospectNameByCustomer.get(order.customer_id) ?? "Client"} · HT {money(Number(order.subtotal), organization?.currency ?? "MGA")} · TTC {money(Number(order.total), organization?.currency ?? "MGA")}
              </option>)}
            </optgroup>
            <optgroup label="Factures entièrement soldées">
              {eligibleInvoices.map((invoice: any) => <option key={invoice.id} value={`invoice:${invoice.id}`}>
                Facture {invoice.number} · {prospectNameByCustomer.get(invoice.customer_id) ?? "Client"} · HT {money(Math.max(Number(invoice.subtotal) - Number(invoice.discount_total), 0), organization?.currency ?? "MGA")} · TTC {money(Number(invoice.paid_amount), organization?.currency ?? "MGA")}
              </option>)}
            </optgroup>
          </select><small className="muted">La pièce doit appartenir au client du prospect sélectionné. Les commandes annulées et factures non soldées sont exclues.</small></div>
          <button className="button primary">Calculer et soumettre à la finance</button>
        </form></FormDialog>
      </div>}

      <div className="section">
        <h2>{canTeam ? "Toutes les primes" : "Mes primes"}</h2>
        {!calculations.length ? <p className="muted">Aucun calcul de prime enregistré.</p> : <div className="tableWrap"><table>
          <thead><tr><th>Prospect</th><th>Base</th><th>Prime</th><th>État</th><th>Contributeurs et paiements</th><th>Action</th></tr></thead>
          <tbody>{calculations.map((item: any) => <tr key={item.id}>
            <td><strong>{item.prospect_id}</strong><div className="muted">Client : {item.customer_id}</div></td>
            <td>{money(Number(item.basis_amount), item.currency)}</td>
            <td>{money(Number(item.commission_total), item.currency)}</td>
            <td><span className="badge">{item.status === "calculated" ? "En attente finance" : item.status === "approved" ? "Validée, à payer" : item.status === "partially_paid" ? "Partiellement payée" : item.status === "paid" ? "Payée" : "Rejetée"}</span></td>
            <td>{(item.commission_allocations || []).filter((a: any) => canTeam || a.user_id === ctx.user.id).map((allocation: any) => {
              const paid = (allocation.commission_payments || []).reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
              const balance = Number(allocation.amount) - paid;
              return <div key={allocation.id} style={{ marginBottom: 10 }}>
                <strong>{roleLabels[allocation.contribution_type]}</strong> · {allocation.user_id.slice(0, 8)} · {allocation.share_percentage} %
                <div>{money(Number(allocation.amount), item.currency)} · payé {money(paid, item.currency)} · reste {money(balance, item.currency)}</div>
                {(allocation.commission_payments || []).map((payment: any) => <div className="muted" key={payment.id}>
                  {payment.paid_at} · {payment.payment_reference} · pièce MAGNISA {payment.expense_reference}
                </div>)}
                {canPay && (item.status === "approved" || item.status === "partially_paid") && balance > 0 && paymentAccounts.length > 0 && <FormDialog title="Enregistrer le décaissement de commission" buttonLabel="Enregistrer le décaissement"><form action={recordCommissionPayment} className="inline">
                  <input type="hidden" name="allocation_id" value={allocation.id} />
                  <input type="hidden" name="request_key" value={randomUUID()} />
                  <select name="financial_account_id" required defaultValue="" aria-label="Compte de trésorerie à débiter">
                    <option value="" disabled>Compte à débiter</option>
                    {paymentAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type === "bank" ? "Banque" : account.type === "cash" ? "Caisse" : account.type === "mobile_money" ? "Mobile money" : account.type}</option>)}
                  </select>
                  <input name="amount" type="number" min="0.01" max={balance} step="0.01" defaultValue={balance} required aria-label="Montant payé" />
                  <input name="paid_at" type="date" required aria-label="Date de paiement" />
                  <input name="reference" placeholder="Référence du virement ou reçu" required aria-label="Référence du paiement réel" />
                  <button className="button small">Enregistrer le décaissement</button>
                </form></FormDialog>}
                {canPay && (item.status === "approved" || item.status === "partially_paid") && balance > 0 && paymentAccounts.length === 0 && <p className="muted">Aucun compte de trésorerie actif n'est disponible pour enregistrer ce décaissement.</p>}
              </div>;
            })}</td>
            <td>{canApprove && item.status === "calculated" ? <div style={{ display: "grid", gap: 8 }}>
              <FormDialog title="Examiner une commission de prospect" buttonLabel="Ouvrir la décision"><form action={reviewProspectCommission}><input type="hidden" name="calculation_id" value={item.id} /><input type="hidden" name="decision" value="approve" /><button className="button primary small">Valider</button></form></FormDialog>
              <FormDialog title="Examiner une commission de prospect" buttonLabel="Ouvrir la décision"><form action={reviewProspectCommission}><input type="hidden" name="calculation_id" value={item.id} /><input type="hidden" name="decision" value="reject" /><input name="reason" placeholder="Motif obligatoire" required /><button className="button danger small">Rejeter</button></form></FormDialog>
            </div> : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>
    </>
  );
}
