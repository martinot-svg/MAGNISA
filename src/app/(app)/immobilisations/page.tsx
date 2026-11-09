import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { createFixedAsset } from "@/server/actions/fixed-assets";

export default async function FixedAssets() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.view");
  const [{ data: assets = [], error }, { data: organization }, { data: canManage }] = await Promise.all([
    ctx.supabase.from("fixed_assets")
      .select("id,asset_code,name,category,acquisition_date,in_service_date,acquisition_cost,directly_attributable_cost,residual_value,useful_life_months,depreciation_method,pcg_asset_account_code,accumulated_depreciation,net_book_value,status,magnisa_reference")
      .eq("organization_id", ctx.organizationId)
      .order("acquisition_date", { ascending: false }),
    ctx.supabase.from("organizations").select("currency").eq("id", ctx.organizationId).single(),
    ctx.supabase.rpc("has_org_permission", { p_org: ctx.organizationId, p_permission: "accounting.manage" }),
  ]);
  if (error) throw new Error("Impossible de charger le registre des immobilisations : " + error.message);
  const currency = organization?.currency || "MGA";
  const totalCost = assets.reduce((sum: number, asset: any) => sum + Number(asset.acquisition_cost || 0) + Number(asset.directly_attributable_cost || 0), 0);
  const totalAccumulated = assets.reduce((sum: number, asset: any) => sum + Number(asset.accumulated_depreciation || 0), 0);
  const totalNet = assets.reduce((sum: number, asset: any) => sum + Number(asset.net_book_value || 0), 0);
  return <>
    <div className="pageHead">
      <div>
        <h1>Immobilisations</h1>
        <p>Registre analytique des biens durables, rattachement PCG, mise en service et suivi de la valeur comptable.</p>
      </div>
    </div>
    <div className="grid3">
      <section className="card"><div className="muted">Nombre de biens</div><div className="metric">{assets.length}</div></section>
      <section className="card"><div className="muted">Valeur brute enregistrée</div><div className="metric">{money(totalCost, currency)}</div></section>
      <section className="card"><div className="muted">Valeur nette enregistrée</div><div className="metric">{money(totalNet, currency)}</div><div className="muted">Amortissements cumulés : {money(totalAccumulated, currency)}</div></section>
    </div>
    {canManage === true && <section className="card section">
      <h2>Enregistrer une immobilisation</h2>
      <p className="muted">Cette opération crée la fiche du registre. Elle ne comptabilise pas l'acquisition et ne génère pas encore de dotation automatique.</p>
      <form action={createFixedAsset} className="form">
        <div className="grid3">
          <div className="field"><label>Code immobilisation</label><input name="asset_code" required maxLength={40} placeholder="IMO-00001"/></div>
          <div className="field"><label>Désignation</label><input name="name" required maxLength={180}/></div>
          <div className="field"><label>Catégorie</label><input name="category" maxLength={100} placeholder="Matériel informatique, véhicule..."/></div>
          <div className="field"><label>Compte d'immobilisation PCG</label><input name="pcg_asset_account_code" required pattern="(20|21|22|23|26|27)[0-9]{0,4}" placeholder="2183"/></div>
          <div className="field"><label>Date d'acquisition</label><input name="acquisition_date" type="date" required/></div>
          <div className="field"><label>Date de mise en service</label><input name="in_service_date" type="date" required/></div>
          <div className="field"><label>Coût d'acquisition</label><input name="acquisition_cost" type="number" min="0.01" step="0.01" required/></div>
          <div className="field"><label>Coûts directement attribuables</label><input name="directly_attributable_cost" type="number" min="0" step="0.01" defaultValue="0"/></div>
          <div className="field"><label>Valeur résiduelle</label><input name="residual_value" type="number" min="0" step="0.01" defaultValue="0"/></div>
          <div className="field"><label>Méthode d'amortissement</label><select name="depreciation_method" defaultValue="straight_line"><option value="straight_line">Linéaire</option><option value="none">Non amortissable</option></select></div>
          <div className="field"><label>Durée d'utilisation (mois)</label><input name="useful_life_months" type="number" min="1" step="1" placeholder="60"/></div>
          <div className="field"><label>Compte amortissements (28)</label><input name="pcg_accumulated_depreciation_account_code" placeholder="28183"/></div>
          <div className="field"><label>Compte dotations (68)</label><input name="pcg_depreciation_expense_account_code" placeholder="68112"/></div>
          <div className="field"><label>Fournisseur</label><input name="supplier_name" maxLength={180}/></div>
          <div className="field"><label>Référence facture</label><input name="invoice_reference" maxLength={100}/></div>
          <div className="field"><label>Numéro de série</label><input name="serial_number" maxLength={120}/></div>
          <div className="field"><label>Emplacement</label><input name="location" maxLength={180}/></div>
          <div className="field"><label>Responsable / détenteur</label><input name="custodian" maxLength={180}/></div>
        </div>
        <div className="field"><label>Notes et justificatifs</label><textarea name="notes" rows={3} maxLength={2000}/></div>
        <button className="button primary" type="submit">Enregistrer la fiche</button>
      </form>
    </section>}
    <section className="card section">
      <h2>Registre des immobilisations</h2>
      <p className="muted">La valeur nette affichée provient du registre. Les dotations ne seront considérées comme comptabilisées qu'après génération et validation d'une écriture équilibrée.</p>
      {!assets.length ? <EmptyState title="Aucune immobilisation enregistrée" description="Les biens durables peuvent être enregistrés dans le formulaire ci-dessus par un utilisateur autorisé." /> :
        <div className="tableWrap"><table><thead><tr>
          <th>Code</th><th>Bien</th><th>Compte PCG</th><th>Date de mise en service</th><th className="right">Valeur brute</th><th>Durée</th><th className="right">Amortissements cumulés</th><th className="right">Valeur nette</th><th>Statut</th>
        </tr></thead><tbody>{assets.map((asset: any) => {
          const gross = Number(asset.acquisition_cost || 0) + Number(asset.directly_attributable_cost || 0);
          const life = Number(asset.useful_life_months || 0);
          const monthly = life > 0 ? Math.max(0, gross - Number(asset.residual_value || 0)) / life : null;
          return <tr key={asset.id}>
            <td>{asset.asset_code || asset.magnisa_reference || "—"}</td><td>{asset.name}<div className="muted">{asset.category || "À préciser"}</div></td>
            <td>{asset.pcg_asset_account_code || "À mapper"}</td><td>{asset.in_service_date || asset.acquisition_date}</td>
            <td className="right">{money(gross, currency)}</td><td>{life > 0 ? `${life} mois` : "Non amortissable / à définir"}</td>
            <td className="right">{money(Number(asset.accumulated_depreciation || 0), currency)}</td>
            <td className="right">{money(Number(asset.net_book_value || 0), currency)}</td><td>{asset.status}</td>
          </tr>;
        })}</tbody></table></div>}
    </section>
  </>;
}
