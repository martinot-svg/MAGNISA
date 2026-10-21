import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";

export default async function FixedAssets() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.view");
  const [{ data: assets = [], error }, { data: organization }] = await Promise.all([
    ctx.supabase.from("fixed_assets")
      .select("id,name,category,acquisition_date,acquisition_cost,useful_life_months,depreciation_method,accumulated_depreciation,net_book_value,status,magnisa_reference")
      .eq("organization_id", ctx.organizationId)
      .order("acquisition_date", { ascending: false }),
    ctx.supabase.from("organizations").select("currency").eq("id", ctx.organizationId).single(),
  ]);
  if (error) throw new Error("Impossible de charger le registre des immobilisations : " + error.message);
  const currency = organization?.currency || "MGA";
  const totalCost = assets.reduce((sum: number, asset: any) => sum + Number(asset.acquisition_cost || 0), 0);
  const totalNet = assets.reduce((sum: number, asset: any) => sum + Number(asset.net_book_value || 0), 0);
  return <>
    <div className="pageHead">
      <div>
        <h1>Immobilisations</h1>
        <p>Registre des biens durables, coût d'acquisition, durée d'utilisation et suivi indicatif de l'amortissement.</p>
      </div>
    </div>
    <div className="grid3">
      <section className="card"><div className="muted">Nombre de biens</div><div className="metric">{assets.length}</div></section>
      <section className="card"><div className="muted">Coût d'acquisition total</div><div className="metric">{money(totalCost, currency)}</div></section>
      <section className="card"><div className="muted">Valeur nette comptable enregistrée</div><div className="metric">{money(totalNet, currency)}</div></section>
    </div>
    <section className="card section">
      <h2>Registre des immobilisations</h2>
      <p className="muted">L'amortissement mensuel affiché est une estimation linéaire à partir du coût et de la durée renseignée. Il ne crée pas à lui seul une écriture comptable de dotation.</p>
      {!assets.length ? <EmptyState title="Aucune immobilisation enregistrée" description="Lorsqu'une dépense est classée comme acquisition durable, le bien apparaîtra ici." /> :
        <div className="tableWrap"><table><thead><tr>
          <th>Bien</th><th>Catégorie</th><th>Date d'acquisition</th><th className="right">Coût</th><th>Durée</th><th className="right">Amortissement mensuel estimé</th><th className="right">Amortissements cumulés</th><th className="right">Valeur nette</th><th>Statut</th>
        </tr></thead><tbody>{assets.map((asset: any) => {
          const life = Number(asset.useful_life_months || 0);
          const monthly = life > 0 ? Number(asset.acquisition_cost || 0) / life : null;
          return <tr key={asset.id}>
            <td>{asset.name}</td><td>{asset.category || "À préciser"}</td><td>{asset.acquisition_date}</td>
            <td className="right">{money(Number(asset.acquisition_cost || 0), currency)}</td>
            <td>{life > 0 ? `${life} mois` : "À définir"}</td>
            <td className="right">{monthly === null ? "À définir" : money(monthly, currency)}</td>
            <td className="right">{money(Number(asset.accumulated_depreciation || 0), currency)}</td>
            <td className="right">{money(Number(asset.net_book_value || 0), currency)}</td><td>{asset.status}</td>
          </tr>;
        })}</tbody></table></div>}
    </section>
  </>;
}
