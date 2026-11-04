import Link from "next/link";
import { requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";

type PreviewItem = {
  type?: string;
  period_start?: string;
  period_end?: string;
  due_date?: string | null;
  amount_proposed?: number;
  vat_collected?: number;
  vat_input_identified?: number;
  net_before_carryforward?: number;
  rule_code?: string | null;
  requires_review?: boolean;
  note?: string;
};

async function previewFiscalSocial(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const start = String(fd.get("period_start") || "");
  const end = String(fd.get("period_end") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
    throw new Error("Période invalide.");
  }
  redirect(`/fiscalite-social?preview=1&period_start=${encodeURIComponent(start)}&period_end=${encodeURIComponent(end)}`);
}

async function createTax(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const row = {
    organization_id: ctx.organizationId,
    obligation_type: String(fd.get("obligation_type") || "").trim(),
    period_start: String(fd.get("period_start") || ""),
    period_end: String(fd.get("period_end") || ""),
    due_date: String(fd.get("due_date") || ""),
    amount: Number(fd.get("amount") || 0),
  };
  if (!row.obligation_type || !Number.isFinite(row.amount) || row.amount < 0) throw new Error("Obligation invalide.");
  if (!row.period_start || !row.period_end || !row.due_date || row.period_end < row.period_start) throw new Error("Période ou échéance invalide.");
  const { error } = await ctx.supabase.from("tax_obligations").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath("/fiscalite-social");
  revalidatePath("/dettes");
  revalidatePath("/analyse");
}

async function createSocial(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const row = {
    organization_id: ctx.organizationId,
    organization_name: String(fd.get("organization_name") || "").trim(),
    period_start: String(fd.get("period_start") || ""),
    period_end: String(fd.get("period_end") || ""),
    due_date: String(fd.get("due_date") || ""),
    amount: Number(fd.get("amount") || 0),
  };
  if (!Number.isFinite(row.amount) || row.amount < 0) throw new Error("Obligation invalide.");
  if (!row.period_start || !row.period_end || !row.due_date || row.period_end < row.period_start) throw new Error("Période ou échéance invalide.");
  const { error } = await ctx.supabase.from("social_obligations").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath("/fiscalite-social");
  revalidatePath("/dettes");
  revalidatePath("/analyse");
}

function formatDate(value?: string | null) {
  if (!value) return "À confirmer";
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR");
}

export default async function TaxSocial({
  searchParams,
}: {
  searchParams?: Promise<{ preview?: string; period_start?: string; period_end?: string }>;
}) {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "finance.view");
  const { supabase, organizationId } = ctx;
  const params = (await searchParams) || {};
  const start = params.period_start || "";
  const end = params.period_end || "";
  let preview: any = null;
  let previewError = "";
  if (params.preview === "1" && start && end && end >= start) {
    const { data, error } = await supabase.rpc("preview_fiscal_social_obligations", {
      p_org: organizationId,
      p_period_start: start,
      p_period_end: end,
    });
    if (error) previewError = "L’aperçu n’a pas pu être calculé. Vérifie les paramètres fiscaux et les accès, puis réessaie.";
    else preview = data;
  }

  const [{ data: tax = [] }, { data: social = [] }, { data: org }] = await Promise.all([
    supabase.from("tax_obligations").select("*").eq("organization_id", organizationId).order("due_date"),
    supabase.from("social_obligations").select("*").eq("organization_id", organizationId).order("due_date"),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);
  const currency = org?.currency || "MGA";
  const taxPreview: PreviewItem[] = Array.isArray(preview?.tax_obligations) ? preview.tax_obligations : [];
  const socialPreview: PreviewItem[] = Array.isArray(preview?.social_obligations) ? preview.social_obligations : [];
  const warnings: string[] = Array.isArray(preview?.warnings) ? preview.warnings : [];

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Fiscalité & social</h1>
          <p>Calcul en lecture seule, contrôle des règles, puis validation explicite avant toute création d’obligation.</p>
          <p><Link className="button" href="/paie/parametres#bareme-irsa">Consulter le barème IRSA</Link> <Link className="button" href="/fiscalite-social/calendrier">Calendrier social</Link> <Link className="button" href="/fiscalite/calendrier">Calendrier fiscal</Link></p>
        </div>
      </div>

      <section className="card section">
        <h2>Calculer un aperçu fiscal et social</h2>
        <p>Cette opération lit les factures et les bulletins de paie de la période. Elle ne crée, ne modifie et ne paie aucune obligation.</p>
        <form action={previewFiscalSocial} className="form">
          <div className="grid2">
            <div className="field">
              <label htmlFor="period_start">Début de période</label>
              <input id="period_start" type="date" name="period_start" defaultValue={start} required />
            </div>
            <div className="field">
              <label htmlFor="period_end">Fin de période</label>
              <input id="period_end" type="date" name="period_end" defaultValue={end} required />
            </div>
          </div>
          <button className="button primary">Calculer l’aperçu</button>
        </form>
      </section>

      {previewError ? <section className="card section"><h2>Aperçu indisponible</h2><p role="alert">{previewError}</p></section> : null}
      {preview ? (
        <section className="card section">
          <h2>Résultat de l’aperçu</h2>
          <p><strong>Période :</strong> {formatDate(start)} au {formatDate(end)}</p>
          <p><strong>Profil fiscal :</strong> {preview.profile_confirmed ? "Confirmé" : "Non confirmé"}</p>
          <p><strong>Écriture en base :</strong> aucune. Cet aperçu est sans effet sur les obligations existantes.</p>
          {warnings.length > 0 ? (
            <div className="notice" role="alert">
              <strong>Points à résoudre avant toute génération</strong>
              <ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </div>
          ) : null}
          {taxPreview.length === 0 && socialPreview.length === 0 ? <p>Aucune proposition calculable pour cette période à partir des données et paramètres actuellement disponibles.</p> : null}

          {taxPreview.length > 0 ? (
            <>
              <h3>Propositions fiscales</h3>
              <div className="tableWrap">
                <table>
                  <thead><tr><th>Type</th><th>Échéance indicative</th><th className="right">Montant proposé</th><th>Contrôle requis</th></tr></thead>
                  <tbody>
                    {taxPreview.map((item, index) => (
                      <tr key={`${item.rule_code || item.type}-${index}`}>
                        <td>{item.type || "Impôt"}</td>
                        <td>{formatDate(item.due_date)}</td>
                        <td className="right">{money(Number(item.amount_proposed || 0), currency)}</td>
                        <td>{item.requires_review ? "Oui" : "À confirmer"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {taxPreview.map((item, index) => item.type === "TVA" ? (
                <div key={`vat-details-${index}`}>
                  <p>TVA collectée identifiée : <strong>{money(Number(item.vat_collected || 0), currency)}</strong></p>
                  <p>TVA déductible identifiée : <strong>{money(Number(item.vat_input_identified || 0), currency)}</strong></p>
                  <p>Solde avant report de crédit : <strong>{money(Number(item.net_before_carryforward || 0), currency)}</strong></p>
                </div>
              ) : null)}
            </>
          ) : null}

          {socialPreview.length > 0 ? (
            <>
              <h3>Propositions sociales</h3>
              <div className="tableWrap">
                <table>
                  <thead><tr><th>Organisme</th><th>Échéance</th><th className="right">Montant proposé</th><th>Contrôle requis</th></tr></thead>
                  <tbody>
                    {socialPreview.map((item, index) => (
                      <tr key={`${item.rule_code || item.type}-${index}`}>
                        <td>{item.type || "Organisme social"}</td>
                        <td>{formatDate(item.due_date)}</td>
                        <td className="right">{money(Number(item.amount_proposed || 0), currency)}</td>
                        <td>{item.requires_review ? "Oui" : "À confirmer"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <p><strong>Création désactivée :</strong> les règles, les montants et les échéances doivent être vérifiés. Aucun bouton de génération n’est proposé tant que les contrôles ne sont pas validés.</p>
        </section>
      ) : null}

      <div className="grid2 section">
        <section>
          <h2>Dettes fiscales enregistrées</h2>
          {!tax.length ? <EmptyState title="Aucune obligation fiscale" description="Aucune dette fiscale enregistrée pour cette entreprise." /> : (
            <div className="tableWrap"><table><thead><tr><th>Type</th><th>Période</th><th>Échéance</th><th>Statut</th><th className="right">Montant</th></tr></thead>
              <tbody>{tax.map((x: any) => <tr key={x.id}><td>{x.obligation_type}</td><td>{formatDate(x.period_start)} - {formatDate(x.period_end)}</td><td>{formatDate(x.due_date)}</td><td>{x.status}</td><td className="right">{money(x.amount, currency)}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
        <section>
          <h2>Dettes sociales enregistrées</h2>
          {!social.length ? <EmptyState title="Aucune obligation sociale" description="Aucune dette sociale enregistrée pour cette entreprise." /> : (
            <div className="tableWrap"><table><thead><tr><th>Organisme</th><th>Période</th><th>Échéance</th><th>Statut</th><th className="right">Montant</th></tr></thead>
              <tbody>{social.map((x: any) => <tr key={x.id}><td>{x.organization_name || "Organisme social"}</td><td>{formatDate(x.period_start)} - {formatDate(x.period_end)}</td><td>{formatDate(x.due_date)}</td><td>{x.status}</td><td className="right">{money(x.amount, currency)}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
      </div>

      <details className="section">
        <summary>Enregistrement manuel d’une obligation déjà vérifiée</summary>
        <p>À utiliser uniquement pour une obligation réelle dont le montant et l’échéance ont été vérifiés à partir d’une pièce justificative officielle.</p>
        <div className="grid2 section">
          <div className="card">
            <h2>Ajouter une obligation fiscale</h2>
            <form action={createTax} className="form">
              <div className="field"><label>Type</label><input name="obligation_type" required /></div>
              <div className="grid2"><div className="field"><label>Début période</label><input type="date" name="period_start" required /></div><div className="field"><label>Fin période</label><input type="date" name="period_end" required /></div></div>
              <div className="field"><label>Échéance confirmée</label><input type="date" name="due_date" required /></div>
              <div className="field"><label>Montant vérifié</label><input type="number" min="0" step="0.01" name="amount" required /></div>
              <button className="button primary">Enregistrer l’obligation vérifiée</button>
            </form>
          </div>
          <div className="card">
            <h2>Ajouter une obligation sociale</h2>
            <form action={createSocial} className="form">
              <div className="field"><label>Organisme</label><input name="organization_name" required /></div>
              <div className="grid2"><div className="field"><label>Début période</label><input type="date" name="period_start" required /></div><div className="field"><label>Fin période</label><input type="date" name="period_end" required /></div></div>
              <div className="field"><label>Échéance confirmée</label><input type="date" name="due_date" required /></div>
              <div className="field"><label>Montant vérifié</label><input type="number" min="0" step="0.01" name="amount" required /></div>
              <button className="button primary">Enregistrer l’obligation vérifiée</button>
            </form>
          </div>
        </div>
      </details>
    </>
  );
}
