import { randomUUID } from "crypto";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";
import { FormDialog } from "@/components/form-dialog";
import { buildLoanSchedule, type LoanInterestCalculationMethod, type LoanInterestType, type LoanRepaymentMethod } from "@/lib/loan-finance";


async function deleteLoan(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.manage");
  const { supabase, organizationId } = ctx;
  const loanId = String(fd.get("loan_id") || "");
  const confirmation = String(fd.get("confirm_reference") || "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(loanId)) throw new Error("Emprunt invalide.");

  const { data: loan, error: loanError } = await supabase
    .from("loans")
    .select("id,magnisa_reference,contract_reference")
    .eq("id", loanId)
    .eq("organization_id", organizationId)
    .single();

  if (loanError || !loan) throw new Error("Emprunt introuvable ou inaccessible.");
  const expectedReference = loan.magnisa_reference || loan.contract_reference;
  if (!expectedReference || confirmation !== expectedReference) {
    throw new Error("La référence saisie ne correspond pas à cet emprunt. La suppression est annulée.");
  }

  const { error } = await supabase.rpc("delete_loan_with_dependencies", {
    p_organization_id: organizationId,
    p_loan_id: loanId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/emprunts");
  revalidatePath("/dettes");
  revalidatePath("/tresorerie");
  revalidatePath("/comptabilite");
  redirect("/emprunts");
}


async function configureExistingLoan(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.manage");
  const { supabase, organizationId } = ctx;
  const loanId = String(fd.get("loan_id") || "");
  const method = String(fd.get("repayment_method") || "annuity") as LoanRepaymentMethod;
  const frequency = Number(fd.get("payment_frequency") || 0);
  const periods = Number(fd.get("total_installments") || 0);
  const firstDueDate = String(fd.get("first_due_date") || "");
  const endDate = String(fd.get("end_date") || "").trim() || null;
  const liabilityAccountCode = String(fd.get("liability_account_code") || "");
  const feeAccountCode = String(fd.get("fee_account_code") || "").trim() || null;
  const penaltyAccountCode = String(fd.get("penalty_account_code") || "").trim() || null;
  const allocationOrder = String(fd.get("repayment_allocation_order") || "charges_first");

  if (!/^[0-9a-f-]{36}$/i.test(loanId)) throw new Error("Emprunt invalide.");
  if (!["annuity", "equal_principal", "bullet"].includes(method)) throw new Error("Méthode de remboursement invalide.");
  if (![1, 2, 3, 4, 6, 12].includes(frequency)) throw new Error("Périodicité invalide.");
  if (!Number.isInteger(periods) || periods < 1 || periods > 1200) throw new Error("Nombre d'échéances restantes invalide.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate) || Number.isNaN(Date.parse(firstDueDate))) throw new Error("Première échéance invalide.");
  if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(Date.parse(endDate)))) throw new Error("Date de fin invalide.");
  if (!["164", "168"].includes(liabilityAccountCode)) throw new Error("Compte de dette invalide.");
  if (feeAccountCode && !["627", "658", "661"].includes(feeAccountCode)) throw new Error("Compte de frais invalide.");
  if (penaltyAccountCode && !["658", "661"].includes(penaltyAccountCode)) throw new Error("Compte de pénalités invalide.");
  if (allocationOrder !== "charges_first") throw new Error("L'ordre d'imputation retenu est frais, pénalités, intérêts puis capital.");

  const { data: loan, error: loanError } = await supabase
    .from("loans").select("outstanding_principal,interest_rate,start_date,interest_calculation_method")
    .eq("id", loanId).eq("organization_id", organizationId).single();
  if (loanError || !loan) throw new Error("Impossible de charger le solde actuel de cet emprunt.");

  const schedule = buildLoanSchedule({
    principal: Number(loan.outstanding_principal),
    annualRatePercent: Number(loan.interest_rate || 0),
    periods,
    paymentsPerYear: frequency,
    firstDueDate,
    method,
    interestCalculationMethod: loan.interest_calculation_method === "original_principal" ? "original_principal" : "outstanding_balance",
  });

  const { error } = await supabase.rpc("configure_existing_loan_schedule", {
    p_organization_id: organizationId,
    p_loan_id: loanId,
    p_repayment_method: method,
    p_payment_frequency: frequency,
    p_total_installments: periods,
    p_first_due_date: firstDueDate,
    p_end_date: endDate,
    p_liability_account_code: liabilityAccountCode,
    p_fee_account_code: feeAccountCode,
    p_penalty_account_code: penaltyAccountCode,
    p_repayment_allocation_order: allocationOrder,
    p_installments: schedule.installments.map((row) => ({ ...row, fees: 0 })),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/emprunts");
  revalidatePath(`/emprunts/${loanId}`);
}


async function addInstallmentCharges(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.manage");
  const { supabase, organizationId } = ctx;
  const loanId = String(fd.get("loan_id") || "");
  const installmentId = String(fd.get("installment_id") || "");
  const feeRaw = String(fd.get("fee_amount") || "0").trim();
  const penaltyRaw = String(fd.get("penalty_amount") || "0").trim();
  const feeAmount = Number(feeRaw);
  const penaltyAmount = Number(penaltyRaw);
  const reason = String(fd.get("reason") || "").trim();
  const requestKey = String(fd.get("request_key") || "");

  if (!/^[0-9a-f-]{36}$/i.test(requestKey)) throw new Error("Clé de sécurité du formulaire invalide. Recharge la page.");
  if (!/^[0-9a-f-]{36}$/i.test(loanId) || !/^[0-9a-f-]{36}$/i.test(installmentId)) throw new Error("Emprunt ou échéance invalide.");
  if (!/^\d+(?:\.\d{1,2})?$/.test(feeRaw) || !Number.isFinite(feeAmount) || feeAmount < 0) throw new Error("Montant des frais invalide.");
  if (!/^\d+(?:\.\d{1,2})?$/.test(penaltyRaw) || !Number.isFinite(penaltyAmount) || penaltyAmount < 0) throw new Error("Montant des pénalités invalide.");
  if (feeAmount + penaltyAmount <= 0) throw new Error("Saisis au moins un montant de frais ou de pénalités.");
  if (reason.length < 3 || reason.length > 300) throw new Error("Le motif doit contenir entre 3 et 300 caractères.");

  const { error } = await supabase.rpc("add_loan_installment_charges", {
    p_organization_id: organizationId,
    p_loan_id: loanId,
    p_installment_id: installmentId,
    p_fee_amount: feeAmount,
    p_penalty_amount: penaltyAmount,
    p_reason: reason,
    p_request_key: requestKey,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/emprunts/${loanId}`);
}

async function recordRepayment(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "treasury.transfer");
  const { supabase, organizationId } = ctx;
  const loanId = String(fd.get("loan_id") || "");
  const selectedInstallment = String(fd.get("installment_id") || "");
  const installmentId = selectedInstallment === "__early__" ? null : selectedInstallment;
  const paymentDate = String(fd.get("payment_date") || "");
  const amountRaw = String(fd.get("amount") || "").trim();
  const amount = Number(amountRaw);
  const accountId = String(fd.get("financial_account_id") || "");
  const requestKey = String(fd.get("request_key") || "");
  const reference = String(fd.get("payment_reference") || "").trim() || null;
  const notes = String(fd.get("notes") || "").trim() || null;

  if (!/^[0-9a-f-]{36}$/i.test(requestKey)) throw new Error("Clé de sécurité du formulaire invalide. Recharge la page.");
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) throw new Error("Emprunt invalide.");
  if (selectedInstallment === "" || (installmentId && !/^[0-9a-f-]{36}$/i.test(installmentId))) throw new Error("Sélectionne une échéance ou un remboursement anticipé.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(Date.parse(paymentDate))) throw new Error("Date de paiement invalide.");
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountRaw) || !Number.isFinite(amount) || amount <= 0) throw new Error("Montant invalide : deux décimales au maximum.");
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


async function createLoanScheduleAmendment(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.manage");
  const { supabase, organizationId } = ctx;
  const loanId = String(fd.get("loan_id") || "");
  const effectiveFrom = String(fd.get("effective_from") || "");
  const firstDueDate = String(fd.get("first_due_date") || "");
  const reference = String(fd.get("amendment_reference") || "").trim();
  const reason = String(fd.get("amendment_reason") || "").trim();
  const periods = Number(fd.get("remaining_installments") || 0);
  const annualRate = Number(fd.get("interest_rate") || 0);
  const interestType = String(fd.get("interest_type") || "simple") as LoanInterestType;
  const interestCalculationMethod = String(fd.get("interest_calculation_method") || "outstanding_balance") as LoanInterestCalculationMethod;
  const repaymentMethod = String(fd.get("repayment_method") || "annuity") as LoanRepaymentMethod;
  const paymentsPerYear = Number(fd.get("payment_frequency") || 0);
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) throw new Error("Emprunt invalide.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate) || firstDueDate < effectiveFrom) throw new Error("Dates d'effet ou de première échéance invalides.");
  if (reference.length < 2 || reference.length > 120 || reason.length < 5 || reason.length > 500) throw new Error("Référence ou motif d'avenant invalide.");
  if (!Number.isInteger(periods) || periods < 1 || periods > 1200) throw new Error("Nombre d'échéances restantes invalide.");
  if (!Number.isFinite(annualRate) || annualRate < 0 || annualRate > 1000) throw new Error("Taux annuel invalide.");
  if (!["simple","compound"].includes(interestType)) throw new Error("Type d’intérêt invalide.");
  if (!["outstanding_balance","original_principal"].includes(interestCalculationMethod)) throw new Error("Base de calcul invalide.");
  if (!["annuity","equal_principal","bullet"].includes(repaymentMethod)) throw new Error("Méthode d’amortissement invalide.");
  if (![1,2,3,4,6,12].includes(paymentsPerYear)) throw new Error("Périodicité invalide.");
  const { data: loan, error: loanError } = await supabase.from("loans").select("outstanding_principal,start_date,active_schedule_version_id").eq("id", loanId).eq("organization_id", organizationId).single();
  if (loanError || !loan || !loan.active_schedule_version_id) throw new Error("Emprunt ou échéancier actif introuvable.");
  const schedule = buildLoanSchedule({
    principal: Number(loan.outstanding_principal),
    annualRatePercent: annualRate,
    periods,
    paymentsPerYear,
    firstDueDate,
    method: repaymentMethod,
    interestCalculationMethod,
    interestType,
  });
  const installments = schedule.installments.map((row) => ({
    installment_number: row.number,
    due_date: row.dueDate,
    opening_principal: row.openingPrincipal,
    principal_due: row.principal,
    interest_due: row.interest,
    fees_due: 0,
    penalty_due: 0,
  }));
  const financialTerms = { principal: Number(loan.outstanding_principal), annual_rate_percent: annualRate, interest_type: interestType, interest_calculation_method: interestCalculationMethod, repayment_method: repaymentMethod, payments_per_year: paymentsPerYear, installment_count: periods, first_due_date: firstDueDate, rate_basis: interestType === "compound" ? "effective_annual" : "nominal_annual" };
  const { error } = await supabase.rpc("create_loan_schedule_amendment_with_terms", {
    p_organization_id: organizationId,
    p_loan_id: loanId,
    p_effective_from: effectiveFrom,
    p_amendment_reference: reference,
    p_amendment_reason: reason,
    p_installments: installments,
    p_financial_terms: financialTerms,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/emprunts");
  revalidatePath(`/emprunts/${loanId}`);
  revalidatePath("/dettes");
}

export default async function LoanDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  await requirePermission(ctx, "finance.view");
  const { supabase, organizationId } = ctx;
  const canRepay = await hasPermission(ctx, "treasury.transfer");
  const canConfigureAccounting = await hasPermission(ctx, "accounting.manage");
  const canDeleteLoan = canConfigureAccounting;

  const [{ data: org }, { data: loan }, { data: installments = [] }, { data: repayments = [] }, { data: accounts = [] }, { data: scheduleVersions = [] }] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("loans").select("*").eq("id", id).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("loan_installments").select("*").eq("loan_id", id).eq("organization_id", organizationId).order("installment_number"),
    supabase.from("loan_repayments").select("*").eq("loan_id", id).eq("organization_id", organizationId).order("payment_date", { ascending: false }),
    supabase.from("financial_accounts").select("id,name,type,balance").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("loan_schedule_versions").select("id,version_number,version_type,status,effective_from,effective_until,amendment_reference,amendment_reason,approved_at,created_at,financial_terms").eq("loan_id", id).eq("organization_id", organizationId).order("version_number", { ascending: false }),
  ]);
  if (!loan) notFound();
  const currency = org?.currency || "MGA";
  const activeInstallments = loan.active_schedule_version_id
    ? installments.filter((row: any) => row.schedule_version_id === loan.active_schedule_version_id)
    : [];
  const method = loan.repayment_method === "equal_principal" ? "Capital constant" : loan.repayment_method === "bullet" ? "In fine" : "Annuités constantes";
  const totalInterest = activeInstallments.reduce((sum: number, row: any) => sum + Number(row.interest_due), 0);
  const postedRepayments = repayments.filter((row: any) => row.status === "posted");
  const paidTotal = postedRepayments.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
  const paidByInstallment = new Map<string, number>();
  for (const repayment of postedRepayments as any[]) {
    if (repayment.installment_id) paidByInstallment.set(repayment.installment_id, (paidByInstallment.get(repayment.installment_id) || 0) + Number(repayment.amount));
  }
  const openInstallments = activeInstallments.filter((row: any) => !["paid", "cancelled"].includes(row.status));
  const remainingInstallmentAmount = (row: any) => Math.max(0, Number(row.total_due) - (paidByInstallment.get(row.id) || 0));
  const repaymentRequestKey = randomUUID();
  const chargesRequestKey = randomUUID();
  const todayParts = new Intl.DateTimeFormat("en-US", { timeZone: "Indian/Antananarivo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = `${todayParts.find((part) => part.type === "year")?.value}-${todayParts.find((part) => part.type === "month")?.value}-${todayParts.find((part) => part.type === "day")?.value}`;
  const installmentStatusLabel = (row: any) => {
    if (row.status === "paid") return "Payée";
    if (row.status === "cancelled") return "Annulée";
    if (row.status === "partial") return row.due_date < today ? "Partiellement payée · en retard" : "Partiellement payée";
    if (row.status === "overdue" || (row.status === "planned" && row.due_date < today)) return "En retard";
    if (row.due_date === today) return "À régler aujourd'hui";
    return "À venir";
  };

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow"><Link href="/emprunts">Emprunts</Link> / Détail</p>
          <h1>{loan.lender_name}</h1>
          <p>{loan.magnisa_reference || loan.contract_reference || "Contrat sans référence"} · {method}</p>
        </div>
        <div className="actions">
          {canDeleteLoan ? (
            <FormDialog title="Confirmer la suppression définitive" buttonLabel="Supprimer l'emprunt" buttonClassName="button danger">
              <form action={deleteLoan} className="form">
                <input type="hidden" name="loan_id" value={loan.id} />
                <p>Cette action supprimera définitivement la fiche de l'emprunt et son échéancier. Les traces d'audit seront conservées. La suppression sera bloquée si des remboursements ou des écritures financières réelles sont liés à cet emprunt.</p>
                <div className="field">
                  <label>Saisis exactement la référence {loan.magnisa_reference || loan.contract_reference || "de l'emprunt"} pour confirmer</label>
                  <input name="confirm_reference" required autoComplete="off" placeholder={loan.magnisa_reference || loan.contract_reference || "Référence de l'emprunt"} />
                </div>
                <button className="button danger" type="submit">Supprimer définitivement</button>
              </form>
            </FormDialog>
          ) : null}
          {loan.status === "active" && canRepay ? <Link className="button primary" href={`/emprunts/${loan.id}/cloture`}>Clôture anticipée</Link> : null}
          <Link className="button secondary" href="/emprunts">Retour aux emprunts</Link>
        </div>
      </div>

      <div className="grid2 section">
        <div className="card"><p className="eyebrow">Capital initial</p><h2>{money(Number(loan.principal), currency)}</h2></div>
        <div className="card"><p className="eyebrow">Capital restant dû</p><h2>{money(Number(loan.outstanding_principal), currency)}</h2></div>
        <div className="card"><p className="eyebrow">Intérêts de l’échéancier</p><h2>{money(totalInterest, currency)}</h2></div>
        <div className="card"><p className="eyebrow">Remboursements validés</p><h2>{money(paidTotal, currency)}</h2></div>
      </div>

      <section className="section" id="informations">
        <h2>Informations et conditions financières</h2>
        <div className="tableWrap"><table><tbody>
          <tr><th>Prêteur</th><td>{loan.lender_name}</td><th>Référence contrat</th><td>{loan.contract_reference || "-"}</td></tr>
          <tr><th>Ville</th><td>{loan.lender_city || "-"}</td><th>Agence</th><td>{loan.lender_branch_name || "-"}</td></tr>
          <tr><th>Région</th><td>{loan.lender_region || "-"}</td><th>Adresse</th><td>{loan.lender_address || "-"}</td></tr>
          <tr><th>Capital</th><td>{money(Number(loan.principal), currency)}</td><th>Taux annuel nominal</th><td>{loan.interest_rate ?? 0} %</td></tr>
          <tr><th>Méthode</th><td>{method}</td><th>Type d’intérêt</th><td>{loan.interest_type === "compound" ? "Composé (taux annuel effectif)" : "Simple (taux nominal annuel)"}</td></tr>
          <tr><th>Base des intérêts</th><td>{loan.interest_calculation_method === "original_principal" ? "Capital initial" : "Capital restant dû"}</td><th>Périodicité</th><td>{loan.payment_frequency} fois par an</td></tr>
          <tr><th>Périodicité</th><td>{loan.payment_frequency} fois par an</td><th>Nombre d'échéances</th><td>{loan.total_installments ?? "-"}</td></tr>
          <tr><th>Compte de dette</th><td>{loan.liability_account_code || "À configurer"}</td><th>Compte intérêts</th><td>661 · Charges d'intérêts</td></tr>
          <tr><th>Compte frais</th><td>{loan.fee_account_code || "Non configuré"}</td><th>Compte pénalités</th><td>{loan.penalty_account_code || "Non configuré"}</td></tr>
          <tr><th>Ordre d'imputation</th><td colSpan={3}>{loan.repayment_allocation_order === "interest_first" ? "Intérêts, frais, pénalités, capital" : loan.repayment_allocation_order === "principal_first" ? "Capital, intérêts, frais, pénalités" : "Frais, pénalités, intérêts, capital"}</td></tr>
          <tr><th>Statut</th><td colSpan={3}>{loan.status}</td></tr>
          <tr><th>Date de départ</th><td>{loan.start_date}</td><th>Première échéance</th><td>{loan.first_due_date || "-"}</td></tr>
          <tr><th>Date de fin</th><td>{loan.end_date || "-"}</td><th>Notes</th><td>{loan.notes || "-"}</td></tr>
        </tbody></table></div>
      </section>

      {activeInstallments.length === 0 && loan.status === "active" && canConfigureAccounting ? (
        <section className="section">
          <div className="pageHead">
            <div><h2>Paramétrage de l'emprunt existant</h2><p className="muted">Cet emprunt a été enregistré avant le nouveau moteur. Les conditions ci-dessous doivent être confirmées à partir du contrat avant de créer son échéancier.</p></div>
            <FormDialog title="Configurer l'échéancier historique" buttonLabel="Configurer le contrat">
              <form action={configureExistingLoan} className="form">
                <input type="hidden" name="loan_id" value={loan.id} />
                <div className="grid2">
                  <div className="field"><label>Capital restant à amortir</label><input value={money(Number(loan.outstanding_principal), currency)} readOnly /></div>
                  <div className="field"><label>Taux annuel nominal (%)</label><input value={loan.interest_rate ?? 0} readOnly /></div>
                  <div className="field"><label>Nombre d'échéances restantes selon le contrat</label><input name="total_installments" type="number" min="1" max="1200" step="1" required /></div>
                  <div className="field"><label>Première échéance à venir</label><input name="first_due_date" type="date" defaultValue={loan.next_due_date || ""} required /></div>
                  <div className="field"><label>Périodicité</label><select name="payment_frequency" defaultValue="12"><option value="12">Mensuelle</option><option value="6">Bimestrielle</option><option value="4">Trimestrielle</option><option value="3">Quadrimestrielle</option><option value="2">Semestrielle</option><option value="1">Annuelle</option></select></div>
                  <div className="field"><label>Méthode d'amortissement</label><select name="repayment_method" defaultValue="annuity"><option value="annuity">Annuités constantes</option><option value="equal_principal">Capital constant</option><option value="bullet">In fine</option></select></div>
                  <div className="field"><label>Compte de dette PCG</label><select name="liability_account_code" defaultValue="" required><option value="" disabled>Choisir selon le contrat et le prêteur</option><option value="164">164 · Établissements de crédit</option><option value="168">168 · Autres emprunts et dettes assimilées</option></select></div>
                  <div className="field"><label>Date de fin contractuelle (facultatif)</label><input name="end_date" type="date" defaultValue={loan.end_date || ""} /></div>
                  <div className="field"><label>Compte PCG des frais (facultatif)</label><select name="fee_account_code" defaultValue=""><option value="">Non configuré</option><option value="627">627 · Services bancaires</option><option value="658">658 · Autres charges</option><option value="661">661 · Charges d'intérêts</option></select></div>
                  <div className="field"><label>Compte PCG des pénalités (facultatif)</label><select name="penalty_account_code" defaultValue=""><option value="">Non configuré</option><option value="658">658 · Autres charges</option><option value="661">661 · Charges d'intérêts</option></select></div>
                  <div className="field"><label>Ordre d'imputation des paiements</label><select name="repayment_allocation_order" defaultValue="charges_first"><option value="charges_first">Frais, pénalités, intérêts, capital</option></select></div>
                </div>
                <p className="muted">Le calcul démarre sur le capital restant dû actuel. Il ne modifie ni le capital initial ni les données historiques. Vérifie les paramètres dans le contrat signé avant validation.</p>
                <button className="button primary">Valider les conditions et créer l'échéancier</button>
              </form>
            </FormDialog>
          </div>
        </section>
      ) : null}
      {activeInstallments.length === 0 && loan.status === "active" && !canConfigureAccounting ? <p className="muted">L'échéancier de cet emprunt historique doit être configuré par un utilisateur autorisé à gérer la comptabilité.</p> : null}

          {loan.status === "active" && canConfigureAccounting && activeInstallments.length > 0 ? (
            <FormDialog title="Enregistrer un avenant bancaire" buttonLabel="+ Ajouter un avenant">
              <form action={createLoanScheduleAmendment} className="form">
                <input type="hidden" name="loan_id" value={loan.id} />
                <div className="grid2">
                  <div className="field"><label>Date d'effet de l'avenant</label><input name="effective_from" type="date" min={loan.start_date} required /></div>
                  <div className="field"><label>Première nouvelle échéance</label><input name="first_due_date" type="date" min={loan.start_date} defaultValue={loan.next_due_date || ""} required /></div>
                  <div className="field"><label>Nombre de nouvelles échéances</label><input name="remaining_installments" type="number" min="1" max="1200" step="1" defaultValue={openInstallments.length || 1} required /></div>
                  <div className="field"><label>Taux annuel (%)</label><input name="interest_rate" type="number" min="0" max="1000" step="0.0001" defaultValue={loan.interest_rate ?? 0} required /></div>
                  <div className="field"><label>Type d’intérêt</label><select name="interest_type" defaultValue={loan.interest_type || "simple"}><option value="simple">Simple (taux nominal annuel)</option><option value="compound">Composé (taux annuel effectif)</option></select></div>
                  <div className="field"><label>Base de calcul</label><select name="interest_calculation_method" defaultValue={loan.interest_calculation_method || "outstanding_balance"}><option value="outstanding_balance">Capital restant dû</option><option value="original_principal">Capital initial</option></select></div>
                  <div className="field"><label>Méthode d’amortissement</label><select name="repayment_method" defaultValue={loan.repayment_method || "annuity"}><option value="annuity">Annuités constantes</option><option value="equal_principal">Capital constant</option><option value="bullet">In fine</option></select></div>
                  <div className="field"><label>Périodicité</label><select name="payment_frequency" defaultValue={String(loan.payment_frequency || 12)}><option value="12">Mensuelle</option><option value="6">Bimestrielle</option><option value="4">Trimestrielle</option><option value="3">Quadrimestrielle</option><option value="2">Semestrielle</option><option value="1">Annuelle</option></select></div>
                  <div className="field"><label>Référence de l'avenant bancaire</label><input name="amendment_reference" maxLength={120} required /></div>
                </div>
                <div className="field"><label>Motif et conditions modifiées</label><textarea name="amendment_reason" minLength={5} maxLength={500} required placeholder="Ex. Rééchelonnement accepté par la banque, nouveau taux ou nouvelle durée..." /></div>
                <p className="muted">MAGNISA recalcule avec les nouvelles conditions saisies. Le type composé interprète le taux saisi comme un taux annuel effectif, converti à la périodicité choisie. Chaque version conserve un instantané immuable des paramètres. Les remboursements historiques ne sont pas réaffectés.</p>
                <button className="button primary">Valider et activer la nouvelle version</button>
              </form>
            </FormDialog>
          ) : null}
      <section className="section" id="historique-echeanciers">
        <div className="pageHead">
          <div><h2>Historique des échéanciers</h2><p className="muted">Chaque version conserve ses propres dates et montants. Les remboursements réels restent dans leur registre indépendant.</p></div>
        </div>
        {scheduleVersions.length === 0 ? <p className="muted">Aucune version d’échéancier n’est encore enregistrée.</p> : (
          <div className="tableWrap"><table>
            <thead><tr><th>Version</th><th>Nature</th><th>Date d’effet</th><th>Date de fin</th><th>Référence avenant</th><th>Motif</th><th>Statut</th></tr></thead>
            <tbody>{scheduleVersions.map((version: any) => <tr key={version.id}>
              <td><b>Version {version.version_number}</b>{version.id === loan.active_schedule_version_id ? <span className="badge">Active</span> : null}</td>
              <td>{version.version_type === "initial" ? "Échéancier initial" : "Avenant bancaire"}</td>
              <td>{version.effective_from}</td><td>{version.effective_until || "-"}</td>
              <td>{version.amendment_reference || "-"}</td><td>{version.amendment_reason || "-"}<div className="muted">{version.financial_terms ? (version.financial_terms.interest_type === "compound" ? "Composé" : "Simple") + " · " + version.financial_terms.annual_rate_percent + "% · " + (version.financial_terms.repayment_method || "") + " · " + (version.financial_terms.payments_per_year || "") + " périodes/an" : "Conditions non archivées"}</div></td>
              <td>{version.status === "active" ? "Active" : version.status === "superseded" ? "Remplacée" : "Annulée"}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="section" id="echeancier">
        <div className="pageHead">
          <div><h2>Échéancier prévisionnel</h2><p className="muted">Les frais et pénalités doivent être justifiés par le contrat ou un avis du prêteur.</p></div>
          {canConfigureAccounting && openInstallments.length > 0 ? (
            <FormDialog title="Ajouter des frais ou pénalités" buttonLabel="+ Ajouter des frais ou pénalités">
              <form action={addInstallmentCharges} className="form">
                <input type="hidden" name="loan_id" value={loan.id} />
                <input type="hidden" name="request_key" value={chargesRequestKey} />
                <div className="field"><label>Échéance concernée</label><select name="installment_id" required defaultValue=""><option value="" disabled>Choisir une échéance</option>{openInstallments.map((row: any) => <option key={row.id} value={row.id}>Échéance {row.installment_number} · {row.due_date}</option>)}</select></div>
                <div className="grid2">
                  <div className="field"><label>Frais contractuels</label><input name="fee_amount" type="number" min="0" step="0.01" defaultValue="0" /></div>
                  <div className="field"><label>Pénalités</label><input name="penalty_amount" type="number" min="0" step="0.01" defaultValue="0" /></div>
                </div>
                <div className="field"><label>Motif et justificatif de référence</label><textarea name="reason" required maxLength={300} /></div>
                <p className="muted">Cette opération augmente uniquement le montant dû sur l'échéance. Aucun mouvement bancaire ni journal comptable n'est créé avant le paiement effectif.</p>
                <button className="button primary">Enregistrer les frais et pénalités</button>
              </form>
            </FormDialog>
          ) : null}
        </div>
        {activeInstallments.length === 0 ? <p className="muted">Aucun échéancier actif enregistré pour cet emprunt.</p> : (
          <div className="tableWrap"><table>
            <thead><tr><th>N°</th><th>Date</th><th>Capital début</th><th>Amortissement</th><th>Intérêts</th><th>Frais</th><th>Pénalités</th><th>Échéance</th><th>Capital restant</th><th>Statut</th></tr></thead>
            <tbody>{activeInstallments.map((row: any) => <tr key={row.id}>
              <td>{row.installment_number}</td><td>{row.due_date}</td><td>{money(Number(row.opening_principal), currency)}</td>
              <td>{money(Number(row.principal_due), currency)}</td><td>{money(Number(row.interest_due), currency)}</td>
              <td>{money(Number(row.fees_due), currency)}</td><td>{money(Number(row.penalty_due || 0), currency)}</td>
              <td><b>{money(Number(row.total_due), currency)}</b></td><td>{money(Number(row.closing_principal), currency)}</td><td>{installmentStatusLabel(row)}</td>
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
                <input type="hidden" name="request_key" value={repaymentRequestKey} />
                <div className="field">
                  <label>Type de remboursement</label>
                  <select name="installment_id" required defaultValue="">
                    <option value="" disabled>Choisir une échéance</option>
                    {openInstallments.slice(0, 1).map((row: any) => <option key={row.id} value={row.id}>Échéance {row.installment_number} · {row.due_date} · {money(remainingInstallmentAmount(row), currency)} restant</option>)}
                    <option value="__early__">Réduction anticipée partielle du capital</option>
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
                <p className="muted">Pour une échéance, le paiement est ventilé selon l'ordre d'imputation défini dans le contrat. Une réduction anticipée partielle du capital recalcule les échéances futures. Elle exclut les intérêts courus et indemnités éventuelles ; la clôture totale du prêt se traite dans le parcours dédié de clôture anticipée.</p>
                <button className="button primary">Valider le remboursement</button>
              </form>
            </FormDialog>
          ) : null}
        </div>
        {loan.status === "active" && canRepay && accounts.length === 0 ? <p className="muted">Aucun compte de trésorerie actif accessible. Crée ou active un compte dans Trésorerie avant d'enregistrer un paiement.</p> : null}
        {repayments.length === 0 ? <p className="muted">Aucun remboursement réel enregistré.</p> : (
          <div className="tableWrap"><table>
            <thead><tr><th>Date</th><th>Montant</th><th>Capital</th><th>Intérêts</th><th>Frais</th><th>Pénalités</th><th>Statut</th><th>Référence</th><th>Écriture</th><th>Trésorerie</th><th>Action</th></tr></thead>
            <tbody>{repayments.map((row: any) => <tr key={row.id}>
              <td>{row.payment_date}</td><td>{money(Number(row.amount), currency)}</td><td>{money(Number(row.principal_paid), currency)}</td>
              <td>{money(Number(row.interest_paid), currency)}</td><td>{money(Number(row.fees_paid), currency)}</td><td>{money(Number(row.penalty_paid), currency)}</td>
              <td>{row.status}</td><td>{row.payment_reference || "-"}</td><td><code>{row.journal_entry_id || "-"}</code></td><td><code>{row.financial_transaction_id || "-"}</code></td><td>{row.status === "posted" && canRepay ? <Link className="button secondary" href={`/emprunts/${loan.id}/remboursements/${row.id}/contrepassation`}>Contrepasser</Link> : row.status === "reversed" ? "Contrepassé" : "—"}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}