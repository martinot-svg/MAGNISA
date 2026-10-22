"use client";

import { useEffect, useState } from "react";
import { reserveCashReceiptReference } from "@/server/actions/core";
import { MVOLA_RATE_VERSION } from "@/lib/mvola-tariffs";

type InvoiceOption = { id: string; number: string; balance_due: number; customerName: string };
type AccountOption = { id: string; name: string; type: string };

export function PaymentEntryForm({
  invoices,
  accounts,
  currency,
  requestKey,
  action,
}: {
  invoices: InvoiceOption[];
  accounts: AccountOption[];
  currency: string;
  requestKey: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [mobileOperator, setMobileOperator] = useState("");
  const [mvolaFeeOption, setMvolaFeeOption] = useState("");
  const [mvolaFeeAmount, setMvolaFeeAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [requestId, setRequestId] = useState(requestKey);
  const [cashReference, setCashReference] = useState("");
  const [cashReferenceLoading, setCashReferenceLoading] = useState(false);
  const [cashReferenceError, setCashReferenceError] = useState("");
  useEffect(() => {
    if (method !== "cash" || !paidAt) {
      setCashReference("");
      setCashReferenceLoading(false);
      setCashReferenceError("");
      return;
    }
    let current = true;
    setCashReference("");
    setCashReferenceLoading(true);
    setCashReferenceError("");
    reserveCashReceiptReference(requestId, paidAt)
      .then((reference) => { if (current) setCashReference(reference); })
      .catch(() => { if (current) setCashReferenceError("Impossible de réserver un numéro de reçu. Réessaie en changeant la date ou en rechargeant la page."); })
      .finally(() => { if (current) setCashReferenceLoading(false); });
    return () => { current = false; };
  }, [method, paidAt, requestId]);
  const invoice = invoices.find((item) => item.id === invoiceId);
  const due = invoice?.balance_due ?? 0;
  const received = amount.trim() === "" ? NaN : Number(amount);
  const valid = !!invoice && Number.isFinite(received) && received > 0 && received <= due;
  const showMvola = method === "mobile_money" && mobileOperator === "mvola";
  const feeAmount = Number(mvolaFeeAmount);
  const feeOptionNeedsAmount = mvolaFeeOption === "with_fees" || mvolaFeeOption === "company_pays";
  const feeValid = !showMvola || mvolaFeeOption === "without_fees" || (feeOptionNeedsAmount && mvolaFeeAmount.trim() !== "" && Number.isFinite(feeAmount) && feeAmount > 0 && Number.isInteger(feeAmount));
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const operatorMismatch = showMvola && !!selectedAccount && selectedAccount.name.trim().toLowerCase() !== "mvola";
  const remaining = valid ? Math.max(0, Math.round((due - received) * 100) / 100) : null;
  const formatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "MGA" ? 0 : 2,
    maximumFractionDigits: 2,
  });

  return (
    <form action={action} className="form">
      <input type="hidden" name="idempotency_key" value={requestId} />
      <div className="field">
        <label htmlFor="payment-invoice">Facture</label>
        <select
          id="payment-invoice"
          name="invoice_id"
          value={invoiceId}
          required
          onChange={(event) => {
            const selected = invoices.find((item) => item.id === event.target.value);
            setInvoiceId(event.target.value);
            setAmount(selected ? String(selected.balance_due) : "");
          }}
        >
          <option value="">Sélectionner</option>
          {invoices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.number} - {item.customerName} - reste {formatter.format(item.balance_due)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="payment-amount">Montant reçu</label>
        <input
          id="payment-amount"
          name="amount"
          type="number"
          min="0.01"
          max={invoice ? due : undefined}
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
        {invoice && <small>Montant suggéré : {formatter.format(due)}. Modifiable pour un paiement partiel.</small>}
        {invoice && amount !== "" && !valid && (
          <p className="error" role="alert">Le montant doit être supérieur à zéro et ne pas dépasser le solde restant dû.</p>
        )}
      </div>
      {invoice && (
        <section className="card" aria-label="Récapitulatif du paiement" aria-live="polite">
          <h3>Récapitulatif du paiement</h3>
          <div className="field">
            <span className="muted">Paiement</span>
            <strong>{!valid ? "À vérifier" : remaining === 0 ? "Intégral" : "Partiel"}</strong>
          </div>
          <div className="field">
            <span className="muted">Montant reçu</span>
            <strong>{valid ? formatter.format(received) : "-"}</strong>
          </div>
          <div className="field">
            <span className="muted">Nouveau solde restant</span>
            <strong>{remaining !== null ? formatter.format(remaining) : "-"}</strong>
          </div>
        </section>
      )}
      <div className="field">
        <label htmlFor="payment-method">Mode</label>
        <select id="payment-method" name="method" value={method} required onChange={(event) => setMethod(event.target.value)}>
          <option value="">Sélectionner</option>
          <option value="bank_transfer">Virement bancaire</option>
          <option value="cash">Espèces</option>
          <option value="mobile_money">Mobile Money</option>
          <option value="cheque">Chèque</option>
          <option value="card">Carte</option>
          <option value="other">Autre</option>
        </select>
      </div>
      {method === "mobile_money" && (
        <div className="field">
          <label htmlFor="payment-mobile-operator">Opérateur Mobile Money</label>
          <select
            id="payment-mobile-operator"
            name="mobile_operator"
            value={mobileOperator}
            onChange={(event) => { setMobileOperator(event.target.value); setMvolaFeeOption(""); setMvolaFeeAmount(""); }}
            required
          >
            <option value="">Sélectionner</option>
            <option value="mvola">MVola</option>
            <option value="other">Autre opérateur (sans barème MVola)</option>
          </select>
        </div>
      )}
      {showMvola && (
        <div className="field">
          <label htmlFor="payment-mvola-fee-option">Prise en charge des frais MVola</label>
          <select
            id="payment-mvola-fee-option"
            name="mvola_fee_option"
            value={mvolaFeeOption}
            onChange={(event) => { setMvolaFeeOption(event.target.value); setMvolaFeeAmount(""); }}
            required
          >
            <option value="">Sélectionner</option>
            <option value="with_fees">Frais réels remboursés par le client</option>
            <option value="company_pays">Frais réels à la charge de l’entreprise</option>
            <option value="without_fees">Aucun frais réel constaté</option>
          </select>
        </div>
      )}
      {showMvola && feeOptionNeedsAmount && (
        <div className="field">
          <label htmlFor="payment-mvola-fee-amount">{mvolaFeeOption === "company_pays" ? "Frais réellement prélevés à la charge de l’entreprise (Ar)" : "Remboursement des frais réellement reçu du client (Ar)"}</label>
          <input id="payment-mvola-fee-amount" name="mvola_fee_amount" type="number" min="1" step="1"
            value={mvolaFeeAmount} onChange={(event) => setMvolaFeeAmount(event.target.value)} required />
          {valid && feeValid && <small>{mvolaFeeOption === "company_pays" ? "Le montant sera enregistré comme frais réels de l’entreprise. Vérifie qu’il a effectivement été prélevé sur ce compte." : `Total à vérifier sur le justificatif : ${formatter.format(received + feeAmount)} (dont ${formatter.format(received)} affectés à la facture).`}</small>}
          <small>Le barème MVola du {MVOLA_RATE_VERSION} ne permet pas de déduire les frais du transfert entrant sans connaître le type de compte de l’émetteur. Saisis uniquement le remboursement réellement reçu et vérifié sur le justificatif. Aucun frais estimé n’est comptabilisé.</small>
        </div>
      )}
      <div className="field">
        <label htmlFor="payment-account">Compte destinataire</label>
        <select id="payment-account" name="financial_account_id" value={accountId} onChange={(event) => setAccountId(event.target.value)} required>
          <option value="">Sélectionner</option>
          {accounts.filter(item => method !== "mobile_money" || item.type === "mobile_money").map((item) => (
            <option key={item.id} value={item.id}>{item.name} ({item.type})</option>
          ))}
        </select>
      </div>
      {operatorMismatch && <p className="error" role="alert">Pour un paiement MVola, sélectionne un compte MVola, et non Orange Money ou Airtel Money.</p>}
      <div className="field">
        <label htmlFor="payment-date">Date</label>
        <input
          id="payment-date"
          name="paid_at"
          type="date"
          value={paidAt}
          onChange={(event) => {
            setPaidAt(event.target.value);
            setRequestId(crypto.randomUUID());
          }}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="payment-reference">
          {method === "cash" ? "Référence automatique du reçu de caisse" : "Référence réelle de transaction"}
        </label>
        {method === "cash" ? (
          <>
            <input
              id="payment-reference"
              name="reference"
              value={cashReference}
              placeholder={cashReferenceLoading ? "Réservation en cours…" : "Choisir une date pour générer la référence"}
              readOnly
              required
              aria-describedby="cash-reference-help"
            />
            <small id="cash-reference-help">
              {cashReference
                ? "Numéro réservé : il sera conservé lors de l'enregistrement. Champ non modifiable."
                : "Sélectionne la date du paiement. MAGNISA réservera automatiquement un numéro unique."}
            </small>
            {cashReferenceError && <p className="error" role="alert">{cashReferenceError}</p>}
          </>
        ) : (
          <>
            <input
              id="payment-reference"
              name="reference"
              key={method}
              placeholder="Référence figurant sur le justificatif"
            />
            <small>Saisis la référence réelle communiquée par la banque ou l'opérateur, sans préfixe artificiel.</small>
          </>
        )}
      </div>
      <button className="button primary" disabled={!valid || !accounts.length || !method || (method === "mobile_money" && !mobileOperator) || (showMvola && (!mvolaFeeOption || !feeValid || (selectedAccount?.type !== "mobile_money" || operatorMismatch))) || (method === "cash" && (!cashReference || cashReferenceLoading))}>
        Enregistrer
      </button>
    </form>
  );
}
