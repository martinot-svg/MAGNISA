import Link from "next/link";
import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { createCustomer, setCustomerActive } from "@/server/actions/core";
import { EmptyState } from "@/components/empty-state";

export default async function Clients({ searchParams }: { searchParams: Promise<{ archive?: string }> }) {
  const params = await searchParams;
  const archived = params.archive === "1";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "billing.view");
  const { supabase, organizationId } = ctx;
  const { data = [] } = await supabase
    .from("customers")
    .select("id,name,email,phone,created_at,magnisa_reference")
    .eq("organization_id", organizationId)
    .eq("is_active", !archived)
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Clients</h1>
          <p>Gère les coordonnées de tes clients. L'archivage conserve les liens vers les devis, factures, paiements et rapports.</p>
        </div>
        <div className="actions">
          <Link className="button" href={archived ? "/clients" : "/clients?archive=1"}>
            {archived ? "Voir les clients actifs" : "Voir les clients archivés"}
          </Link>
        </div>
      </div>
      <div className="twoCols">
        <section>
          {!data.length ? (
            <EmptyState
              title={archived ? "Aucun client archivé" : "Aucun client"}
              description={archived ? "Les clients archivés apparaîtront ici." : "La base est vide. Ajoute ton premier client réel."}
            />
          ) : (
            <div className="tableWrap">
              <table>
                <thead><tr><th>Référence MAGNISA</th><th>Client</th><th>E-mail</th><th>Téléphone</th><th>Statut</th><th>Action</th></tr></thead>
                <tbody>
                  {data.map((c: any) => (
                    <tr key={c.id}>
                      <td><code>{c.magnisa_reference || "-"}</code></td><td><Link href={`/clients/${c.id}`}><b>{c.name}</b></Link></td>
                      <td>{c.email || "-"}</td>
                      <td>{c.phone || "-"}</td>
                      <td>{archived ? "Archivé" : "Actif"}</td>
                      <td>
                        <form action={setCustomerActive} className="actions">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="is_active" value={archived ? "true" : "false"} />
                          <button className="button" type="submit">{archived ? "Réactiver" : "Supprimer / archiver"}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {!archived && <section className="card">
          <h2>Nouveau client</h2>
          <form action={createCustomer} className="form">
            <div className="field"><label>Nom / raison sociale</label><input name="name" required minLength={2} /></div>
            <div className="field"><label>E-mail</label><input name="email" type="email" /></div>
            <div className="field"><label>Téléphone</label><input name="phone" /></div>
            <div className="field"><label>Adresse</label><textarea name="address" /></div>
            <div className="field"><label>Identifiant fiscal</label><input name="tax_id" /></div>
            <button className="button primary">Créer le client</button>
          </form>
        </section>}
      </div>
    </>
  );
}
