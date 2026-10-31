import { randomUUID } from "crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { money } from "@/lib/money";
import { FormDialog } from "@/components/form-dialog";

async function reverseLoanRepayment(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "treasury.transfer");
  const { supabase, organizationId } = ctx;
  const loanId = String(fd.get("loan_id") || "");
  const repaymentId = String(fd.get("repayment_id") || "");
  const reversalDate = String(fd.get("reversal_date") || "");
  const requestKey = String(fd.get("request_key") || "");
  const reason = String(fd.get("reason") || "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(loanId) || !/^[0-9a-f-]{36}$/i.test(repaymentId)) throw new Error("Emprunt ou remboursement invalide.");
  if (!/^[0-9a-f-]{36}$/i.test(requestKey)) throw new Error("Clé de sécurité invalide. Recharge la page.");
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(reversalDate) || Number.isNaN(Date.parse(reversalDate))) throw new Error("Date de contrepassation invalide.");
  if (reason.length < 5 || reason.length > 500) throw new Error("Le motif doit contenir entre 5 et 500 caractères.");

  const { error } = await supabase.rpc("reverse_loan_repayment", {
    p_organization_id: organizationId,
    p_repayment_id: repaymentId,
    p_reversal_date: reversalDate,
    p_request_key: requestKey,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/emprunts");
  revalidatePath(`/emprunts/${loanId}`);
  revalidatePath("/tresorerie");
  revalidatePath("/comptabilite");
}

export default async function LoanRepaymentReversalPage({ params }: { params: Promise<{ id: string; repaymentId: string }> }) {
  const { id, repaymentId } = await params;
  const ctx = await requireOrganization();
  const { supabase, organizationId } = ctx;
  const canReverse = await hasPermission(ctx, "treasury.transfer");
  const [{ data: org }, { data: loan }, { data: repayment }] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("loans").select("id,lender_name").eq("id", id).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("loan_repayments").select("id,loan_id,payment_date,amount,principal_paid,interest_paid,fees_paid,penalty_paid,status,payment_reference,installment_id").eq("id", repaymentId).eq("loan_id", id).eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (!loan || !repayment) notFound();
  const currency = org?.currency || "MGA";
  const requestKey = randomUUID();
  const today = new Date().toISOString().slice(0,10);

  return (
    <main className="section">
      <p className="eyebrow"><Link href={`/emprunts/${id}`}>Emprunt</Link> / Contrepassation</p>
      <h1>Contrepasser un remboursement</h1>
      <p>{loan.lender_name}</p>
      <div className="card section">
        <p>Date d’origine : <strong>{repayment.payment_date}</strong></p>
        <p>Montant : <strong>{money(Number(repayment.amount), currency)}</strong></p>
        <p>Capital imputé : {money(Number(repayment.principal_paid), currency)}</p>
        <p>Intérêts : {money(Number(repayment.interest_paid), currency)}</p>
        <p>Frais : {money(Number(repayment.fees_paid), currency)}</p>
        <p>Pénalités : {money(Number(repayment.penalty_paid), currency)}</p>
        <p>Statut : <strong>{repayment.status}</strong></p>
      </div>
      {repayment.status === "posted" && canReverse ? (
        <FormDialog title="Confirmer la contrepassation" buttonLabel="Contrepasser ce remboursement">
          <form action={reverseLoanRepayment} className="form">
            <input type="hidden" name="loan_id" value={loan.id} />
            <input type="hidden" name="repayment_id" value={repayment.id} />
            <input type="hidden" name="request_key" value={requestKey} />
            <div className="field"><label>Date comptable de contrepassation</label><input name="reversal_date" type="date" defaultValue={today} max={today} min={repayment.payment_date} required /></div>
            <div className="field"><label>Motif obligatoire et justificatif</label><textarea name="reason" minLength={5} maxLength={500} required /></div>
            <p className="muted">La contrepassation conserve le remboursement initial et crée un mouvement de trésorerie ainsi qu’une écriture comptable inversée. Elle est refusée si une opération postérieure empêche une restauration sûre de l’échéancier ou si la période comptable est fermée.</p>
            <button className="button primary">Valider la contrepassation</button>
          </form>
        </FormDialog>
      ) : <p className="muted">Ce remboursement n’est pas contrepassable depuis cet écran ou tu ne disposes pas de la permission requise.</p>}
      <p className="section"><Link className="button secondary" href={`/emprunts/${id}`}>Retour au contrat</Link></p>
    </main>
  );
}
