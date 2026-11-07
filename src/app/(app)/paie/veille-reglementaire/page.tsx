import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, requirePermission } from "@/lib/permissions";

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

async function createHealthCeilingDraft(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payroll.manage");
  const rateRaw = String(fd.get("rate_percent") ?? "").trim();
  const ratePercent = Number(rateRaw);
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
    "irsa_minimum", "rounding_policy", "smie_partner_name", "smie_partner_contact",
    "smie_affiliation_number", "smie_contract_reference",
  ];
  const draft: Record<string, unknown> = {
    organization_id: ctx.organizationId,
    name: "IRSA santé - plafond " + ratePercent.toString() + " %",
    effective_from: effectiveFrom, effective_to: null, status: "pending_review",
    irsa_health_deduction_rate: ratePercent / 100,
    legal_reference: legalReference,
  };
  for (const field of fields) draft[field] = current[field];
  const { error: insertError } = await ctx.supabase.from("payroll_rule_sets").insert(draft);
  if (insertError) throw new Error(insertError.message);
  revalidatePath("/paie/parametres");
  revalidatePath("/paie/veille-reglementaire");
  redirect("/paie/veille-reglementaire?draft=created");
}

export default async function RegulatoryWatchPage({ searchParams }: { searchParams: Promise<{ updated?: string; draft?: string }> }) {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "payroll.view");
  const [{ data: settings }, { data: events, error: eventsError }, { data: rules, error: rulesError }, params] = await Promise.all([
    ctx.supabase.from("regulatory_watch_settings").select("enabled,updated_at").eq("organization_id", ctx.organizationId).maybeSingle(),
    ctx.supabase.from("regulatory_watch_events").select("id,source_title,source_url,detected_at,review_status").eq("organization_id", ctx.organizationId).order("detected_at", { ascending: false }).limit(30),
    ctx.supabase.from("payroll_rule_sets").select("id,name,effective_from,effective_to,status,irsa_health_deduction_rate").eq("organization_id", ctx.organizationId).order("effective_from", { ascending: false }).limit(20),
    searchParams,
  ]);
  if (eventsError) throw new Error(eventsError.message);
  if (rulesError) throw new Error(rulesError.message);
  const current = (rules || []).filter((r: any) => r.status === "validated" && r.effective_from <= new Date().toISOString().slice(0, 10) && (!r.effective_to || r.effective_to >= new Date().toISOString().slice(0, 10))).sort((a: any, b: any) => b.effective_from.localeCompare(a.effective_from))[0];
  const enabled = settings?.enabled ?? true;
  return <><div className="pageHead"><div><p className="eyebrow">Personnel & paie</p><h1>Veille réglementaire automatique</h1><p>Surveillance des publications officielles et gestion des plafonds IRSA par date d'effet.</p></div><Link className="button" href="/paie">Retour à la paie</Link></div>
    {params.updated && <div role="status" className="card section">Configuration de la veille enregistrée.</div>}
    {params.draft && <div role="status" className="card section">Nouvelle version créée en attente de vérification. Elle n'est pas encore appliquée.</div>}
    <section className="card section"><h2>État de la veille</h2><p><strong>{enabled ? "Surveillance activée" : "Surveillance désactivée"}</strong></p><p className="muted">Contrôle automatique quotidien des pages officielles. Toute modification de page déclenche une alerte, pas une modification automatique du droit applicable.</p>
      <form action={updateWatchSetting} className="form"><input type="hidden" name="enabled" value={enabled ? "false" : "true"}/><button className="button">{enabled ? "Désactiver la surveillance" : "Activer la surveillance"}</button></form>
      <p className="muted">La configuration est réservée au propriétaire, à l'administrateur ou au directeur.</p>
    </section>
    <section className="card section"><h2>Plafond de déduction santé IRSA</h2><p>Référentiel actuellement validé : <strong>{current ? (Number(current.irsa_health_deduction_rate) * 100).toLocaleString("fr-FR") + " %" : "Aucun référentiel actif"}</strong>{current ? " depuis le " + current.effective_from : ""}.</p>
      <p className="muted">Pour préparer une hausse à 3 % ou une baisse à 0,5 %, crée une nouvelle version datée. Le taux ne sera appliqué qu'après validation du texte officiel et activation du référentiel.</p>
      <form action={createHealthCeilingDraft} className="form"><div className="grid2">
        <div className="field"><label>Nouveau plafond (%)</label><input name="rate_percent" type="number" min="0" max="100" step="0.01" placeholder="Ex. 3 ou 0,5" required/></div>
        <div className="field"><label>Date d'entrée en vigueur</label><input name="effective_from" type="date" required/></div>
        <div className="field"><label>URL du texte officiel</label><input name="legal_reference" type="url" placeholder="https://..." required/></div>
      </div><button className="button primary">Créer une version à vérifier</button></form>
      <p className="muted">La version créée reste en attente. Pour l'examiner et l'activer, ouvre les <Link href="/paie/parametres">paramètres de paie</Link>. Aucun bulletin passé n'est recalculé.</p>
    </section>
    <section className="card section"><h2>Sources surveillées</h2><ul>
      <li><a href="https://www.impots.mg/explorer?path=%2Flegislation%2FCodes+et+Manuels" target="_blank" rel="noreferrer">DGI - Codes et manuels</a></li>
      <li><a href="https://cnlegis.gov.mg/" target="_blank" rel="noreferrer">CNLegis - textes législatifs</a></li>
      <li><a href="https://www.cnaps.mg/historique-sme" target="_blank" rel="noreferrer">CNaPS - Historique SME</a></li>
      <li><a href="https://www.fmfp.mg/fondement-legal/" target="_blank" rel="noreferrer">FMFP - Fondement légal</a></li>
    </ul><p className="muted">La surveillance compare l'empreinte du contenu des pages. Une mise en page, une actualité ou une correction éditoriale peut aussi déclencher une alerte. Une personne habilitée doit lire le texte et confirmer sa portée juridique.</p></section>
    <section className="card section"><h2>Historique des détections</h2>{!events?.length ? <p className="muted">Aucun changement de contenu détecté depuis l'activation de la veille.</p> : <div className="tableWrap"><table><thead><tr><th>Source</th><th>Date de détection</th><th>État</th><th>Lien officiel</th></tr></thead><tbody>{events.map((event: any) => <tr key={event.id}><td>{event.source_title}</td><td>{new Date(event.detected_at).toLocaleString("fr-FR")}</td><td>{event.review_status === "unreviewed" ? "À vérifier" : event.review_status}</td><td><a href={event.source_url} target="_blank" rel="noreferrer">Consulter</a></td></tr>)}</tbody></table></div>}</section>
  </>;
}
