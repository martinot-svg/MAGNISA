import Link from "next/link";
import { requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { buildLoanSchedule, type LoanRepaymentMethod } from "@/lib/loan-finance";

async function createLoan(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "treasury.transfer");
  const { supabase, organizationId } = ctx;
  const lenderName = String(fd.get("lender_name") || "").trim();
  const principal = Number(fd.get("principal") || 0);
  const interestRate = Number(fd.get("interest_rate") || 0);
  const startDate = String(fd.get("start_date") || "");
  const endDate = String(fd.get("end_date") || "").trim() || null;
  const firstDueDate = String(fd.get("first_due_date") || "");
  const contractReference = String(fd.get("contract_reference") || "").trim() || null;
  const repaymentMethod = String(fd.get("repayment_method") || "annuity") as LoanRepaymentMethod;
  const paymentFrequency = Number(fd.get("payment_frequency") || 12);
  const totalInstallments = Number(fd.get("total_installments") || 0);
  const notes = String(fd.get("notes") || "").trim() || null;
  const liabilityAccountCode = String(fd.get("liability_account_code") || "");
  const feeAccountCode = String(fd.get("fee_account_code") || "").trim() || null;
  const penaltyAccountCode = String(fd.get("penalty_account_code") || "").trim() || null;

  if (lenderName.length < 2 || lenderName.length > 160) throw new Error("Nom du prêteur invalide.");
  if (!Number.isFinite(principal) || principal <= 0) throw new Error("Le capital doit être un montant strictement positif.");
  if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 1000) throw new Error("Taux d'intérêt invalide.");
  if (!["164", "168"].includes(liabilityAccountCode)) throw new Error("Sélectionne le compte de dette PCG adapté au prêteur.");
  if (feeAccountCode && !["627", "658", "661"].includes(feeAccountCode)) throw new Error("Compte de frais invalide.");
  if (penaltyAccountCode && !["658", "661"].includes(penaltyAccountCode)) throw new Error("Compte de pénalités invalide.");
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate))) throw new Error("Date de début invalide.");
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(firstDueDate) || Number.isNaN(Date.parse(firstDueDate)) || firstDueDate < startDate) throw new Error("Première échéance invalide.");
  if (endDate && (!/^\\d{4}-\\d{2}-\\d{2}$/.test(endDate) || Number.isNaN(Date.parse(endDate)) || endDate < firstDueDate)) throw new Error("La date de fin doit être postérieure à la première échéance.");

  const schedule = buildLoanSchedule({
    principal,
    annualRatePercent: interestRate,
    periods: totalInstallments,
    paymentsPerYear: paymentFrequency,
    firstDueDate,
    method: repaymentMethod,
  });

  const { error } = await supabase.rpc("create_loan_with_schedule", {
    p_organization_id: organizationId,
    p_lender_name: lenderName,
    p_principal: principal,
    p_interest_rate: interestRate,
    p_start_date: startDate,
    p_end_date: endDate,
    p_notes: notes,
    p_contract_reference: contractReference,
    p_repayment_method: repaymentMethod,
    p_payment_frequency: paymentFrequency,
    p_total_installments: totalInstallments,
    p_first_due_date: firstDueDate,
    p_liability_account_code: liabilityAccountCode,
    p_fee_account_code: feeAccountCode,
    p_penalty_account_code: penaltyAccountCode,
    p_installments: schedule.installments.map((row) => ({ ...row, fees: 0 })),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/emprunts");
  revalidatePath("/dettes");
}

export default async function Loans() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "finance.view");
  const { supabase, organizationId } = ctx;
  const [{ data: org }, { data: loans = [] }] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("loans").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
  ]);
  const currency = org?.currency || "MGA";

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Financement</p>
          <h1>Emprunts</h1>
          <p>Suivi des contrats, des échéanciers prévisionnels et du capital restant dû.</p>
        </div>
        <div className="actions">
          <FormDialog title="Nouvel emprunt" buttonLabel="+ Nouvel emprunt">
            <form action={createLoan} className="form">
              <div className="field"><label>Prêteur</label><input name="lender_name" required maxLength={160} /></div>
              <div className="field"><label>Référence du contrat</label><input name="contract_reference" maxLength={120} /></div>
              <div className="grid2">
                <div className="field"><label>Capital emprunté</label><input name="principal" type="number" step="0.01" min="0.01" required /></div>
                <div className="field"><label>Taux annuel nominal (%)</label><input name="interest_rate" type="number" step="0.0001" min="0" max="1000" defaultValue="0" required /></div>
                <div className="field"><label>Date de mise à disposition</label><input name="start_date" type="date" required /></div>
                <div className="field"><label>Première échéance</label><input name="first_due_date" type="date" required /></div>
                <div className="field"><label>Nombre d'échéances</label><input name="total_installments" type="number" min="1" max="1200" step="1" required /></div>
                <div className="field"><label>Périodicité</label><select name="payment_frequency" defaultValue="12"><option value="12">Mensuelle</option><option value="6">Bimestrielle</option><option value="4">Trimestrielle</option><option value="3">Quadrimestrielle</option><option value="2">Semestrielle</option><option value="1">Annuelle</option></select></div>
                <div className="field"><label>Méthode de remboursement</label><select name="repayment_method" defaultValue="annuity"><option value="annuity">Annuités constantes</option><option value="equal_principal">Capital constant</option><option value="bullet">In fine</option></select></div>
                <div className="field"><label>Compte de dette PCG</label><select name="liability_account_code" defaultValue="164" required><option value="164">164 · Emprunts auprès des établissements de crédit</option><option value="168">168 · Autres emprunts et dettes assimilées</option></select></div>
                <div className="field"><label>Compte PCG des frais (facultatif)</label><select name="fee_account_code" defaultValue=""><option value="">Non configuré</option><option value="627">627 · Services bancaires et assimilés</option><option value="658">658 · Autres charges de gestion courante</option><option value="661">661 · Charges d'intérêts</option></select></div>
                <div className="field"><label>Compte PCG des pénalités (facultatif)</label><select name="penalty_account_code" defaultValue=""><option value="">Non configuré</option><option value="658">658 · Autres charges de gestion courante</option><option value="661">661 · Charges d'intérêts</option></select></div>
                <div className="field"><label>Date de fin contractuelle (facultatif)</label><input name="end_date" type="date" /></div>
              </div>
              <div className="field"><label>Notes</label><textarea name="notes" /></div>
              <p className="muted">Le taux annuel nominal est réparti selon la périodicité. Les intérêts impayés ne sont pas capitalisés automatiquement.</p>
              <button className="button primary">Créer l'emprunt et son échéancier</button>
            </form>
          </FormDialog>
        </div>
      </div>
      <div className="section">
        {loans.length === 0 ? <EmptyState title="Aucun emprunt" description="Les contrats et leurs échéanciers apparaîtront ici." /> : (
          <div className="tableWrap"><table>
            <thead><tr><th>Réf. MAGNISA</th><th>Prêteur</th><th>Méthode</th><th>Capital initial</th><th>Restant dû</th><th>Prochaine échéance</th><th>Statut</th></tr></thead>
            <tbody>{loans.map((loan: any) => <tr key={loan.id}>
              <td><Link href={`/emprunts/${loan.id}`}><code>{loan.magnisa_reference || loan.contract_reference || "Voir le détail"}</code></Link></td>
              <td>{loan.lender_name}</td>
              <td>{loan.repayment_method === "equal_principal" ? "Capital constant" : loan.repayment_method === "bullet" ? "In fine" : "Annuités constantes"}</td>
              <td>{money(Number(loan.principal), currency)}</td>
              <td><b>{money(Number(loan.outstanding_principal), currency)}</b></td>
              <td>{loan.next_due_date || "-"}{loan.next_due_amount ? ` · ${money(Number(loan.next_due_amount), currency)}` : ""}</td>
              <td><span className="badge">{loan.status}</span></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
