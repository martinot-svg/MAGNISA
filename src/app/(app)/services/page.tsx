import Link from "next/link";
import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import {
  setServiceActive,
} from "@/server/actions/core";
import { createCatalogCategory, createCatalogService, updateCatalogService } from "@/server/actions/service-catalog";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { ServiceRecurrenceFields } from "@/components/service-recurrence-fields";
import { FormDialog } from "@/components/form-dialog";
import { BILLING_UNITS } from "@/lib/magnisa-next/billing-units";

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  semiannual: "Semestrielle",
  annual: "Annuelle",
};

export default async function Services({
  searchParams,
}: {
  searchParams: Promise<{ archive?: string; nouveau?: string }>;
}) {
  const params = await searchParams;
  const archived = params.archive === "1";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "sales.view");
  const { supabase, organizationId } = ctx;

  const [{ data = [] }, { data: org }, { data: categories = [] }] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("is_active", !archived)
      .order("name"),
    supabase
      .from("organizations")
      .select("currency")
      .eq("id", organizationId)
      .single(),
    supabase.from("service_categories").select("id,name").eq("organization_id",organizationId).eq("is_active",true).order("name"),
  ]);

  const currency = org?.currency || "MGA";
  const categoryNames = new Map((categories as any[]).map((category) => [category.id, category.name]));
  const serviceIds = data.map((service: any) => service.id);
  const { data: priceVersions = [] } = serviceIds.length
    ? await supabase.from("service_price_versions")
        .select("id,service_id,unit,unit_price,tax_rate,effective_from,effective_until")
        .eq("organization_id", organizationId).in("service_id", serviceIds)
        .order("effective_from", { ascending: false })
        .limit(Math.min(serviceIds.length * 10, 1000))
    : { data: [] };
  const pricesByService = new Map<string, any[]>();
  for (const version of priceVersions as any[]) {
    const list = pricesByService.get(version.service_id) ?? [];
    if (list.length < 5) list.push(version);
    pricesByService.set(version.service_id, list);
  }

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Services &amp; prestations</h1>
          <p>
            Modifie le catalogue sans changer les valeurs déjà enregistrées sur
            les devis et factures existants.
          </p>
        </div>
        <div className="actions">
          <Link
            className="button"
            href={archived ? "/services" : "/services?archive=1"}
          >
            {archived
              ? "Voir les prestations actives"
              : "Voir les prestations archivées"}
          </Link>
          {!archived && (
            <>
            <FormDialog title="Nouvelle catégorie" buttonLabel="+ Catégorie">
              <form action={createCatalogCategory} className="form">
                <div className="field"><label>Nom de la catégorie</label><input name="name" required minLength={2} maxLength={120} /></div>
                <div className="field"><label>Description</label><textarea name="description" maxLength={2000} /></div>
                <button className="button primary" type="submit">Créer la catégorie</button>
              </form>
            </FormDialog>
            <FormDialog
              title="Nouvelle prestation"
              buttonLabel="+ Nouvelle prestation"
            >
              <form action={createCatalogService} className="form">
                <div className="field">
                  <label>Nom</label>
                  <input name="name" required minLength={2} />
                </div>
                <div className="field">
                  <label>Description</label>
                  <textarea name="description" />
                </div>
                <div className="field"><label>Catégorie</label><select name="category_id" defaultValue=""><option value="">— Aucune —</option>{categories.map((cat:any)=><option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></div>
                <ServiceRecurrenceFields />
                <div className="field">
                  <label>Unité</label>
                  <select name="unit" defaultValue="forfait" required>
                    {BILLING_UNITS.map((unit) => (
                      <option key={unit.value} value={unit.value}>{unit.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Prix unitaire</label>
                  <input
                    name="unit_price"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div className="field">
                  <label>Taux de taxe (%)</label>
                  <input
                    name="tax_rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue="0"
                    required
                  />
                </div>
                <button className="button primary" type="submit">
                  Créer la prestation
                </button>
              </form>
            </FormDialog>
            </>
          )}
        </div>
      </div>

      <div className="section">
        {!data.length ? (
          <EmptyState
            title={
              archived ? "Aucune prestation archivée" : "Aucune prestation"
            }
            description={
              archived
                ? "Les prestations supprimées de l'usage courant apparaîtront ici."
                : "Crée une prestation réelle avant de l'utiliser dans un devis."
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {data.map((s: any) => {
              const freqLabel =
                s.recurrence_frequency === "custom"
                  ? `Tous les ${s.custom_interval_days || 30} jours`
                  : FREQUENCY_LABELS[s.recurrence_frequency] ||
                    s.recurrence_frequency;

              return (
                <article className="card" key={s.id}>
                  <div className="pageHead" style={{ marginBottom: 8 }}>
                    <div>
                      <h2>{s.name}</h2>
                      <p className="muted">
                        <code>{s.magnisa_reference || "-"}</code> Code service · {categoryNames.get(s.category_id) ? `Catégorie : ${categoryNames.get(s.category_id)} · ` : ""}{" "}
                        {s.service_type === "recurring"
                          ? "Récurrente"
                          : "Ponctuelle"}
                        {s.service_type === "recurring" &&
                        s.recurrence_frequency
                          ? ` · ${freqLabel}`
                          : ""}{" "}
                        · {s.unit} · Taxe {s.tax_rate}%
                      </p>
                      <strong>{money(Number(s.unit_price), currency)}</strong>
                    </div>
                    <span className="badge">
                      {archived ? "Archivée" : "Active"}
                    </span>
                  </div>

                  <details>
                    <summary
                      style={{ cursor: "pointer", fontWeight: 600 }}
                    >
                      Modifier la prestation
                    </summary>
                    <FormDialog title="Modifier une prestation" buttonLabel="Modifier la prestation"><form
                      action={updateCatalogService}
                      className="form"
                      style={{ marginTop: 12 }}
                    >
                      <input type="hidden" name="id" value={s.id} />
                      <div className="field">
                        <label>Nom</label>
                        <input
                          name="name"
                          defaultValue={s.name}
                          required
                          minLength={2}
                        />
                      </div>
                      <div className="field">
                        <label>Description</label>
                        <textarea
                          name="description"
                          defaultValue={s.description || ""}
                        />
                      </div>
                      <div className="field"><label>Catégorie</label><select name="category_id" defaultValue={s.category_id || ""}><option value="">— Aucune —</option>{categories.map((cat:any)=><option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></div>
                      <ServiceRecurrenceFields
                        defaultServiceType={s.service_type || "one_off"}
                        defaultFrequency={s.recurrence_frequency || "monthly"}
                        defaultCustomIntervalDays={s.custom_interval_days}
                      />
                      <div className="field">
                        <label>Unité</label>
                        <select name="unit" defaultValue={s.unit} required>
                          {!BILLING_UNITS.some((unit) => unit.value === s.unit) && (
                            <option value={s.unit}>{s.unit} (ancienne unité — sélectionne une unité normalisée)</option>
                          )}
                          {BILLING_UNITS.map((unit) => (
                            <option key={unit.value} value={unit.value}>{unit.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Prix unitaire</label>
                        <input
                          name="unit_price"
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={s.unit_price}
                          required
                        />
                      </div>
                      <div className="field">
                        <label>Taux de taxe (%)</label>
                        <input
                          name="tax_rate"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          defaultValue={s.tax_rate}
                          required
                        />
                      </div>
                      <button className="button primary" type="submit">
                        Enregistrer les modifications
                      </button>
                    </form></FormDialog>
                  </details>

                  <FormDialog title="Modifier le statut de la prestation" buttonLabel="Modifier le statut"><form
                    action={setServiceActive}
                    className="actions"
                    style={{ marginTop: 12 }}
                  >
                    <input type="hidden" name="id" value={s.id} />
                    <input
                      type="hidden"
                      name="is_active"
                      value={archived ? "true" : "false"}
                    />
                    <button className="button" type="submit">
                      {archived ? "Réactiver" : "Supprimer / archiver"}
                    </button>
                  </form></FormDialog>
                  <details className="section">
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>Historique des tarifs</summary>
                    <div className="tableWrap" style={{ marginTop: 8 }}>
                      <table><thead><tr><th>Tarif</th><th>Unité</th><th>Taxe</th><th>Début d’effet</th><th>Fin d’effet</th></tr></thead>
                        <tbody>{(pricesByService.get(s.id) ?? []).map((version: any) => (
                          <tr key={version.id}>
                            <td>{money(Number(version.unit_price), currency)}</td>
                            <td>{BILLING_UNITS.find((unit) => unit.value === version.unit)?.label ?? version.unit}</td>
                            <td>{version.tax_rate}%</td>
                            <td>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.effective_from))}</td>
                            <td>{version.effective_until ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.effective_until)) : "Tarif actuel"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    {(pricesByService.get(s.id) ?? []).length === 0 && <p className="muted">Aucun historique de tarif disponible.</p>}
                  </details>
                  {!archived && (
                    <p
                      className="muted"
                      style={{ fontSize: 12, marginBottom: 0 }}
                    >
                      L'archivage masque la prestation des nouveaux usages. Les
                      documents historiques sont conservés.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}