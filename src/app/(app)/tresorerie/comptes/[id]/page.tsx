import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { money } from "@/lib/money";

type Movement = {
  id: string;
  transaction_date: string;
  created_at: string;
  amount: number;
  kind: string;
  source_type: string | null;
  source_id: string | null;
  reference: string | null;
  description: string | null;
};

type PaymentInfo = {
  id: string;
  reference: string | null;
  mvola_withdrawal_fee_option: string | null;
  invoices: { number: string } | { number: string }[] | null;
  customers: { name: string } | { name: string }[] | null;
};

function itemLabel(entry: Movement) {
  if (entry.source_type === "mvola_fee_contribution") return "Remboursement frais MVola";
  if (entry.source_type === "payment" || entry.kind === "customer_payment") return "Encaissement de facture";
  if (entry.kind === "transfer_in") return "Transfert entrant";
  if (entry.kind === "transfer_out") return "Transfert sortant";
  if (entry.kind === "expense") return "Dépense / charge";
  return entry.description || entry.kind || "Mouvement financier";
}

function relatedName<T extends Record<string, string>>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function AccountStatement({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "treasury.view");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const { supabase, organizationId } = ctx;
  const [{ data: account, error: accountError }, { data: org }] = await Promise.all([
    supabase.from("financial_accounts")
      .select("id,name,type,balance,is_active")
      .eq("organization_id", organizationId).eq("id", id).maybeSingle(),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);
  if (accountError) throw new Error(accountError.message);
  if (!account) notFound();

  const { data: rawMovements, error: movementsError } = await supabase
    .from("financial_transactions")
    .select("id,transaction_date,created_at,amount,kind,source_type,source_id,reference,description")
    .eq("organization_id", organizationId)
    .eq("financial_account_id", id)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(201);
  if (movementsError) throw new Error(movementsError.message);

  const capped = (rawMovements ?? []).length > 200;
  const movements = ((rawMovements ?? []).slice(0, 200)) as Movement[];
  const paymentIds = [...new Set(movements.filter((m) => (m.source_type === "payment" || m.source_type === "mvola_fee_contribution") && m.source_id).map((m) => m.source_id!))];
  const paymentById = new Map<string, PaymentInfo>();
  if (paymentIds.length) {
    const { data: payments, error: paymentError } = await supabase
      .from("payments")
      .select("id,reference,mvola_withdrawal_fee_option,invoices(number),customers(name)")
      .eq("organization_id", organizationId).in("id", paymentIds);
    if (paymentError) throw new Error(paymentError.message);
    for (const payment of (payments ?? []) as PaymentInfo[]) paymentById.set(payment.id, payment);
  }

  const currency = org?.currency || "MGA";
  const credits = movements.reduce((sum, movement) => sum + Math.max(0, Number(movement.amount)), 0);
  const debits = movements.reduce((sum, movement) => sum + Math.max(0, -Number(movement.amount)), 0);

  return (
    <>
      <div className="pageHead">
        <div>
          <Link href="/tresorerie">← Retour à la trésorerie</Link>
          <h1>Relevé du compte : {account.name}</h1>
          <p>{account.type === "mobile_money" ? "Historique Mobile Money" : "Historique financier"} — mouvements réellement enregistrés.</p>
        </div>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Solde du compte</h2>
          <div className="metric">{money(account.balance, currency)}</div>
          <p className="muted">{account.type === "mobile_money" ? "Mobile Money" : account.type} — {account.is_active ? "Actif" : "Inactif"}</p>
        </section>
        <section className="card">
          <h2>Mouvements affichés</h2>
          <div className="field"><span className="muted">Entrées</span><strong>{money(credits, currency)}</strong></div>
          <div className="field"><span className="muted">Sorties</span><strong>{money(debits, currency)}</strong></div>
          <small>Totaux calculés sur les {movements.length} derniers mouvements affichés, pas nécessairement sur toute la vie du compte.</small>
        </section>
      </div>

      <section className="card section">
        <h2>Historique des transactions</h2>
        {capped && <p className="muted">Les 200 mouvements les plus récents sont affichés. Les opérations antérieures ne sont pas incluses dans les totaux ci-dessus.</p>}
        {!movements.length ? (
          <p className="muted">Aucun mouvement enregistré sur ce compte.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Opération</th>
                  <th>Facture / client</th>
                  <th>Frais MVola</th>
                  <th>Référence</th>
                  <th className="right">Entrée</th>
                  <th className="right">Sortie</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((entry) => {
                  const payment = (entry.source_type === "payment" || entry.source_type === "mvola_fee_contribution") && entry.source_id
                    ? paymentById.get(entry.source_id)
                    : undefined;
                  const invoice = payment ? relatedName(payment.invoices) : null;
                  const customer = payment ? relatedName(payment.customers) : null;
                  const detail = [invoice?.number, customer?.name].filter(Boolean).join(" · ");
                  const feeLabel = account.type === "mobile_money" && payment
                    ? payment.mvola_withdrawal_fee_option === "with_fees"
                      ? "Avec remboursement client"
                      : payment.mvola_withdrawal_fee_option === "without_fees"
                        ? "Non pris en charge par le client"
                        : "Non renseigné"
                    : "—";
                  const amount = Number(entry.amount);
                  return (
                    <tr key={entry.id}>
                      <td>{entry.transaction_date}</td>
                      <td>{itemLabel(entry)}{entry.description && <div className="muted">{entry.description}</div>}</td>
                      <td>{detail || "—"}</td>
                      <td>{feeLabel}</td>
                      <td>{payment?.reference || entry.reference || "—"}</td>
                      <td className="right">{amount > 0 ? money(amount, currency) : "—"}</td>
                      <td className="right">{amount < 0 ? money(-amount, currency) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {account.type === "mobile_money" && (
          <p className="muted">
            Les remboursements réellement encaissés apparaissent comme mouvements distincts, liés aux factures.
            Les frais estimés ne sont pas débités automatiquement : seuls les mouvements enregistrés figurent ici.
          </p>
        )}
      </section>
    </>
  );
}
