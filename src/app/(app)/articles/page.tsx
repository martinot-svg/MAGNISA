import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission, hasPermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { money } from "@/lib/money";
import {
  createCatalogItem,
  setCatalogItemActive,
  createStockLocation,
  setStockLocationActive,
} from "@/server/actions/catalog";

const KIND_LABELS: Record<string,string> = {
  merchandise: "Marchandise",
  equipment: "Équipement",
  consumable: "Consommable",
  raw_material: "Matière / composant",
  other: "Autre article",
};

export default async function Articles({
  searchParams,
}: {
  searchParams: Promise<{ archive?: string }>;
}) {
  const params = await searchParams;
  const archived = params.archive === "1";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "inventory.view");
  const canManage = await hasPermission(ctx, "inventory.manage");
  const { supabase, organizationId } = ctx;

  const [{ data: items = [] }, { data: locations = [] }, { data: balances = [] }, { data: org }] = await Promise.all([
    supabase.from("catalog_items").select("*").eq("organization_id", organizationId)
      .eq("is_active", !archived).order("name"),
    supabase.from("stock_locations").select("id,code,name,location_kind,is_active")
      .eq("organization_id", organizationId).order("name"),
    supabase.from("stock_on_hand").select("item_id,stock_location_id,quantity_on_hand")
      .eq("organization_id", organizationId),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);

  const currency = org?.currency || "MGA";
  const stockByItem = new Map<string, number>();
  for (const row of balances as Array<{item_id:string;quantity_on_hand:number}>) {
    stockByItem.set(row.item_id, (stockByItem.get(row.item_id) || 0) + Number(row.quantity_on_hand));
  }

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Articles & stocks</h1>
          <p>Catalogue des biens physiques et quantités issues des mouvements de stock validés.</p>
        </div>
        <div className="actions">
          <Link className="button" href={archived ? "/articles" : "/articles?archive=1"}>
            {archived ? "Voir les articles actifs" : "Voir les articles archivés"}
          </Link>
          {canManage && !archived && (
            <FormDialog title="Nouvel article" buttonLabel="+ Nouvel article">
              <form action={createCatalogItem} className="form">
                <div className="grid2">
                  <div className="field"><label>SKU / Référence interne</label><input name="sku" required maxLength={60}/></div>
                  <div className="field"><label>Nom de l'article</label><input name="name" required minLength={2}/></div>
                </div>
                <div className="field"><label>Description</label><textarea name="description" rows={2}/></div>
                <div className="grid2">
                  <div className="field"><label>Nature</label><select name="item_kind" defaultValue="merchandise"><option value="merchandise">Marchandise</option><option value="equipment">Équipement</option><option value="consumable">Consommable</option><option value="raw_material">Matière / composant</option><option value="other">Autre article</option></select></div>
                  <div className="field"><label>Unité de base</label><input name="base_unit" defaultValue="unité" required/></div>
                </div>
                <div className="field"><label>Suivi du stock</label><select name="tracking_mode" defaultValue="quantity"><option value="quantity">Quantité</option><option value="none">Sans suivi de quantité</option><option value="serial" disabled>Numéro de série (à venir)</option></select></div>
                <div className="grid2">
                  <div className="field"><label>Prix d'achat indicatif</label><input name="default_purchase_price" type="number" min="0" step="0.01" defaultValue="0" required/></div>
                  <div className="field"><label>Prix de vente indicatif</label><input name="default_sale_price" type="number" min="0" step="0.01" defaultValue="0" required/></div>
                </div>
                <div className="field"><label>Taux de taxe indicatif (%)</label><input name="default_tax_rate" type="number" min="0" max="100" step="0.01" defaultValue="0" required/></div>
                <button className="button primary" type="submit">Créer l'article</button>
              </form>
            </FormDialog>
          )}
          {canManage && !archived && (
            <FormDialog title="Nouvel emplacement" buttonLabel="+ Emplacement">
              <form action={createStockLocation} className="form">
                <div className="field"><label>Code</label><input name="code" required maxLength={40}/></div>
                <div className="field"><label>Nom</label><input name="name" required minLength={2}/></div>
                <div className="field"><label>Type</label><select name="location_kind" defaultValue="warehouse"><option value="warehouse">Entrepôt</option><option value="store">Magasin / point de vente</option><option value="transit">En transit</option><option value="virtual">Emplacement virtuel</option></select></div>
                <button className="button primary" type="submit">Créer l'emplacement</button>
              </form>
            </FormDialog>
          )}
        </div>
      </div>

      <section className="section">
        <div className="pageHead"><div><h2>Catalogue des articles</h2><p>{items.length} article(s) {archived ? "archivé(s)" : "actif(s)"}</p></div></div>
        {!items.length ? (
          <EmptyState title={archived ? "Aucun article archivé" : "Aucun article"} description="Les articles physiques seront enregistrés ici, indépendamment du catalogue des prestations."/>
        ) : (
          <div className="tableWrap"><table>
            <thead><tr><th>Référence</th><th>Article</th><th>Nature</th><th>Suivi</th><th className="right">Stock total</th><th className="right">Prix d'achat indicatif</th><th className="right">Prix de vente indicatif</th>{canManage && <th>Action</th>}</tr></thead>
            <tbody>{items.map((item:any) => (
              <tr key={item.id}>
                <td><code>{item.sku}</code></td>
                <td><strong>{item.name}</strong>{item.description ? <div className="muted">{item.description}</div> : null}</td>
                <td>{KIND_LABELS[item.item_kind] || item.item_kind}</td>
                <td>{item.tracking_mode === "quantity" ? "Quantité" : item.tracking_mode === "serial" ? "Série (à activer)" : "Non suivi"}</td>
                <td className="right">{item.tracking_mode === "quantity" ? (stockByItem.get(item.id) || 0).toLocaleString("fr-FR") : "—"} {item.base_unit}</td>
                <td className="right">{money(Number(item.default_purchase_price),currency)}</td>
                <td className="right">{money(Number(item.default_sale_price),currency)}</td>
                {canManage && <td><form action={setCatalogItemActive}><input type="hidden" name="id" value={item.id}/><input type="hidden" name="is_active" value={archived ? "true" : "false"}/><button className="button small" type="submit">{archived ? "Réactiver" : "Archiver"}</button></form></td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="section">
        <div className="pageHead"><div><h2>Emplacements de stock</h2><p>Les mouvements futurs seront rattachés à un emplacement précis.</p></div></div>
        {!locations.length ? <EmptyState title="Aucun emplacement" description="Crée un entrepôt ou un point de stockage avant d'enregistrer une réception suivie en quantité."/> : (
          <div className="tableWrap"><table><thead><tr><th>Code</th><th>Nom</th><th>Type</th><th>Statut</th>{canManage && <th>Action</th>}</tr></thead><tbody>
            {locations.map((location:any)=><tr key={location.id}><td><code>{location.code}</code></td><td>{location.name}</td><td>{location.location_kind}</td><td>{location.is_active ? "Actif" : "Archivé"}</td>{canManage && <td><form action={setStockLocationActive}><input type="hidden" name="id" value={location.id}/><input type="hidden" name="is_active" value={location.is_active ? "false" : "true"}/><button className="button small" type="submit">{location.is_active ? "Archiver" : "Réactiver"}</button></form></td>}</tr>)}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}
