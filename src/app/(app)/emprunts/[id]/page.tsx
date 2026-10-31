import { randomUUID } from "crypto";
import { notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";
import { FormDialog } from "@/components/form-dialog";

async function recordRepayment(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "treasury.transfer");
  const { supabase, organizationId } = ctx;
  const loanId = String(fd.get("loan_id") || "");
  const selectedInstallment = String(fd.get("installment_id") || "");
  const installmentId = selectedInstallment === "__early__" ? null : selectedInstallment;
  const paymentDate = String(fd.get("payment_date") || "");
  const amount = Number(fd.get("amount") || 0);
  const accountId = String(fd.get("financial_account_id") || "");
  const requestKey = String(fd.get("request_key") || "");
  const reference = String(fd.get("payment_reference") || "").trim() || null;
  const notes = String(fd.get("notes") || "").trim() || null;

  if (!/^[0-9a-f-]{36}$/i.test(requestKey)) throw new Error("Clé de sécurité du formulaire invalide. Recharge la page.");
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) throw new Error("Emprunt invalide.");
  if (selectedInstallment === "" || (installmentId && !/^[0-9a-f-]{36}$/i.test(installmentId))) throw new Error("Sélectionne une échéance ou un remboursement anticipé.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(Date.parse(paymentDate))) throw new Error("Date de paiement invalide.");
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) throw new Error("Montant invalide : deux décimales au maximum.");
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error("Sélectionne un compte de trésorerie valide.");

  const { error } = await supabase.rpc("record_loan_repayment", {
    p_organization_id: organizationId,
    p_loan_id: loanId,
    p_installment_id: installmentId,
    p_payment_date: paymentDate,
    p_amount: amount,
    p_financial_account_id: accountId,
    p_request_key: requestKey,
    p_payment_reference: reference,
    p_notes: notes,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/emprunts");
  revalidatePath(`/emprunts/${loanId}`);
  revalidatePath("/tresorerie");
  revalidatePath("/comptabilite");
}

export default async function LoanDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  await requirePermission(ctx, "finance.view");
  const { supabase, organizationId } = ctx;
  const canRepay = await hasPermission(ctx, "treasury.transfer");

  const [{ data: org }, { data: loan }, { data: installments = [] }, { data: repayments = [] }, { data: accounts = [] }] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("loans").select("*").eq("id", id).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("loan_installments").select("*").eq("loan_id", id).eq("organization_id", organizationId).order("installment_number"),
    supabase.from("loan_repayments").select("*").eq("loan_id", id).eq("organization_id", organizationId).order("payment_date", { ascending: false }),
    supabase.from("financial_accounts").select("id,name,type,balance").eq("organization_id", organizationId).eq("is_active", true).order("name"),
  ]);
  if (!loan) notFound();
  const currency = org?.currency || "MGA";
  const method = loan.repayment_method === "equal_principal" ? "Capital constant" : loan.repayment_method === "bullet" ? "In fine" : "Annuités constantes";
  const totalInterest = installments.reduce((sum: number, row: any) => sum + Number(row.interest_due), 0);
  const postedRepayments = repayments.filter((row: any) => row.status === "posted");
  const paidTotal = postedRepayments.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
  const openInstallments = installments.filter((row: any) => !["paid", "cancelled"].includes(row.status));
  const requestKey = randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow"><Link href="/emprunts">Emprunts</Link> / Détail</p>
          <h1>{loan.lender_name}</h1>
          <p>{loan.magnisa_reference || loan.contract_reference || "Contrat sans référence"} · {method}</p>
        </div>
        <div className="actions"><Link className="button secondary" href="/emprunts">Retour aux emprunts</Link></div>
      </div>

      <div className="grid2 section">
        <div className="card"><p className="eyebrow">Capital initial</p><h2>{money(Number(loan.principal), currency)}</h2></div>
        <div className="card"><p className="eyebrow">Capital restant dû</p><h2>{money(Number(loan.outstanding_principal), currency)}</h2></div>
        <div className="card"><p className="eyebrow">Intérêts prévisionnels</p><h2>{money(totalInterest, currency)}</h2></div>
        <div className="card"><p className="eyebrow">Remboursements validés</p><h2>{money(paidTotal, currency)}</h2></div>
      </div>

      <section className="section" id="informations">
        <h2>Informations et conditions financières</h2>
        <div className="tableWrap"><table><tbody>
          <tr><th>Prêteur</th><td>{loan.lender_name}</td><th>Référence contrat</th><td>{loan.contract_reference || "-"}</td></tr>
          <tr><th>Capital</th><td>{money(Number(loan.principal), currency)}</td><th>Taux annuel nominal</th><td>{loan.interest_rate ?? 0} %</td></tr>
          <tr><th>Méthode</th><td>{method}</td><th>Périodicité</th><td>{loan.payment_frequency} fois par an</td></tr>
          <tr><th>Compte de dette</th><td>{loan.liability_account_code || "À configurer"}</td><th>Compte intérêts</th><td>661 · Charges d'intérêts</td></tr>
          <tr><th>Compte frais</th><td>{loan.fee_account_code || "Non configuré"}</td><th>Compte pénalités</th><td>{loan.penalty_account_code || "Non configuré"}</td></tr>
          <tr><th>Ordre d'imputation</th><td colSpan={3}>{loan.repayment_allocation_order === "interest_first" ? "Intérêts, frais, pénalités, capital" : loan.repayment_allocation_order === "principal_first" ? "Capital, intérêts, frais, pénalités" : "Frais, pénalités, intérêts, capital"}</td></tr>
          <tr><th>Nombre d'échéances</th><td>{loan.total_installments ?? "-"}</td><th>Statut</th><td>{loan.status}</td></tr>
          <tr><th>Date de départ</th><td>{loan.start_date}</td><th>Première échéance</th><td>{loan.first_due_date || "-"}</td></tr>
          <tr><th>Date de fin</th><td>{loan.end_date || "-"}</td><th>Notes</th><td>{loan.notes || "-"}</td></tr>
        </tbody></table></div>
      </section>

      <section className="section" id="echeancier">
        <h2>Échéancier prévisionnel</h2>
        {installments.length === 0 ? <p className="muted">Aucun échéancier enregistré pour cet emprunt.</p> : (
          <div className="tableWrap"><table>
            <thead><tr><th>N°</th><th>Date</th><th>Capital début</th><th>Amortissement</th><th>Intérêts</th><th>Frais</th><th>Pénalités</th><th>Échéance</th><th>Capital restant</th><th>Statut</th></tr></thead>
            <tbody>{installments.map((row: any) => <tr key={row.id}>
              <td>{row.installment_number}</td><td>{row.due_date}</td><td>{money(Number(row.opening_principal), currency)}</td>
              <td>{money(Number(row.principal_due), currency)}</td><td>{money(Number(row.interest_due), currency)}</td>
              <td>{money(Number(row.fees_due), currency)}</td><td>{money(Number(row.penalty_due || 0), currency)}</td>
              <td><b>{money(Number(row.total_due), currency)}</b></td><td>{money(Number(row.closing_principal), currency)}</td><td>{row.status}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="section" id="remboursements">
        <div className="pageHead">
          <div><h2>Remboursements réels</h2><p className="muted">Chaque validation met à jour simultanément le capital, la trésorerie et la comptabilité.</p></div>
          {loan.status === "active" && canRepay && accounts.length > 0 ? (
            <FormDialog title="Enregistrer un remboursement" buttonLabel="+ Enregistrer un remboursement">
              <form action={recordRepayment} className="form">
                <input type="hidden" name="loan_id" value={loan.id} />
                <input type="hidden" name="request_key" value={requestKey} />
                <div className="field">
                  <label>Type de remboursement</label>
                  <select name="installment_id" required defaultValue="">
                    <option value="" disabled>Choisir une échéance</option>
                    {openInstallments.map((row: any) => <option key={row.id} value={row.id}>Échéance {row.installment_number} · {row.due_date} · {money(Number(row.total_due), currency)}</option>)}
                    <option value="__early__">Remboursement anticipé du capital</option>
                  </select>
                </div>
                <div className="grid2">
                  <div className="field"><label>Date réelle du paiement</label><input name="payment_date" type="date" defaultValue={today} required /></div>
                  <div className="field"><label>Montant payé</label><input name="amount" type="number" min="0.01" step="0.01" required /></div>
                </div>
                <div className="field">
                  <label>Compte bancaire ou de trésorerie</label>
                  <select name="financial_account_id" required defaultValue=""><option value="" disabled>Choisir un compte</option>
                    {accounts.map((account: any) => <option key={account.id} value={account.id}>{account.name} · {account.type} · Solde {money(Number(account.balance), currency)}</option>)}
                  </select>
                </div>
                <div className="field"><label>Référence bancaire (facultatif)</label><input name="payment_reference" maxLength={120} /></div>
                <div className="field"><label>Notes (facultatif)</label><textarea name="notes" /></div>
                <p className="muted">Pour une échéance, le paiement est ventilé selon l'ordre d'imputation défini dans le contrat. Un remboursement anticipé est traité séparément et recalcule les échéances futures. Il ne peut pas dépasser le capital restant dû.</p>
                <button className="button primary">Valider le remboursement</button>
              </form>
            </FormDialog>
          ) : null}
        </div>
        {loan.status === "active" && canRepay && accounts.length === 0 ? <p className="muted">Aucun compte de trésorerie actif accessible. Crée ou active un compte dans Trésorerie avant d'enregistrer un paiement.</p> : null}
        {repayments.length === 0 ? <p className="muted">Aucun remboursement réel enregistré.</p> : (
          <div className="tableWrap"><table>
            <thead><tr><th>Date</th><th>Montant</th><th>Capital</th><th>Intérêts</th><th>Frais</th><th>Pénalités</th><th>Statut</th><th>Référence</th><th>Écriture</th><th>Trésorerie</th></tr></thead>
            <tbody>{repayments.map((row: any) => <tr key={row.id}>
              <td>{row.payment_date}</td><td>{money(Number(row.amount), currency)}</td><td>{money(Number(row.principal_paid), currency)}</td>
              <td>{money(Number(row.interest_paid), currency)}</td><td>{money(Number(row.fees_paid), currency)}</td><td>{money(Number(row.penalty_paid), currency)}</td>
              <td>{row.status}</td><td>{row.payment_reference || "-"}</td><td><code>{row.journal_entry_id || "-"}</code></td><td><code>{row.financial_transaction_id || "-"}</code></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
