"use client";

import { useMemo, useState } from "react";
import { buildLoanSchedule, type LoanRepaymentMethod, type LoanInterestCalculationMethod } from "@/lib/loan-finance";
import { money } from "@/lib/money";

type Props = {
  loanId: string;
  principal: number;
  annualRatePercent: number;
  currentFrequency: number;
  currentMethod: LoanRepaymentMethod;
  interestCalculationMethod: LoanInterestCalculationMethod;
  action: (formData: FormData) => void | Promise<void>;
};

export function AmendmentForm({ loanId, principal, annualRatePercent, currentFrequency, currentMethod, interestCalculationMethod, action }: Props) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [periods, setPeriods] = useState(32);
  const [frequency, setFrequency] = useState(currentFrequency || 12);
  const [method, setMethod] = useState<LoanRepaymentMethod>(currentMethod);
  const [rate, setRate] = useState(annualRatePercent);
  const [firstDueDate, setFirstDueDate] = useState("");

  const schedule = useMemo(() => {
    if (!firstDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate) || periods < 1) return null;
    try {
      return buildLoanSchedule({
        principal,
        annualRatePercent: Number(rate),
        periods: Number(periods),
        paymentsPerYear: Number(frequency),
        firstDueDate,
        method,
        interestCalculationMethod,
      });
    } catch {
      return null;
    }
  }, [principal, annualRatePercent, rate, periods, frequency, firstDueDate, method, interestCalculationMethod]);

  const payload = schedule?.installments.map((row) => ({
    installment_number: row.number,
    due_date: row.dueDate,
    opening_principal: row.openingPrincipal,
    principal_due: row.principal,
    interest_due: row.interest,
    fees_due: 0,
    penalty_due: 0,
    total_due: row.payment,
    closing_principal: row.closingPrincipal,
    status: "planned",
  })) || [];

  return (
    <form action={action} className="form section">
      <input type="hidden" name="loan_id" value={loanId} />
      <input type="hidden" name="installments" value={JSON.stringify(payload)} readOnly />

      <section className="section">
        <h2>1. Références de l'avenant</h2>
        <div className="grid2">
          <div className="field"><label>Date d'effet</label><input name="effective_from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required /><small className="muted">Elle doit être postérieure à la date de départ du prêt.</small></div>
          <div className="field"><label>Référence de l'avenant</label><input name="amendment_reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="Ex. AV-BNI-2026-01" required /></div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label>Motif de l'avenant</label><textarea name="amendment_reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex. Réaménagement de la durée de remboursement selon avenant bancaire signé le ..." required /></div>
        </div>
      </section>

      <section className="section">
        <h2>2. Nouvelles conditions de l'échéancier</h2>
        <p className="muted">Le capital de départ est le capital restant dû. Le taux peut être modifié dans le nouvel échéancier, mais cette version ne modifie pas encore les champs contractuels généraux de la fiche du prêt.</p>
        <div className="grid2">
          <div className="field"><label>Capital de départ</label><input value={principal.toLocaleString("fr-FR")} readOnly /></div>
          <div className="field"><label>Taux annuel nominal (%)</label><input type="number" min="0" max="1000" step="0.01" value={rate} onChange={(e) => setRate(Number(e.target.value))} required /></div>
          <div className="field"><label>Nombre d'échéances</label><input type="number" min="1" max="1200" step="1" value={periods} onChange={(e) => setPeriods(Number(e.target.value))} required /></div>
          <div className="field"><label>Périodicité</label><select value={frequency} onChange={(e) => setFrequency(Number(e.target.value))}><option value={12}>Mensuelle</option><option value={6}>Bimestrielle</option><option value={4}>Trimestrielle</option><option value={3}>Quadrimestrielle</option><option value={2}>Semestrielle</option><option value={1}>Annuelle</option></select></div>
          <div className="field"><label>Méthode d'amortissement</label><select value={method} onChange={(e) => setMethod(e.target.value as LoanRepaymentMethod)}><option value="annuity">Annuités constantes</option><option value="equal_principal">Capital constant</option><option value="bullet">In fine</option></select></div>
          <div className="field"><label>Première nouvelle échéance</label><input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} required /></div>
        </div>
      </section>

      <section className="section">
        <div className="pageHead"><div><h2>3. Prévisualisation</h2><p className="muted">L'avenant n'est pas enregistré tant que tu n'as pas validé le formulaire.</p></div></div>
        {!schedule ? <p className="muted">Renseigne une première échéance valide pour générer l'aperçu.</p> : (
          <>
            <div className="grid2">
              <div className="card"><p className="eyebrow">Intérêts totaux</p><h2>{money(schedule.totalInterest, "MGA")}</h2></div>
              <div className="card"><p className="eyebrow">Total à payer</p><h2>{money(schedule.totalPayments, "MGA")}</h2></div>
            </div>
            <div className="tableWrap"><table>
              <thead><tr><th>N°</th><th>Date</th><th>Capital</th><th>Intérêts</th><th>Total</th><th>Capital restant</th></tr></thead>
              <tbody>{schedule.installments.map((row) => <tr key={row.number}><td>{row.number}</td><td>{row.dueDate}</td><td>{money(row.principal, "MGA")}</td><td>{money(row.interest, "MGA")}</td><td><b>{money(row.payment, "MGA")}</b></td><td>{money(row.closingPrincipal, "MGA")}</td></tr>)}</tbody>
            </table></div>
          </>
        )}
      </section>

      <div className="actions">
        <button className="button primary" type="submit" disabled={!schedule || !effectiveFrom || reference.trim().length < 2 || reason.trim().length < 3}>Valider l'avenant et activer la nouvelle version</button>
      </div>
    </form>
  );
}
