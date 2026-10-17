"use client";

import { useEffect, useState } from "react";
import { reserveCashReceiptReference } from "@/server/actions/core";

type InvoiceOption = { id: string; number: string; balance_due: number; customerName: string };
type AccountOption = { id: string; name: string; type: string };

// Barème Cash Point MVola communiqué par l'utilisateur (MGA TTC).
// Estimation seulement : les frais réels sont constatés lors du retrait.
const MVOLA_WITHDRAWAL_FEES: ReadonlyArray<readonly [number, number]> = [
  [1_000, 100], [5_000, 150], [10_000, 275], [20_000, 550],
  [25_000, 650], [50_000, 1_300], [100_000, 1_900],
  [250_000, 3_400], [500_000, 4_700], [1_000_000, 8_800],
  [2_000_000, 14_700], [3_000_000, 19_600],
  [4_000_000, 24_500], [5_000_000, 29_400],
  [6_000_000, 34_300], [7_000_000, 39_200],
  [8_000_000, 44_100], [9_000_000, 49_000],
  [10_000_000, 53_900], [11_000_000, 59_000],
  [12_000_000, 64_000], [13_000_000, 69_000],
  [14_000_000, 74_000], [15_000_000, 79_000],
  [16_000_000, 84_000], [17_000_000, 89_000],
  [18_000_000, 94_000], [19_000_000, 98_000],
  [20_000_000, 100_000],
];

function mvolaWithdrawalFee(amount: number, channel: "cash_point" | "bred"): number | null {
  if (!Number.isInteger(amount) || amount < 100 || amount > 20_000_000) return null;
  if (channel === "bred" && (amount < 5_001 || amount > 500_000)) return null;
  return MVOLA_WITHDRAWAL_FEES.find(([maximum]) => amount <= maximum)?.[1] ?? null;
}

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
  const showMvola = method === "mobile_money" && mobileOperator === "mvola" && currency === "MGA";
  const withdrawalFee = showMvola && valid ? mvolaWithdrawalFee(received, "cash_point") : null;
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
              {item.number} — {item.customerName} — reste {formatter.format(item.balance_due)}
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
            <strong>{valid ? formatter.format(received) : "—"}</strong>
          </div>
          <div className="field">
            <span className="muted">Nouveau solde restant</span>
            <strong>{remaining !== null ? formatter.format(remaining) : "—"}</strong>
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
            value={mobileOperator}
            onChange={(event) => setMobileOperator(event.target.value)}
            required
          >
            <option value="">Sélectionner</option>
            <option value="mvola">MVola</option>
            <option value="other">Autre opérateur (sans barème MVola)</option>
          </select>
        </div>
      )}
      {showMvola && (
        <section className="card" aria-label="Frais de retrait MVola estimés" aria-live="polite">
          <h3>Frais de retrait MVola estimés</h3>
          {withdrawalFee === null ? (
            <small>Tarif indisponible pour ce montant (Cash Point MVola).</small>
          ) : (
            <>
              <div className="field">
                <span className="muted">Frais de retrait (Cash Point)</span>
                <strong>{formatter.format(withdrawalFee)}</strong>
              </div>
              <div className="field">
                <span className="muted">Net estimé si frais déduits</span>
                <strong>{formatter.format(received - withdrawalFee)}</strong>
              </div>
            </>
          )}
          <small>Indication uniquement : la facture reste réglée à hauteur du paiement reçu. Les frais réels sont enregistrés lors du retrait.</small>
        </section>
      )}
      <div className="field">
        <label htmlFor="payment-account">Compte destinataire</label>
        <select id="payment-account" name="financial_account_id" required>
          <option value="">Sélectionner</option>
          {accounts.map((item) => (
            <option key={item.id} value={item.id}>{item.name} ({item.type})</option>
          ))}
        </select>
      </div>
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
      <button className="button primary" disabled={!valid || !accounts.length || !method || (method === "mobile_money" && !mobileOperator) || (method === "cash" && (!cashReference || cashReferenceLoading))}>
        Enregistrer
      </button>
    </form>
  );
}
