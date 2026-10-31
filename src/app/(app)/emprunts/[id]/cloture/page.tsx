import { randomUUID } from "crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { money } from "@/lib/money";
import { FormDialog } from "@/components/form-dialog";

async function closeLoanEarly(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "treasury.transfer");
  const { supabase, organizationId } = ctx;
  const loanId = String(fd.get("loan_id") || "");
  const paymentDate = String(fd.get("payment_date") || "");
  const accountId = String(fd.get("financial_account_id") || "");
  const requestKey = String(fd.get("request_key") || "");
  const reference = String(fd.get("payment_reference") || "").trim() || null;
  const notes = String(fd.get("notes") || "").trim() || null;

  if (!/^[0-9a-f-]{36}$/i.test(loanId)) throw new Error("Emprunt invalide.");
  if (!/^[0-9a-f-]{36}$/i.test(requestKey)) throw new Error("Clé de sécurité invalide. Recharge la page.");
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(paymentDate) || Number.isNaN(Date.parse(paymentDate))) throw new Error("Date de clôture invalide.");
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error("Sélectionne un compte de trésorerie valide.");

  const { error } = await supabase.rpc("close_loan_early", {
    p_organization_id: organizationId,
    p_loan_id: loanId,
    p_payment_date: paymentDate,
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

export default async function EarlyClosurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  await requirePermission(ctx, "finance.view");
  const { supabase, organizationId } = ctx;
  const canClose = await (async () => {
    try { await requirePermission(ctx, "treasury.transfer"); return true; }
    catch { return false; }
  })();

  const [{ data: org }, { data: loan }, { data: accounts = [] }, { data: dueInstallments = [] }] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("loans").select("id,lender_name,status,outstanding_principal,start_date,liability_account_code").eq("id", id).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("financial_accounts").select("id,name,type,balance").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("loan_installments").select("id,installment_number,due_date,status").eq("loan_id", id).eq("organization_id", organizationId).in("status", ["planned","partial","overdue"]),
  ]);
  if (!loan) notFound();
  const currency = org?.currency || "MGA";
  const requestKey = randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const blockingDues = dueInstallments.filter((row: any) => row.due_date <= today);
  const eligible = loan.status === "active"
    && Number(loan.outstanding_principal) > 0
    && !!loan.liability_account_code
    && ["164", "168"].includes(loan.liability_account_code)
    && blockingDues.length === 0
    && canClose
    && accounts.length > 0;

  return (
    <main className="section">
      <p className="eyebrow"><Link href={`/emprunts/${id}`}>Emprunt</Link> / Clôture anticipée</p>
      <div className="pageHead">
        <div><h1>Clôture anticipée</h1><p>{loan.lender_name}</p></div>
        <Link className="button secondary" href={`/emprunts/${id}`}>Retour au contrat</Link>
      </div>
      <div className="card section">
        <p className="eyebrow">Capital à rembourser</p>
        <h2>{money(Number(loan.outstanding_principal), currency)}</h2>
        <p className="muted">Le calcul règle le capital restant dû. Les intérêts courus non encore comptabilisés et les indemnités contractuelles doivent être ajoutés uniquement après vérification d'un décompte du prêteur. Ils ne sont pas estimés automatiquement.</p>
        <p>Statut du contrat : <strong>{loan.status}</strong></p>
      </div>
      {blockingDues.length > 0 ? <p className="notice">Clôture bloquée : règle d’abord les échéances arrivées à terme ou en retard.</p> : null}
      {!loan.liability_account_code || !["164", "168"].includes(loan.liability_account_code) ? <p className="notice">Configure d’abord le compte de dette PCG 164 ou 168 dans les conditions du contrat.</p> : null}
      {accounts.length === 0 ? <p className="muted">Aucun compte de trésorerie actif n’est disponible.</p> : null}
      {canClose && eligible ? (
        <FormDialog title="Confirmer la clôture anticipée" buttonLabel="Clôturer l’emprunt">
          <form action={closeLoanEarly} className="form">
            <input type="hidden" name="loan_id" value={loan.id} />
            <input type="hidden" name="request_key" value={requestKey} />
            <div className="field"><label>Montant de clôture (capital restant dû)</label><input value={money(Number(loan.outstanding_principal), currency)} readOnly /></div>
            <div className="field"><label>Date réelle du paiement</label><input name="payment_date" type="date" defaultValue={today} max={today} min={loan.start_date} required /></div>
            <div className="field"><label>Compte bancaire ou de trésorerie</label><select name="financial_account_id" required defaultValue=""><option value="" disabled>Choisir un compte</option>{accounts.map((account: any) => <option key={account.id} value={account.id}>{account.name} · {account.type} · Solde {money(Number(account.balance), currency)}</option>)}</select></div>
            <div className="field"><label>Référence bancaire (facultatif)</label><input name="payment_reference" maxLength={120} /></div>
            <div className="field"><label>Notes et référence du décompte prêteur</label><textarea name="notes" maxLength={1000} /></div>
            <p className="muted">Cette validation crée un remboursement, un mouvement de trésorerie et une écriture comptable équilibrée. Les échéances futures planifiées sont annulées. L’opération est irréversible depuis cet écran : toute correction devra passer par une opération comptable inverse.</p>
            <button className="button primary">Confirmer et comptabiliser la clôture</button>
          </form>
        </FormDialog>
      ) : null}
    </main>
  );
}
