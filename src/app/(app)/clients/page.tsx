import Link from "next/link";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { createCustomer, setCustomerActive } from "@/server/actions/core";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  magnisa_reference: string | null;
  is_active: boolean;
};

export default async function Clients({
  searchParams,
}: {
  searchParams: Promise<{ archive?: string; q?: string }>;
}) {
  const params = await searchParams;
  const archived = params.archive === "1";
  const search = (params.q ?? "").trim().slice(0, 120);
  const ctx = await requireOrganization();
  await requirePermission(ctx, "billing.view");
  const canManageCustomers = await hasPermission(ctx, "customers.create");
  const { supabase, organizationId } = ctx;
  const { data, error } = await supabase
    .from("customers")
    .select("id,name,email,phone,created_at,magnisa_reference,is_active")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Impossible de charger le répertoire des clients.");

  const customers = (data ?? []) as CustomerRow[];
  const activeCount = customers.filter((customer) => customer.is_active).length;
  const archivedCount = customers.length - activeCount;
  const normalizedSearch = search.toLocaleLowerCase("fr");
  const visibleCustomers = customers.filter((customer) => {
    const inSelectedStatus = customer.is_active !== archived;
    const haystack = [customer.name, customer.email, customer.phone, customer.magnisa_reference]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("fr");
    return inSelectedStatus && (!normalizedSearch || haystack.includes(normalizedSearch));
  });

  const duplicateReasons = new Map<string, Set<string>>();
  const addDuplicate = (id: string, reason: string) => {
    const reasons = duplicateReasons.get(id) ?? new Set<string>();
    reasons.add(reason);
    duplicateReasons.set(id, reasons);
  };
  const indexDuplicates = (keyOf: (customer: CustomerRow) => string, label: string) => {
    const groups = new Map<string, CustomerRow[]>();
    for (const customer of customers) {
      const key = keyOf(customer);
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(customer);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (group.length > 1) for (const customer of group) addDuplicate(customer.id, label);
    }
  };
  indexDuplicates((customer) => (customer.email ?? "").trim().toLocaleLowerCase("fr"), "e-mail");
  indexDuplicates((customer) => (customer.phone ?? "").replace(/\D/g, ""), "téléphone");

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Clients</h1>
          <p>Gère les coordonnées et le cycle de vie des clients. L'archivage conserve les liens vers les devis, factures, paiements et rapports.</p>
        </div>
        <div className="actions">
          <Link className="button" href={archived ? "/clients" : "/clients?archive=1"}>
            {archived ? "Voir les clients actifs" : "Voir les clients archivés"}
          </Link>
          {!archived && canManageCustomers && (
            <FormDialog title="Nouveau client" buttonLabel="+ Nouveau client">
              <form action={createCustomer} className="form">
                <div className="field"><label>Nom / raison sociale</label><input name="name" required minLength={2} /></div>
                <div className="field"><label>E-mail</label><input name="email" type="email" /></div>
                <div className="field"><label>Téléphone</label><input name="phone" /></div>
                <div className="field"><label>Adresse</label><textarea name="address" /></div>
                <div className="field"><label>Identifiant fiscal</label><input name="tax_id" /></div>
                <button className="button primary">Créer le client</button>
              </form>
            </FormDialog>
          )}
        </div>
      </div>

      <div className="grid grid-3 section">
        <div className="card"><div className="muted">Clients actifs</div><strong className="metric">{activeCount}</strong></div>
        <div className="card"><div className="muted">Clients archivés</div><strong className="metric">{archivedCount}</strong></div>
        <div className="card"><div className="muted">Doublons potentiels</div><strong className="metric">{duplicateReasons.size}</strong></div>
      </div>

      <section className="section card">
        <form method="get" className="form">
          {archived && <input type="hidden" name="archive" value="1" />}
          <div className="grid grid-3">
            <div className="field">
              <label htmlFor="customer-search">Rechercher un client</label>
              <input id="customer-search" name="q" defaultValue={search} maxLength={120} placeholder="Nom, e-mail, téléphone ou référence" />
            </div>
            <div className="actions">
              <button className="button primary" type="submit">Rechercher</button>
              <Link className="button" href={archived ? "/clients?archive=1" : "/clients"}>Réinitialiser</Link>
            </div>
          </div>
          <p className="muted">{visibleCustomers.length} client(s) affiché(s) sur {archived ? archivedCount : activeCount}.</p>
        </form>
      </section>

      <div className="section">
        {!visibleCustomers.length ? (
          <EmptyState
            title={customers.length ? "Aucun résultat" : archived ? "Aucun client archivé" : "Aucun client"}
            description={customers.length ? "Aucun client ne correspond à cette recherche." : archived ? "Les clients archivés apparaîtront ici." : "La base est vide. Ajoute ton premier client réel."}
          />
        ) : (
          <div className="tableWrap"><table>
            <thead><tr><th>Référence MAGNISA</th><th>Client</th><th>E-mail</th><th>Téléphone</th><th>Statut</th><th>Contrôle</th><th>Action</th></tr></thead>
            <tbody>{visibleCustomers.map((customer) => {
              const duplicateLabels = [...(duplicateReasons.get(customer.id) ?? [])];
              return (
                <tr key={customer.id}>
                  <td><code>{customer.magnisa_reference || "—"}</code></td>
                  <td><Link href={`/clients/${customer.id}`}><b>{customer.name}</b></Link></td>
                  <td>{customer.email || "—"}</td>
                  <td>{customer.phone || "—"}</td>
                  <td>{customer.is_active ? "Actif" : "Archivé"}</td>
                  <td>{duplicateLabels.length ? <span className="badge">Doublon possible : {duplicateLabels.join(", ")}</span> : <span className="muted">Aucun doublon détecté</span>}</td>
                  <td>
                    {canManageCustomers ? (
                      <FormDialog title="Modifier le statut du client" buttonLabel="Modifier le statut">
                        <form action={setCustomerActive} className="actions">
                          <input type="hidden" name="id" value={customer.id} />
                          <input type="hidden" name="is_active" value={archived ? "true" : "false"} />
                          <button className="button" type="submit">{archived ? "Réactiver" : "Archiver"}</button>
                        </form>
                      </FormDialog>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
