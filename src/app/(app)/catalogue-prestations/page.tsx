import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { money } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";

const FREQUENCIES: Record<string, string> = {
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  semiannual: "Semestrielle",
  annual: "Annuelle",
};

export default async function ServiceCataloguePage() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "sales.view");
  const { data: services = [], error } = await ctx.supabase
    .from("services")
    .select("id,name,description,unit,unit_price,tax_rate,service_type,recurrence_frequency,custom_interval_days,magnisa_reference")
    .eq("organization_id", ctx.organizationId)
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error("Impossible de charger le catalogue de prestations.");

  const { data: organization } = await ctx.supabase
    .from("organizations")
    .select("currency")
    .eq("id", ctx.organizationId)
    .single();
  const currency = organization?.currency || "MGA";

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Catalogue de prestations</h1>
          <p>Les prestations actives de ton entreprise, avec unités, tarifs, taxes et périodicités. Les documents déjà créés conservent leurs valeurs historiques.</p>
        <p className="muted"><strong>{services.length}</strong> prestation{services.length > 1 ? "s" : ""} active{services.length > 1 ? "s" : ""}</p>
      </div>
      <div className="actions">
        <Link className="button primary" href="/services">Gérer le catalogue / ajouter une prestation</Link>
        <Link className="button" href="/devis">Créer un devis</Link>
      </div>
      </div>
      <section className="section">
        {!services.length ? (
          <EmptyState title="Le catalogue est vide" description="Ajoute ta première prestation pour la retrouver ici et l'utiliser dans tes ventes." />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {services.map((service: any) => {
              const frequency = service.recurrence_frequency === "custom"
                ? `Tous les ${service.custom_interval_days || 30} jours`
                : FREQUENCIES[service.recurrence_frequency] || service.recurrence_frequency;
              return (
                <article className="card" key={service.id}>
                  <div className="pageHead" style={{ marginBottom: 0 }}>
                    <div>
                      <h2>{service.name}</h2>
                      {service.description ? <p>{service.description}</p> : null}
                      <p className="muted">
                        <code>{service.magnisa_reference || "—"}</code> · {service.service_type === "recurring" ? `Récurrente · ${frequency}` : "Ponctuelle"} · Unité : {service.unit} · TVA : {Number(service.tax_rate || 0)}%
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong>{money(Number(service.unit_price), currency)}</strong>
                      <p className="muted">Prix unitaire</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
