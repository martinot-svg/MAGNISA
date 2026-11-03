import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { AmendmentForm } from "./amendment-form";

async function createAmendment(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.manage");
  const { supabase, organizationId } = ctx;
  const loanId = String(fd.get("loan_id") || "");
  const effectiveFrom = String(fd.get("effective_from") || "");
  const reference = String(fd.get("amendment_reference") || "").trim();
  const reason = String(fd.get("amendment_reason") || "").trim();
  const installmentsRaw = String(fd.get("installments") || "");

  if (!/^[0-9a-f-]{36}$/i.test(loanId)) throw new Error("Emprunt invalide.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) throw new Error("Date d'effet invalide.");
  if (reference.length < 2 || reference.length > 120) throw new Error("La référence de l'avenant doit contenir entre 2 et 120 caractères.");
  if (reason.length < 3 || reason.length > 500) throw new Error("Le motif doit contenir entre 3 et 500 caractères.");

  let installments: unknown;
  try { installments = JSON.parse(installmentsRaw); } catch { throw new Error("L'échéancier généré est invalide."); }
  if (!Array.isArray(installments) || installments.length < 1 || installments.length > 1200) throw new Error("L'échéancier doit contenir entre 1 et 1 200 échéances.");

  const { data: loan, error: loanError } = await supabase
    .from("loans")
    .select("id,status,start_date,active_schedule_version_id")
    .eq("id", loanId)
    .eq("organization_id", organizationId)
    .single();
  if (loanError || !loan) throw new Error("Emprunt introuvable ou inaccessible.");
  if (loan.status !== "active") throw new Error("Seul un emprunt actif peut recevoir un avenant.");
  if (effectiveFrom <= loan.start_date) throw new Error("La date d'effet doit être postérieure à la date de départ du contrat.");
  if (!loan.active_schedule_version_id) throw new Error("Aucun échéancier actif n'est associé à cet emprunt.");

  const { data: activeRows, error: rowsError } = await supabase
    .from("loan_installments")
    .select("id,due_date,status")
    .eq("loan_id", loanId)
    .eq("organization_id", organizationId)
    .eq("schedule_version_id", loan.active_schedule_version_id)
    .order("installment_number");
  if (rowsError) throw new Error(rowsError.message);
  const blocked = (activeRows || []).some((row: any) => row.status === "paid" && row.due_date >= effectiveFrom);
  if (blocked) throw new Error("Impossible de prendre effet à cette date: une échéance déjà payée se trouve à partir de la date d'effet.");

  const { error } = await supabase.rpc("create_loan_schedule_amendment", {
    p_organization_id: organizationId,
    p_loan_id: loanId,
    p_effective_from: effectiveFrom,
    p_amendment_reference: reference,
    p_amendment_reason: reason,
    p_installments: installments,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/emprunts");
  revalidatePath(`/emprunts/${loanId}`);
  revalidatePath(`/emprunts/${loanId}/avenant`);
  redirect(`/emprunts/${loanId}#historique-echeanciers`);
}

export default async function LoanAmendmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.manage");
  const { supabase, organizationId } = ctx;

  const [{ data: loan }, { data: org }] = await Promise.all([
    supabase.from("loans").select("id,lender_name,magnisa_reference,contract_reference,status,outstanding_principal,interest_rate,repayment_method,payment_frequency,interest_calculation_method,active_schedule_version_id,start_date").eq("id", id).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);
  if (!loan) notFound();
  if (loan.status !== "active") notFound();

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow"><Link href={`/emprunts/${loan.id}`}>Emprunts / {loan.lender_name}</Link> / Avenant</p>
          <h1>Nouvel avenant bancaire</h1>
          <p>Création d'une nouvelle version de l'échéancier sans modifier l'historique contractuel ni les remboursements déjà enregistrés.</p>
        </div>
        <Link className="button secondary" href={`/emprunts/${loan.id}`}>Annuler</Link>
      </div>

      <section className="section">
        <div className="card">
          <p className="eyebrow">Situation de départ</p>
          <div className="grid2">
            <div><b>Capital restant dû</b><p>{Number(loan.outstanding_principal).toLocaleString("fr-FR")} {org?.currency || "MGA"}</p></div>
            <div><b>Taux actuel</b><p>{loan.interest_rate ?? 0} %</p></div>
            <div><b>Périodicité actuelle</b><p>{loan.payment_frequency} fois/an</p></div>
            <div><b>Version active</b><p>Version {loan.active_schedule_version_id ? "actuelle" : "non configurée"}</p></div>
          </div>
        </div>
      </section>

      <AmendmentForm
        loanId={loan.id}
        principal={Number(loan.outstanding_principal)}
        annualRatePercent={Number(loan.interest_rate || 0)}
        currentFrequency={Number(loan.payment_frequency || 12)}
        currentMethod={loan.repayment_method === "equal_principal" || loan.repayment_method === "bullet" ? loan.repayment_method : "annuity"}
        interestCalculationMethod={loan.interest_calculation_method === "original_principal" ? "original_principal" : "outstanding_balance"}
        action={createAmendment}
      />
    </>
  );
}
