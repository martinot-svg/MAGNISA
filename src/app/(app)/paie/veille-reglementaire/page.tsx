import { formatDateTimeDisplay } from "@/lib/date-format";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

const SOURCES = [
  { key: "dgi-legislation", title: "DGI - Textes et législation", url: "https://portal.impots.mg/textes/", additionalUrls: ["https://www.impots.mg/explorer?langue=2&path=%2Flegislation"] },
  { key: "cnlegis", title: "CNLegis - Textes législatifs", url: "https://cnlegis.gov.mg/", additionalUrls: [] },
  { key: "cnaps-sme", title: "CNaPS - SME, actualités et documentation", url: "https://www.cnaps.mg/historique-sme", additionalUrls: ["https://www.cnaps.mg/actualites", "https://www.cnaps.mg/documents/documentation"] },
  { key: "fmfp-legal", title: "FMFP - Fondement légal", url: "https://www.fmfp.mg/fondement-legal/", additionalUrls: [] },
] as const;

async function updateWatchSetting(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  if (!["owner", "admin", "director"].includes(ctx.role)) throw new Error("Seuls le propriétaire, l'administrateur ou le directeur peuvent configurer la veille.");
  const enabled = String(fd.get("enabled") || "") === "true";
  const { error } = await ctx.supabase.from("regulatory_watch_settings").upsert({
    organization_id: ctx.organizationId, enabled, updated_by: ctx.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/paie/veille-reglementaire");
  redirect("/paie/veille-reglementaire?updated=1");
}

async function updateSourceSetting(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  if (!["owner", "admin", "director"].includes(ctx.role)) throw new Error("Droits insuffisants pour configurer les sources.");
  const sourceKey = String(fd.get("source_key") || "");
  if (!SOURCES.some(source => source.key === sourceKey)) throw new Error("Source réglementaire inconnue.");
  const enabled = String(fd.get("enabled") || "") === "true";
  const { error } = await ctx.supabase.from("regulatory_watch_source_settings").upsert({
    organization_id: ctx.organizationId, source_key: sourceKey, enabled,
    updated_by: ctx.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,source_key" });
  if (error) throw new Error(error.message);
  revalidatePath("/paie/veille-reglementaire");
  redirect("/paie/veille-reglementaire?source_updated=1");
}

async function reviewRegulatoryEvent(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payroll.manage");
  const eventId = String(fd.get("event_id") || "");
  const status = String(fd.get("review_status") || "");
  const note = String(fd.get("review_note") || "").trim();
  if (!eventId || !["reviewed", "validated", "not_relevant"].includes(status)) throw new Error("Décision de revue invalide.");
  if (note.length > 1000) throw new Error("La note de revue est trop longue.");
  if (status === "validated" && note.length < 20) throw new Error("Pour valider un changement réglementaire, indique une justification d’au moins 20 caractères.");
  const admin = createAdminClient();
  const { data, error } = await admin.from("regulatory_watch_events").update({
    review_status: status, reviewed_by: ctx.user.id, reviewed_at: new Date().toISOString(), review_note: note || null,
  }).eq("id", eventId).eq("organization_id", ctx.organizationId).eq("review_status", "unreviewed")
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Cette alerte a déjà été traitée ou n'existe pas.");
  revalidatePath("/paie/veille-reglementaire");
  redirect("/paie/veille-reglementaire?reviewed=1");
}

async function createHealthCeilingDraft(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payroll.manage");
  const rateRaw = String(fd.get("rate_percent") ?? "").trim();
  const ratePercent = Number(rateRaw.replace(",", "."));
  const effectiveFrom = String(fd.get("effective_from") || "");
  const legalReference = String(fd.get("legal_reference") || "").trim();
  if (!rateRaw || !Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) throw new Error("Le taux doit être compris entre 0 et 100 %.");
  let sourceUrl: URL;
  try { sourceUrl = new URL(legalReference); } catch { throw new Error("URL officielle invalide."); }
  const host = sourceUrl.hostname.toLowerCase();
  const officialHost = host === "gov.mg" || host.endsWith(".gov.mg") || host === "impots.mg" || host.endsWith(".impots.mg") || host === "cnaps.mg" || host.endsWith(".cnaps.mg") || host === "fmfp.mg" || host.endsWith(".fmfp.mg");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || sourceUrl.protocol !== "https:" || !officialHost) throw new Error("La date ou le domaine de la source officielle est invalide.");

  const { data: rules, error } = await ctx.supabase.from("payroll_rule_sets").select("*")
    .eq("organization_id", ctx.organizationId).eq("status", "validated")
    .lte("effective_from", effectiveFrom).order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);
  const active = (rules || []).filter((row: any) => !row.effective_to || row.effective_to >= effectiveFrom);
  if (active.length !== 1) throw new Error("Un seul référentiel validé doit couvrir la date d'effet choisie.");
  const current = active[0];
  if (effectiveFrom <= current.effective_from) throw new Error("La nouvelle date doit être postérieure au début du référentiel actuel.");

  const fields = [
    "cnaps_employee_rate", "cnaps_employer_rate", "health_employee_rate", "health_employer_rate",
    "fmfp_employer_rate", "cnaps_monthly_ceiling", "health_monthly_ceiling", "irsa_brackets",
    "irsa_minimum", "irsa_dependant_reduction", "irsa_dependant_threshold", "rounding_policy", "smie_partner_name", "smie_partner_contact",
    "smie_affiliation_number", "smie_contract_reference",
  ];
  const draft: Record<string, unknown> = {
    organization_id: ctx.organizationId, name: "IRSA santé - plafond " + ratePercent.toString() + " %",
    effective_from: effectiveFrom, effective_to: null, status: "pending_review",
    irsa_health_deduction_rate: ratePercent / 100, legal_reference: legalReference,
  };
  for (const field of fields) draft[field] = current[field];
  const { error: insertError } = await ctx.supabase.from("payroll_rule_sets").insert(draft);
  if (insertError) throw new Error(insertError.message);
  revalidatePath("/paie/parametres");
  revalidatePath("/paie/veille-reglementaire");
  redirect("/paie/veille-reglementaire?draft=created");
}

function dateTime(value?: string | null) {
  return value ? formatDateTimeDisplay(value) : "Jamais";
}

export default async function RegulatoryWatchPage({ searchParams }: { searchParams: Promise<{ updated?: string; draft?: string; source_updated?: string; reviewed?: string }> }) {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "payroll.view");
  const [{ data: settings }, { data: sourceSettings, error: sourceError }, { data: events, error: eventsError },
    { data: rules, error: rulesError }, { data: runs, error: runsError }, params] = await Promise.all([
    ctx.supabase.from("regulatory_watch_settings").select("enabled,updated_at").eq("organization_id", ctx.organizationId).maybeSingle(),
    ctx.supabase.from("regulatory_watch_source_settings").select("source_key,enabled,last_attempt_at,last_success_at,last_http_status,last_error").eq("organization_id", ctx.organizationId),
    ctx.supabase.from("regulatory_watch_events").select("id,source_title,source_url,source_final_url,detected_at,review_status,previous_excerpt,current_excerpt,review_note,reviewed_at").eq("organization_id", ctx.organizationId).order("detected_at", { ascending: false }).limit(30),
    ctx.supabase.from("payroll_rule_sets").select("id,name,effective_from,effective_to,status,irsa_health_deduction_rate").eq("organization_id", ctx.organizationId).order("effective_from", { ascending: false }).limit(20),
    ctx.supabase.from("regulatory_watch_runs").select("id,started_at,finished_at,status,sources_checked,changes_detected,errors").eq("organization_id", ctx.organizationId).order("started_at", { ascending: false }).limit(10),
    searchParams,
  ]);
  if (sourceError) throw new Error(sourceError.message);
  if (eventsError) throw new Error(eventsError.message);
  if (rulesError) throw new Error(rulesError.message);
  if (runsError) throw new Error(runsError.message);
  const current = (rules || []).filter((r: any) => r.status === "validated" && r.effective_from <= new Date().toISOString().slice(0, 10) && (!r.effective_to || r.effective_to >= new Date().toISOString().slice(0, 10))).sort((a: any, b: any) => b.effective_from.localeCompare(a.effective_from))[0];
  const enabled = settings?.enabled ?? true;
  const sourceMap = new Map((sourceSettings || []).map((row: any) => [row.source_key, row]));

  return <>
    <div className="pageHead"><div><p className="eyebrow">Personnel & paie</p><h1>Veille réglementaire automatique</h1><p>Surveillance des publications officielles et gestion des plafonds IRSA par date d'effet.</p></div><Link className="button" href="/paie">Retour à la paie</Link></div>
    {params.updated && <div role="status" className="card section">Configuration générale enregistrée.</div>}
    {params.source_updated && <div role="status" className="card section">Configuration de la source enregistrée.</div>}
    {params.reviewed && <div role="status" className="card section">Décision de revue enregistrée.</div>}
    {params.draft && <div role="status" className="card section">Nouvelle version créée en attente de vérification. Elle n'est pas encore appliquée.</div>}

    <section className="card section">
      <h2>État général de la surveillance</h2>
      <p><strong>{enabled ? "Surveillance activée" : "Surveillance désactivée"}</strong></p>
      <p className="muted">Le contrôle automatique est programmé chaque jour à 08 h 15, heure de Madagascar. La désactivation générale arrête les consultations de toutes les sources pour cette organisation.</p>
      <form action={updateWatchSetting} className="form">
        <input type="hidden" name="enabled" value={enabled ? "false" : "true"}/>
        <button className="button">{enabled ? "Désactiver la surveillance" : "Activer la surveillance"}</button>
      </form>
      <p className="muted">Configuration réservée au propriétaire, à l'administrateur ou au directeur.</p>
    </section>

    <section className="card section">
      <h2>Surveillance par source officielle</h2>
      <p className="muted">Chaque source peut être suspendue indépendamment. Les contrôles ne sont exécutés que si la surveillance générale et la source sont activées.</p>
      <div className="tableWrap"><table><thead><tr><th>Source</th><th>État</th><th>Dernière tentative</th><th>Dernier succès</th><th>Résultat</th><th>Action</th></tr></thead><tbody>
        {SOURCES.map(source => {
          const row: any = sourceMap.get(source.key);
          const sourceEnabled = row?.enabled ?? true;
          return <tr key={source.key}>
            <td>{[source.url, ...source.additionalUrls].map((url, index) => <span key={url}>{index > 0 ? " · " : ""}<a href={url} target="_blank" rel="noreferrer">{index === 0 ? source.title : "Autre page officielle"}</a></span>)}</td>
            <td>{sourceEnabled ? "Activée" : "Désactivée"}</td>
            <td>{dateTime(row?.last_attempt_at)}</td>
            <td>{dateTime(row?.last_success_at)}</td>
            <td>{row?.last_error ? <span className="errorText">{row.last_error}</span> : row?.last_http_status ? "HTTP " + row.last_http_status : "Pas encore contrôlée"}</td>
            <td><form action={updateSourceSetting}><input type="hidden" name="source_key" value={source.key}/><input type="hidden" name="enabled" value={sourceEnabled ? "false" : "true"}/><button className="button">{sourceEnabled ? "Désactiver" : "Activer"}</button></form></td>
          </tr>;
        })}
      </tbody></table></div>
    </section>

    <section className="card section">
      <h2>Plafond de déduction santé IRSA</h2>
      <p>Référentiel actuellement validé : <strong>{current ? (Number(current.irsa_health_deduction_rate) * 100).toLocaleString("fr-FR") + " %" : "Aucun référentiel actif"}</strong>{current ? " depuis le " + current.effective_from : ""}.</p>
      <p className="muted">Pour préparer une hausse à 3 % ou une baisse à 0,5 %, crée une nouvelle version datée. Elle ne sera appliquée qu'après examen du texte officiel et validation du référentiel.</p>
      <form action={createHealthCeilingDraft} className="form"><div className="grid2">
        <div className="field"><label>Nouveau plafond (%)</label><input name="rate_percent" type="number" min="0" max="100" step="0.01" placeholder="Ex. 3 ou 0,5" required/></div>
        <div className="field"><label>Date d'entrée en vigueur</label><input name="effective_from" type="date" required/></div>
        <div className="field"><label>URL du texte officiel</label><input name="legal_reference" type="url" placeholder="https://..." required/></div>
      </div><button className="button primary">Créer une version à vérifier</button></form>
      <p className="muted">La version reste en attente. Pour l'examiner et l'activer, ouvre les <Link href="/paie/parametres">paramètres de paie</Link>. Aucun bulletin passé n'est recalculé.</p>
    </section>

    <section className="card section">
      <h2>Historique des exécutions</h2>
      {!runs?.length ? <p className="muted">Aucune exécution enregistrée à ce jour.</p> : <div className="tableWrap"><table><thead><tr><th>Démarrage</th><th>Fin</th><th>État</th><th>Sources contrôlées</th><th>Changements</th><th>Erreurs</th></tr></thead><tbody>
        {runs.map((run: any) => <tr key={run.id}><td>{dateTime(run.started_at)}</td><td>{dateTime(run.finished_at)}</td><td>{run.status}</td><td>{run.sources_checked}</td><td>{run.changes_detected}</td><td>{Array.isArray(run.errors) ? run.errors.length : 0}</td></tr>)}
      </tbody></table></div>}
    </section>

    <section className="card section">
      <h2>Historique des changements détectés</h2>
      {!events?.length ? <p className="muted">Aucun changement de contenu détecté depuis l'activation de la veille.</p> : <div className="tableWrap"><table><thead><tr><th>Source et date</th><th>État</th><th>Comparaison</th><th>Décision humaine</th></tr></thead><tbody>
        {events.map((event: any) => <tr key={event.id}>
          <td><a href={event.source_final_url || event.source_url} target="_blank" rel="noreferrer">{event.source_title}</a><br/><span className="muted">{dateTime(event.detected_at)}</span></td>
          <td>{event.review_status === "unreviewed" ? "À vérifier" : event.review_status === "reviewed" ? "Examiné" : event.review_status === "validated" ? "Changement confirmé" : "Non pertinent"}</td>
          <td><details><summary>Afficher l'extrait détecté</summary><p><strong>Avant</strong></p><pre className="muted" style={{ whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto" }}>{event.previous_excerpt || "Aucun extrait initial disponible"}</pre><p><strong>Après</strong></p><pre className="muted" style={{ whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto" }}>{event.current_excerpt || "Aucun extrait disponible"}</pre></details></td>
          <td>{event.review_status === "unreviewed" ? <form action={reviewRegulatoryEvent} className="form"><input type="hidden" name="event_id" value={event.id}/><div className="field"><label>Note de vérification</label><textarea name="review_note" maxLength={1000} rows={2}/></div><button className="button" name="review_status" value="reviewed">Marquer examiné</button><button className="button primary" name="review_status" value="validated">Valider le changement réglementaire</button><button className="button" name="review_status" value="not_relevant">Classer non pertinent</button></form> : <span className="muted">{event.review_note || "Décision enregistrée le " + dateTime(event.reviewed_at)}</span>}</td>
        </tr>)}
      </tbody></table></div>}
      <p className="muted">Une validation réglementaire exige une justification écrite et confirme la portée juridique de l’alerte. Elle ne modifie jamais automatiquement les paramètres de paie : un nouveau référentiel doit ensuite être préparé, vérifié et activé séparément.</p>
    </section>
  </>;
}
