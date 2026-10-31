"use client";

import { useMemo, useState } from "react";
import { addMonthsClamped, buildLoanSchedule, type LoanInterestCalculationMethod, type LoanRepaymentMethod } from "@/lib/loan-finance";

export function LoanFinancialFields({ currency }: { currency: string }) {
  const [principal, setPrincipal] = useState("");
  const [annualRate, setAnnualRate] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [firstDueWasEdited, setFirstDueWasEdited] = useState(false);
  const [periods, setPeriods] = useState("12");
  const [frequency, setFrequency] = useState("12");
  const [method, setMethod] = useState<LoanRepaymentMethod>("annuity");
  const [interestMethod, setInterestMethod] = useState<LoanInterestCalculationMethod>("outstanding_balance");
  const paymentsPerYear = Number(frequency);
  const proposedFirstDueDate = startDate ? addMonthsClamped(startDate, 12 / paymentsPerYear) : "";
  const effectiveFirstDueDate = firstDueWasEdited ? firstDueDate : proposedFirstDueDate;

  const preview = useMemo(() => {
    if (!principal || !periods || !effectiveFirstDueDate || !startDate || effectiveFirstDueDate < startDate) return null;
    try {
      return buildLoanSchedule({
        principal: Number(principal), annualRatePercent: Number(annualRate),
        periods: Number(periods), paymentsPerYear, firstDueDate: effectiveFirstDueDate,
        method, interestCalculationMethod: interestMethod,
      });
    } catch { return null; }
  }, [principal, annualRate, periods, paymentsPerYear, effectiveFirstDueDate, startDate, method, interestMethod]);

  const format = (value: number) => new Intl.NumberFormat("fr-FR", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(value);

  return (
    <>
      <div className="grid2">
        <div className="field"><label>Capital emprunté</label><input name="principal" type="number" step="0.01" min="0.01" value={principal} onChange={(e) => setPrincipal(e.target.value)} required /></div>
        <div className="field"><label>Taux annuel nominal (%)</label><input name="interest_rate" type="number" step="0.0001" min="0" max="1000" value={annualRate} onChange={(e) => setAnnualRate(e.target.value)} required /></div>
        <div className="field"><label>Date de mise à disposition</label><input name="start_date" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!firstDueWasEdited) setFirstDueDate(e.target.value ? addMonthsClamped(e.target.value, 12 / paymentsPerYear) : ""); }} required /></div>
        <div className="field"><label>Première échéance (proposition automatique)</label><input name="first_due_date" type="date" min={startDate || undefined} value={effectiveFirstDueDate} onChange={(e) => { setFirstDueWasEdited(true); setFirstDueDate(e.target.value); }} required /></div>
        <div className="field"><label>Nombre d'échéances</label><input name="total_installments" type="number" min="1" max="1200" step="1" value={periods} onChange={(e) => setPeriods(e.target.value)} required /></div>
        <div className="field"><label>Périodicité</label><select name="payment_frequency" value={frequency} onChange={(e) => { setFrequency(e.target.value); if (!firstDueWasEdited && startDate) setFirstDueDate(addMonthsClamped(startDate, 12 / Number(e.target.value))); }}><option value="12">Mensuelle</option><option value="6">Bimestrielle</option><option value="4">Trimestrielle</option><option value="3">Quadrimestrielle</option><option value="2">Semestrielle</option><option value="1">Annuelle</option></select></div>
        <div className="field"><label>Méthode de remboursement</label><select name="repayment_method" value={method} onChange={(e) => setMethod(e.target.value as LoanRepaymentMethod)}><option value="annuity">Annuités constantes</option><option value="equal_principal">Capital constant</option><option value="bullet">In fine</option></select></div>
        <div className="field"><label>Base de calcul des intérêts</label><select name="interest_calculation_method" value={interestMethod} onChange={(e) => setInterestMethod(e.target.value as LoanInterestCalculationMethod)}><option value="outstanding_balance">Capital restant dû</option><option value="original_principal">Capital initial</option></select></div>
      </div>
      <input type="hidden" name="end_date" value={preview?.lastDueDate || ""} />
      <p className="muted">Le taux périodique est dérivé du taux nominal annuel. Les intérêts impayés ne sont jamais capitalisés automatiquement. La date de fin est calculée à partir de la dernière échéance.</p>
      <section className="section" aria-live="polite">
        <h3>Aperçu financier avant enregistrement</h3>
        {preview ? (
          <>
            <div className="grid2">
              <div><span className="muted">Taux périodique</span><p><strong>{(preview.periodicRate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 6 })} %</strong></p></div>
              <div><span className="muted">Intérêts totaux</span><p><strong>{format(preview.totalInterest)}</strong></p></div>
              <div><span className="muted">Total à rembourser</span><p><strong>{format(preview.totalPayments)}</strong></p></div>
              <div><span className="muted">Date de fin calculée</span><p><strong>{preview.lastDueDate}</strong></p></div>
            </div>
            <div className="tableWrap"><table>
              <thead><tr><th>N°</th><th>Date</th><th>Capital début</th><th>Intérêts</th><th>Capital remboursé</th><th>Échéance</th><th>Capital restant</th></tr></thead>
              <tbody>{preview.installments.slice(0, 5).map((row) => <tr key={row.number}><td>{row.number}</td><td>{row.dueDate}</td><td>{format(row.openingPrincipal)}</td><td>{format(row.interest)}</td><td>{format(row.principal)}</td><td>{format(row.payment)}</td><td>{format(row.closingPrincipal)}</td></tr>)}</tbody>
            </table></div>
            {preview.installments.length > 5 && <p className="muted">Aperçu des 5 premières échéances sur {preview.installments.length}. L'échéancier complet sera enregistré.</p>}
          </>
        ) : <p className="muted">Renseigne le capital et les paramètres du prêt pour afficher la simulation.</p>}
      </section>
    </>
  );
}
