import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";

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
  ]);

  if (entryError || organizationError || balanceError || integrityError) {
    throw new Error("Impossible de charger la comptabilite PCG 2005 : " +
      [entryError, organizationError, balanceError, integrityError].filter(Boolean)
        .map(e => e!.message).join(" ; "));
  }

  const currency = organization?.currency || "MGA";
  const rows = balance || [];
  const unmapped = rows.filter((r: any) => r.mapping_status === "a_mapper");
  const debit = rows.reduce((a: number, r: any) => a + Number(r.total_debit || 0), 0);
  const credit = rows.reduce((a: number, r: any) => a + Number(r.total_credit || 0), 0);
  const balanced = Math.abs(debit - credit) < 0.005;

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
      {(unmapped.length > 0 || anomalies.length > 0) && (
        <section className="card section" role="alert">
          <h2>Points a regulariser avant une cloture</h2>
          {unmapped.length > 0 && <p>{unmapped.length} rubrique(s) sans correspondance PCG : elles restent classees NON_CLASSE et ne doivent pas etre utilisees dans des etats financiers definitifs.</p>}
          {anomalies.length > 0 && <p>{anomalies.length} ecriture(s) dont les totaux sont incoherents. Verifier les pieces justificatives et la comptabilisation d'origine.</p>}
        </section>
      )}
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
