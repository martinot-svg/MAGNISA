import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, requirePermission } from "@/lib/permissions";

type CalendarRuleRow = {
  id: string;
  organism_code: string;
  label: string;
  periodicity: "monthly" | "quarterly" | "annual" | "one_off";
  due_rule: Record<string, unknown>;
  effective_from: string;
  effective_to: string | null;
  source_label: string | null;
  source_url: string | null;
  status: "draft" | "validated" | "archived";
  notes: string | null;
  version: number;
  updated_at: string;
};

async function createDraft(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const organism = String(fd.get("organism_code") || "").trim().toUpperCase();
  const label = String(fd.get("label") || "").trim();
  const periodicity = String(fd.get("periodicity") || "");
  const dueType = String(fd.get("due_type") || "");
  const dueDay = Number(fd.get("due_day") || 0);
  const days = Number(fd.get("days_after") || 0);
  const effectiveFrom = String(fd.get("effective_from") || "");
  const effectiveTo = String(fd.get("effective_to") || "") || null;
  const sourceLabel = String(fd.get("source_label") || "").trim() || null;
  const sourceUrl = String(fd.get("source_url") || "").trim() || null;
  const notes = String(fd.get("notes") || "").trim() || null;

  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(organism)) throw new Error("Code organisme invalide (ex. DGI_TVA, DGI_IRSA, DGI_IR, DGI_IS).");
  if (label.length < 2 || label.length > 160) throw new Error("Le libellé doit contenir entre 2 et 160 caractères.");
  if (!["monthly", "quarterly", "annual", "one_off"].includes(periodicity)) throw new Error("Périodicité invalide.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || (effectiveTo && (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo) || effectiveTo < effectiveFrom))) {
    throw new Error("Dates d'effet invalides.");
  }
  let dueRule: Record<string, unknown>;
  if (dueType === "day_of_next_month" || dueType === "day_of_month_after_quarter") {
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error("Le jour d'échéance doit être compris entre 1 et 31.");
    dueRule = { type: dueType, day: dueDay };
  } else if (dueType === "days_after_period_end") {
    if (!Number.isInteger(days) || days < 0 || days > 366) throw new Error("Le délai doit être compris entre 0 et 366 jours.");
    dueRule = { type: dueType, days };
  } else {
    throw new Error("Type de règle d'échéance non pris en charge.");
  }
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new Error("L'adresse de la source doit commencer par https:// ou http://.");

  const { error } = await ctx.supabase.from("fiscal_calendar_rules").insert({
    organization_id: ctx.organizationId,
    organism_code: organism,
    label,
    periodicity,
    due_rule: dueRule,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    source_label: sourceLabel,
    source_url: sourceUrl,
    status: "draft",
    notes,
    created_by: ctx.user.id,
    updated_by: ctx.user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/fiscalite-social/calendrier");
  revalidatePath("/fiscalite-social");
}

async function validateRule(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const id = String(fd.get("id") || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Règle de calendrier invalide.");

  const { data: rule, error: readError } = await ctx.supabase
    .from("fiscal_calendar_rules")
    .select("id,organization_id,status,source_label,source_url,effective_from,due_rule")
    .eq("id", id)
    .eq("organization_id", ctx.organizationId)
    .single();
  if (readError || !rule) throw new Error("Cette règle est introuvable pour l'entreprise active.");
  if (rule.status !== "draft") throw new Error("Seule une règle brouillon peut être validée.");
  if (!String(rule.source_label || "").trim()) throw new Error("Ajoute la référence officielle avant validation.");
  if (rule.source_url && !/^https?:\/\//i.test(rule.source_url)) throw new Error("L'adresse de la source est invalide.");
  if (!rule.due_rule || typeof rule.due_rule !== "object" || Object.keys(rule.due_rule).length === 0) throw new Error("La règle d'échéance est vide.");

  const { error } = await ctx.supabase.from("fiscal_calendar_rules").update({
    status: "validated",
    updated_by: ctx.user.id,
  }).eq("id", id).eq("organization_id", ctx.organizationId).eq("status", "draft");
  if (error) throw new Error(error.message);
  revalidatePath("/fiscalite-social/calendrier");
  revalidatePath("/fiscalite-social");
}

async function archiveRule(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const id = String(fd.get("id") || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Règle de calendrier invalide.");
  const { error } = await ctx.supabase.from("fiscal_calendar_rules").update({
    status: "archived",
    updated_by: ctx.user.id,
  }).eq("id", id).eq("organization_id", ctx.organizationId).neq("status", "archived");
  if (error) throw new Error(error.message);
  revalidatePath("/fiscalite-social/calendrier");
  revalidatePath("/fiscalite-social");
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Sans date de fin";
  return new Date(value + "T00:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

function dueLabel(rule: Record<string, unknown>) {
  if (rule.type === "day_of_next_month") return "Jour " + String(rule.day) + " du mois suivant";
  if (rule.type === "day_of_month_after_quarter") return "Jour " + String(rule.day) + " après le trimestre";
  if (rule.type === "days_after_period_end") return String(rule.days) + " jour(s) après la période";
  if (rule.type === "fixed_date") return "Date fixe: " + String(rule.date);
  return "Règle à vérifier";
}

export default async function FiscalCalendarSettings() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "finance.view");
  const canManage = await ctx.supabase.rpc("has_org_permission", {
    p_org: ctx.organizationId,
    p_permission: "accounting.manage",
  });
  const { data, error } = await ctx.supabase
    .from("fiscal_calendar_rules")
    .select("id,organism_code,label,periodicity,due_rule,effective_from,effective_to,source_label,source_url,status,notes,version,updated_at")
    .eq("organization_id", ctx.organizationId)
    .order("organism_code", { ascending: true })
    .order("effective_from", { ascending: false });
  const rules = (data || []) as CalendarRuleRow[];

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Calendrier déclaratif fiscal</h1>
          <p>Paramètre les échéances par obligation fiscale et par période d'effet. Les règles sont propres à l'entreprise active.</p>
          <p><Link className="button" href="/fiscalite-social">Retour à Fiscalité & social</Link> <Link className="button" href="/fiscalite-social/calendrier">Calendrier social</Link></p>
        </div>
      </div>

      <section className="card section">
        <h2>Règles de calendrier</h2>
        <p>Une règle en brouillon ne pilote aucune déclaration. Avant de la valider, vérifie l'échéance auprès de l'organisme officiel et indique la référence consultée. Les changements sont versionnés.</p>
        {error ? <p role="alert">Impossible de charger les règles de calendrier. Vérifie la migration de base de données et les permissions.</p> : null}
        {!error && rules.length === 0 ? <p>Aucune règle configurée. Crée d'abord une règle brouillon, sans activer une échéance non vérifiée.</p> : null}
        {rules.map((rule) => (
          <article className="card section" key={rule.id}>
            <div className="pageHead">
              <div>
                <h3>{rule.label} ({rule.organism_code})</h3>
                <p><strong>État :</strong> {rule.status === "validated" ? "Validée" : rule.status === "draft" ? "Brouillon" : "Archivée"} | <strong>Version :</strong> {rule.version}</p>
              </div>
            </div>
            <p><strong>Périodicité :</strong> {rule.periodicity} | <strong>Échéance configurée :</strong> {dueLabel(rule.due_rule || {})}</p>
            <p><strong>Effet :</strong> {dateLabel(rule.effective_from)} au {dateLabel(rule.effective_to)}</p>
            <p><strong>Source :</strong> {rule.source_label || "Non renseignée"}{rule.source_url ? <> | <a href={rule.source_url} target="_blank" rel="noreferrer">Consulter la source</a></> : null}</p>
            {rule.notes ? <p><strong>Notes :</strong> {rule.notes}</p> : null}
            {canManage.data === true && rule.status === "draft" ? (
              <form action={validateRule} className="form">
                <input type="hidden" name="id" value={rule.id} />
                <button className="button primary">Valider cette règle</button>
              </form>
            ) : null}
            {canManage.data === true && rule.status !== "archived" ? (
              <form action={archiveRule} className="form">
                <input type="hidden" name="id" value={rule.id} />
                <button className="button">Archiver</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>

      {canManage.data === true ? (
        <section className="card section">
          <h2>Ajouter une règle</h2>
          <p>Commence en brouillon. Aucun organisme ni délai légal n'est prérempli automatiquement.</p>
          <form action={createDraft} className="form">
            <div className="grid2">
              <div className="field"><label htmlFor="organism_code">Code organisme</label><input id="organism_code" name="organism_code" placeholder="DGI_TVA, DGI_IRSA, DGI_IR ou DGI_IS" required /></div>
              <div className="field"><label htmlFor="label">Nom de la règle</label><input id="label" name="label" placeholder="Échéance déclarative mensuelle" required /></div>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor="periodicity">Périodicité</label><select id="periodicity" name="periodicity" defaultValue="monthly"><option value="monthly">Mensuelle</option><option value="quarterly">Trimestrielle</option><option value="annual">Annuelle</option><option value="one_off">Ponctuelle</option></select></div>
              <div className="field"><label htmlFor="due_type">Calcul d'échéance</label><select id="due_type" name="due_type" defaultValue="day_of_next_month"><option value="day_of_next_month">Jour du mois suivant la période</option><option value="day_of_month_after_quarter">Jour après le trimestre</option><option value="days_after_period_end">Nombre de jours après la période</option></select></div>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor="due_day">Jour d'échéance (1 à 31)</label><input id="due_day" type="number" name="due_day" min="1" max="31" defaultValue="15" /></div>
              <div className="field"><label htmlFor="days_after">Délai en jours (si choisi)</label><input id="days_after" type="number" name="days_after" min="0" max="366" defaultValue="0" /></div>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor="effective_from">Début d'effet</label><input id="effective_from" type="date" name="effective_from" required /></div>
              <div className="field"><label htmlFor="effective_to">Fin d'effet (facultatif)</label><input id="effective_to" type="date" name="effective_to" /></div>
            </div>
            <div className="field"><label htmlFor="source_label">Référence officielle consultée</label><input id="source_label" name="source_label" placeholder="Nom du texte, circulaire ou page officielle" /></div>
            <div className="field"><label htmlFor="source_url">Lien de la source (facultatif)</label><input id="source_url" name="source_url" type="url" placeholder="https://" /></div>
            <div className="field"><label htmlFor="notes">Notes de vérification</label><textarea id="notes" name="notes" rows={3} /></div>
            <button className="button primary">Enregistrer en brouillon</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
