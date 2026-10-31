import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";

export default async function LoanDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  await requirePermission(ctx, "finance.view");
  const { supabase, organizationId } = ctx;

  const [{ data: org }, { data: loan }, { data: installments = [] }, { data: repayments = [] }] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("loans").select("*").eq("id", id).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("loan_installments").select("*").eq("loan_id", id).eq("organization_id", organizationId).order("installment_number"),
    supabase.from("loan_repayments").select("*").eq("loan_id", id).eq("organization_id", organizationId).order("payment_date", { ascending: false }),
  ]);
  if (!loan) notFound();
  const currency = org?.currency || "MGA";
  const method = loan.repayment_method === "equal_principal" ? "Capital constant" : loan.repayment_method === "bullet" ? "In fine" : "Annuités constantes";
  const totalInterest = installments.reduce((sum: number, row: any) => sum + Number(row.interest_due), 0);
  const paidTotal = repayments.filter((row: any) => row.status === "posted").reduce((sum: number, row: any) => sum + Number(row.amount), 0);

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
          <tr><th>Nombre d'échéances</th><td>{loan.total_installments ?? "-"}</td><th>Statut</th><td>{loan.status}</td></tr>
          <tr><th>Date de départ</th><td>{loan.start_date}</td><th>Première échéance</th><td>{loan.first_due_date || "-"}</td></tr>
          <tr><th>Date de fin</th><td>{loan.end_date || "-"}</td><th>Notes</th><td>{loan.notes || "-"}</td></tr>
        </tbody></table></div>
      </section>

      <section className="section" id="echeancier">
        <h2>Échéancier prévisionnel</h2>
        {installments.length === 0 ? <p className="muted">Aucun échéancier enregistré pour cet emprunt.</p> : (
          <div className="tableWrap"><table>
            <thead><tr><th>N°</th><th>Date</th><th>Capital début</th><th>Amortissement</th><th>Intérêts</th><th>Échéance</th><th>Capital restant</th><th>Statut</th></tr></thead>
            <tbody>{installments.map((row: any) => <tr key={row.id}>
              <td>{row.installment_number}</td><td>{row.due_date}</td><td>{money(Number(row.opening_principal), currency)}</td>
              <td>{money(Number(row.principal_due), currency)}</td><td>{money(Number(row.interest_due), currency)}</td>
              <td><b>{money(Number(row.total_due), currency)}</b></td><td>{money(Number(row.closing_principal), currency)}</td><td>{row.status}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="section" id="remboursements">
        <h2>Remboursements réels</h2>
        {repayments.length === 0 ? <p className="muted">Aucun remboursement enregistré. Les paiements réels seront ajoutés dans cette section après mise en place de leur validation comptable et trésorerie.</p> : (
          <div className="tableWrap"><table>
            <thead><tr><th>Date</th><th>Montant</th><th>Capital</th><th>Intérêts</th><th>Frais</th><th>Statut</th><th>Référence</th></tr></thead>
            <tbody>{repayments.map((row: any) => <tr key={row.id}>
              <td>{row.payment_date}</td><td>{money(Number(row.amount), currency)}</td><td>{money(Number(row.principal_paid), currency)}</td>
              <td>{money(Number(row.interest_paid), currency)}</td><td>{money(Number(row.fees_paid + row.penalty_paid), currency)}</td><td>{row.status}</td><td>{row.payment_reference || "-"}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
