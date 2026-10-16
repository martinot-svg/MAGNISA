import { assertPermission, hasPermission, requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";

async function assignAccountMapping(formData: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const legacy = String(formData.get("legacy_account_key") || "").trim();
  const code = String(formData.get("pcg_code") || "").trim();
  if (!legacy || !/^[1-7][0-9]{0,5}$/.test(code)) throw new Error("Imputation comptable invalide.");
  const [{ data: existing, error: lineError }, { data: account, error: accountError }] = await Promise.all([
    ctx.supabase.from("journal_entry_lines").select("id")
      .eq("organization_id", ctx.organizationId).eq("account_key", legacy).limit(1),
    ctx.supabase.from("pcg2005_accounts").select("code").eq("code", code).maybeSingle(),
  ]);
  if (lineError || accountError || !existing?.length || !account) {
    throw new Error("Compte source ou compte PCG introuvable pour cette entreprise.");
  }
  const { error } = await ctx.supabase.from("pcg2005_account_mappings").upsert({
    organization_id: ctx.organizationId,
    legacy_account_key: legacy,
    pcg_code: code,
    updated_by: ctx.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,legacy_account_key" });
  if (error) throw new Error(error.message);
  revalidatePath("/comptabilite");
}

/**
 * Lecture comptable PCG 2005 (Madagascar).
 * La balance est issue des ecritures en partie double, jamais des seuls flux bancaires.
 * Une cle metier non mappee doit rester visible comme NON_CLASSE.
 */
export default async function Accounting() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.view");
  const { supabase, organizationId } = ctx;
  const [
    { data: entries = [], error: entryError },
    { data: organization, error: organizationError },
    { data: balance = [], error: balanceError },
    { data: anomalies = [], error: integrityError },
    { data: chart = [], error: catalogError },
    { data: invoiceReconciliation = [], error: invoiceReconciliationError },
    { data: supplierReconciliation = [], error: supplierReconciliationError },
    { data: accountReconciliation = [], error: accountReconciliationError },
  ] = await Promise.all([
    supabase.from("journal_entries")
      .select("id,entry_date,reference,description,status,total_debit,total_credit")
      .eq("organization_id", organizationId).order("entry_date", { ascending: false }).limit(100),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("pcg2005_trial_balance")
      .select("pcg_code,account_key,account_label,mapping_status,total_debit,total_credit,net_debit")
      .eq("organization_id", organizationId).order("pcg_code"),
    supabase.from("pcg2005_journal_integrity")
      .select("id,reference,integrity_status").eq("organization_id", organizationId)
      .eq("integrity_status", "anomalie").limit(100),
    supabase.from("pcg2005_accounts").select("code,label").order("code"),
    supabase.from("magnisa_invoice_reconciliation").select("invoice_id,number,reconciliation_status,payment_difference,allocation_difference").eq("organization_id", organizationId),
    supabase.from("magnisa_supplier_reconciliation").select("supplier_invoice_id,supplier_number,reconciliation_status,payment_difference,allocation_difference").eq("organization_id", organizationId),
    supabase.from("magnisa_account_reconciliation").select("financial_account_id,name,reconciliation_status,balance_difference").eq("organization_id", organizationId),
  ]);

  if (entryError || organizationError || balanceError || integrityError || catalogError || invoiceReconciliationError || supplierReconciliationError || accountReconciliationError) {
    throw new Error("Impossible de charger la comptabilite PCG 2005 : " +
      [entryError, organizationError, balanceError, integrityError, catalogError, invoiceReconciliationError, supplierReconciliationError, accountReconciliationError].filter(Boolean)
        .map(e => e!.message).join(" ; "));
  }

  const canManage = await hasPermission(ctx, "accounting.manage");
  const currency = organization?.currency || "MGA";
  const rows = balance || [];
  const unmapped = rows.filter((r: any) => r.mapping_status === "a_mapper");
  const debit = rows.reduce((a: number, r: any) => a + Number(r.total_debit || 0), 0);
  const credit = rows.reduce((a: number, r: any) => a + Number(r.total_credit || 0), 0);
  const balanced = Math.abs(debit - credit) < 0.005;
  const invoiceGaps = (invoiceReconciliation || []).filter((r: any) => r.reconciliation_status !== "ok");
  const supplierGaps = (supplierReconciliation || []).filter((r: any) => r.reconciliation_status !== "ok");
  const accountGaps = (accountReconciliation || []).filter((r: any) => r.reconciliation_status !== "ok");
  const reconciliationCount = invoiceGaps.length + supplierGaps.length + accountGaps.length;

  return <>
    <div className="pageHead">
      <div>
        <h1>Comptabilite</h1>
        <p>Journal et balance avec correspondance au Plan Comptable General 2005 de Madagascar.</p>
      </div>
    </div>
    {entries.length === 0 ? (
      <EmptyState title="Aucune ecriture comptable"
        description="Les ecritures sont produites par les operations metier validees. Aucun chiffre de demonstration n'est ajoute." />
    ) : <>
      <div className="grid3">
        <section className="card">
          <div className="muted">Total debits</div>
          <div className="metric">{money(debit, currency)}</div>
        </section>
        <section className="card">
          <div className="muted">Total credits</div>
          <div className="metric">{money(credit, currency)}</div>
        </section>
        <section className="card">
          <div className="muted">Controle de la partie double</div>
          <div className="metric">{balanced && !anomalies.length ? "Equilibree" : "A verifier"}</div>
        </section>
      </div>
      <section className="card section" aria-label="Rapprochement financier">
        <h2>Rapprochement des données financières</h2>
        <p className="muted">Contrôle indépendant entre soldes stockés et opérations enregistrées. Les écarts ne sont jamais corrigés automatiquement.</p>
        <div className="grid3">
          <div><strong>Factures clients</strong><p>{(invoiceReconciliation || []).length} vérifiées — {invoiceGaps.length} écart(s)</p></div>
          <div><strong>Factures fournisseurs</strong><p>{(supplierReconciliation || []).length} vérifiées — {supplierGaps.length} écart(s)</p></div>
          <div><strong>Comptes financiers</strong><p>{(accountReconciliation || []).length} vérifiés — {accountGaps.length} écart(s)</p></div>
        </div>
        {reconciliationCount > 0 && <div role="alert">
          <p><strong>{reconciliationCount} anomalie(s) à investiguer avant validation comptable.</strong></p>
          <ul>
            {invoiceGaps.map((r: any) => <li key={r.invoice_id}>Facture {r.number} : {r.reconciliation_status} ; écart règlements {money(r.payment_difference, currency)} ; écart solde {money(r.allocation_difference, currency)}</li>)}
            {supplierGaps.map((r: any) => <li key={r.supplier_invoice_id}>Fournisseur {r.supplier_number} : {r.reconciliation_status} ; écart règlements {money(r.payment_difference, currency)}</li>)}
            {accountGaps.map((r: any) => <li key={r.financial_account_id}>Compte {r.name} : {r.reconciliation_status} ; écart {money(r.balance_difference, currency)}</li>)}
          </ul>
        </div>}
      </section>
      {(unmapped.length > 0 || anomalies.length > 0) && (
        <section className="card section" role="alert">
          <h2>Points a regulariser avant une cloture</h2>
          {unmapped.length > 0 && <p>{unmapped.length} rubrique(s) sans correspondance PCG : elles restent classees NON_CLASSE et ne doivent pas etre utilisees dans des etats financiers definitifs.</p>}
          {anomalies.length > 0 && <p>{anomalies.length} ecriture(s) dont les totaux sont incoherents. Verifier les pieces justificatives et la comptabilisation d'origine.</p>}
        </section>
      )}
      {canManage && unmapped.length > 0 && <section className="card section">
        <h2>Imputer les comptes non classes</h2>
        <p className="muted">L'imputation manuelle doit reposer sur une piece justificative et sur la nature economique de la charge.</p>
        {unmapped.map((r: any, index: number) => <form key={r.account_key + index} action={assignAccountMapping} className="form">
          <input type="hidden" name="legacy_account_key" value={r.account_key} />
          <div className="field"><label>Compte MAGNISA</label><p>{r.account_label} ({r.account_key})</p></div>
          <div className="field"><label>Compte PCG 2005</label><select name="pcg_code" required>
            <option value="">Selectionner une imputation justifiee</option>
            {(chart || []).map((account: any) => <option key={account.code} value={account.code}>
              {account.code} — {account.label}
            </option>)}
          </select></div>
          <button className="button primary">Enregistrer l'imputation</button>
        </form>)}
      </section>}
      <section className="section">
        <h2>Balance PCG 2005 — detail des comptes</h2>
        <p className="muted">Correspondance indicative des comptes internes. Les imputations specifiques restent a valider par le responsable comptable.</p>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Compte PCG</th><th>Compte MAGNISA</th><th>Libelle</th><th>Source</th><th className="right">Debit</th><th className="right">Credit</th><th className="right">Solde debiteur</th></tr></thead>
            <tbody>{rows.map((r: any, idx: number) => (
              <tr key={r.account_key + ":" + idx}>
                <td>{r.pcg_code === "NON_CLASSE" ? "A mapper" : r.pcg_code}</td>
                <td>{r.account_key}</td><td>{r.account_label}</td>
                <td>{r.mapping_status}</td>
                <td className="right">{money(r.total_debit, currency)}</td>
                <td className="right">{money(r.total_credit, currency)}</td>
                <td className="right">{money(r.net_debit, currency)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section className="section">
        <h2>Journal des operations</h2>
        <div className="tableWrap"><table>
          <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Statut</th><th className="right">Debit</th><th className="right">Credit</th></tr></thead>
          <tbody>{entries.map((entry: any) => (
            <tr key={entry.id}><td>{entry.entry_date}</td><td>{entry.reference}</td>
              <td>{entry.description}</td><td>{entry.status}</td>
              <td className="right">{money(entry.total_debit, currency)}</td>
              <td className="right">{money(entry.total_credit, currency)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <p className="muted">La balance constitue un etat de travail. Le bilan, le compte de resultat et les autres etats PCG necessitent la justification des imputations et les operations d'inventaire et de cloture.</p>
    </>}
  </>;
}
