import Link from "next/link";
import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { setServiceActive } from "@/server/actions/core";
import {
  createCatalogCategory,
  createCatalogService,
  updateCatalogService,
} from "@/server/actions/service-catalog";
import { BILLING_UNITS } from "@/lib/magnisa-next/billing-units";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { ServiceRecurrenceFields } from "@/components/service-recurrence-fields";
import { FormDialog } from "@/components/form-dialog";

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  yearly: "Annuelle",
};

export default async function ServiceCatalogPage() {
  await requirePermission("catalog:read");
  const { organization, prisma } = await requireOrganization();

  const [categories, services] = await Promise.all([
    prisma.catalogCategory.findMany({
      where: { organizationId: organization.id },
      orderBy: { name: "asc" },
    }),
    prisma.catalogService.findMany({
      where: { organizationId: organization.id },
      orderBy: { name: "asc" },
      include: { category: true },
    }),
  ]);

  const categoriesById = new Map(categories.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Catalogue de services</h1>
          <p className="text-sm text-muted-foreground">
            Gérez vos catégories et services facturables.
          </p>
        </div>
        <div className="flex gap-2">
          <FormDialog
            title="Nouvelle catégorie"
            triggerLabel="Ajouter une catégorie"
            action={createCatalogCategory}
          >
            <div className="space-y-3">
              <label className="block text-sm font-medium" htmlFor="cat-name">
                Nom de la catégorie
              </label>
              <input
                id="cat-name"
                name="name"
                required
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </FormDialog>

          <FormDialog
            title="Nouveau service"
            triggerLabel="Ajouter un service"
            action={createCatalogService}
          >
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium" htmlFor="svc-name">
                  Nom du service
                </label>
                <input
                  id="svc-name"
                  name="name"
                  required
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium" htmlFor="svc-category">
                  Catégorie
                </label>
                <select
                  id="svc-category"
                  name="categoryId"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">— Aucune —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium" htmlFor="svc-price">
                  Prix unitaire
                </label>
                <input
                  id="svc-price"
                  name="unitPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium" htmlFor="svc-billing-unit">
                  Unité de facturation
                </label>
                <select
                  id="svc-billing-unit"
                  name="billingUnit"
                  required
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {BILLING_UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </div>

              <ServiceRecurrenceFields />
            </div>
          </FormDialog>
        </div>
      </header>

      {services.length === 0 ? (
        <EmptyState
          title="Aucun service pour le moment"
          description="Commencez par créer une catégorie puis ajoutez vos premiers services."
        />
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Service</th>
                <th className="px-4 py-2 font-medium">Catégorie</th>
                <th className="px-4 py-2 font-medium">Prix</th>
                <th className="px-4 py-2 font-medium">Unité</th>
                <th className="px-4 py-2 font-medium">Récurrence</th>
                <th className="px-4 py-2 font-medium">Statut</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{service.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {service.category?.name ?? "—"}
                  </td>
                  <td className="px-4 py-2">{money(service.unitPrice)}</td>
                  <td className="px-4 py-2">
                    {BILLING_UNITS.find((u) => u.value === service.billingUnit)?.label ??
                      service.billingUnit}
                  </td>
                  <td className="px-4 py-2">
                    {service.recurrenceFrequency
                      ? FREQUENCY_LABELS[service.recurrenceFrequency] ??
                        service.recurrenceFrequency
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        service.isActive
                          ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800"
                          : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                      }
                    >
                      {service.isActive ? "Actif" : "Inactif"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <FormDialog
                        title={`Modifier ${service.name}`}
                        triggerLabel="Modifier"
                        variant="ghost"
                        action={updateCatalogService.bind(null, service.id)}
                      >
                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm font-medium" htmlFor={`svc-name-${service.id}`}>
                              Nom
                            </label>
                            <input
                              id={`svc-name-${service.id}`}
                              name="name"
                              defaultValue={service.name}
                              required
                              className="w-full rounded-md border px-3 py-2 text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium" htmlFor={`svc-category-${service.id}`}>
                              Catégorie
                            </label>
                            <select
                              id={`svc-category-${service.id}`}
                              name="categoryId"
                              defaultValue={service.categoryId ?? ""}
                              className="w-full rounded-md border px-3 py-2 text-sm"
                            >
                              <option value="">— Aucune —</option>
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium" htmlFor={`svc-price-${service.id}`}>
                              Prix unitaire
                            </label>
                            <input
                              id={`svc-price-${service.id}`}
                              name="unitPrice"
                              type="number"
                              step="0.01"
                              min="0"
                              defaultValue={Number(service.unitPrice)}
                              required
                              className="w-full rounded-md border px-3 py-2 text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium" htmlFor={`svc-billing-unit-${service.id}`}>
                              Unité de facturation
                            </label>
                            <select
                              id={`svc-billing-unit-${service.id}`}
                              name="billingUnit"
                              defaultValue={service.billingUnit}
                              required
                              className="w-full rounded-md border px-3 py-2 text-sm"
                            >
                              {BILLING_UNITS.map((unit) => (
                                <option key={unit.value} value={unit.value}>
                                  {unit.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <ServiceRecurrenceFields
                            defaultFrequency={service.recurrenceFrequency ?? undefined}
                            defaultInterval={service.recurrenceInterval ?? undefined}
                          />
                        </div>
                      </FormDialog>

                      <form action={setServiceActive.bind(null, service.id, !service.isActive)}>
                        <button
                          type="submit"
                          className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        >
                          {service.isActive ? "Désactiver" : "Activer"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {categories.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Catégories</h2>
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const count = services.filter((s) => s.categoryId === c.id).length;
              return (
                <li
                  key={c.id}
                  className="rounded-full border px-3 py-1 text-sm text-muted-foreground"
                >
                  {c.name} <span className="text-xs">({count})</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}