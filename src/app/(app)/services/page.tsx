import Link from "next/link";
import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { createService, setServiceActive, updateService } from "@/server/actions/core";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { ServiceRecurrenceFields } from "@/components/service-recurrence-fields";

export default async function Services({ searchParams }: { searchParams: Promise<{ archive?: string }> }) {
  const params = await searchParams;
  const archived = params.archive === "1";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "sales.view");
  const { supabase, organizationId } = ctx;
  const [{ data = [] }, { data: org }] = await Promise.all([
    supabase.from("services").select("*").eq("organization_id", organizationId).eq("is_active", !archived).order("name"),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Services & prestations</h1>
          <p>Modifie le catalogue sans changer les valeurs déjà enregistrées sur les devis et factures existants.</p>
        </div>
        <div className="actions">
          <Link className="button" href={archived ? "/services" : "/services?archive=1"}>
            {archived ? "Voir les prestations actives" : "Voir les prestations archivées"}
          </Link>
        </div>
      </div>
      <div className="twoCols">
        <section>
          {!data.length ? (
            <EmptyState
              title={archived ? "Aucune prestation archivée" : "Aucune prestation"}
              description={archived ? "Les prestations supprimées de l'usage courant apparaîtront ici." : "Crée une prestation réelle avant de l'utiliser dans un devis."}
            />
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {data.map((s: any) => (
                <article className="card" key={s.id}>
                  <div className="pageHead" style={{ marginBottom: 8 }}>
                    <div>
                      <h2>{s.name}</h2>
                      <p className="muted">Code de service : <code>{s.magnisa_reference || "-"}</code> · {s.service_type === "recurring" ? "Récurrente" : "Ponctuelle"}{s.service_type === "recurring" && s.recurrence_frequency ? ` · ${({ monthly: "Mensuelle", quarterly: "Trimestrielle", semiannual: "Semestrielle", annual: "Annuelle" } as Record<string, string>)[s.recurrence_frequency] || s.recurrence_frequency}` : ""} · {s.unit} · Taxe {s.tax_rate}%</p>
                      <strong>{money(s.unit_price, org?.currency || "MGA")}</strong>
                    </div>
                    <span className="badge">{archived ? "Archivée" : "Active"}</span>
                  </div>
                  <details>
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>Modifier la prestation</summary>
                    <form action={updateService} className="form" style={{ marginTop: 12 }}>
                      <input type="hidden" name="id" value={s.id} />
                      <div className="field"><label>Nom</label><input name="name" defaultValue={s.name} required minLength={2} /></div>
                      <div className="field"><label>Description</label><textarea name="description" defaultValue={s.description || ""} /></div>
                      <ServiceRecurrenceFields defaultServiceType={s.service_type || "one_off"} defaultFrequency={s.recurrence_frequency || "monthly"} defaultCustomIntervalDays={s.custom_interval_days} />
                      <div className="field"><label>Unité</label><input name="unit" defaultValue={s.unit} required /></div>
                      <div className="field"><label>Prix unitaire</label><input name="unit_price" type="number" min="0" step="0.01" defaultValue={s.unit_price} required /></div>
                      <div className="field"><label>Taux de taxe (%)</label><input name="tax_rate" type="number" min="0" max="100" step="0.01" defaultValue={s.tax_rate} required /></div>
                      <button className="button primary">Enregistrer les modifications</button>
                    </form>
                  </details>
                  <form action={setServiceActive} className="actions" style={{ marginTop: 12 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="is_active" value={archived ? "true" : "false"} />
                    <button className="button" type="submit">
                      {archived ? "Réactiver" : "Supprimer / archiver"}
                    </button>
                  </form>
                  {!archived && <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>L'archivage masque la prestation des nouveaux usages. Les documents historiques sont conservés.</p>}
                </article>
              ))}
            </div>
          )}
        </section>
        {!archived && <section className="card">
          <h2>Nouvelle prestation</h2>
          <form action={createService} className="form">
            <div className="field"><label>Nom</label><input name="name" required minLength={2} /></div>
            <div className="field"><label>Description</label><textarea name="description" /></div>
            <ServiceRecurrenceFields />
            <div className="field"><label>Unité</label><input name="unit" defaultValue="forfait" required /></div>
            <div className="field"><label>Prix unitaire</label><input name="unit_price" type="number" min="0" step="0.01" required /></div>
            <div className="field"><label>Taux de taxe (%)</label><input name="tax_rate" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></div>
            <button className="button primary">Créer la prestation</button>
          </form>
        </section>}
      </div>
    </>
  );
}
