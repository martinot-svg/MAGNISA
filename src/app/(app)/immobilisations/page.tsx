import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import {
  approveFixedAssetIfrsAdjustment,
  createFixedAsset,
  createFixedAssetIfrsAdjustment,
  disposeFixedAsset,
  planFixedAssetDepreciation,
  postFixedAssetAcquisition,
  postFixedAssetDepreciation,
  recordFixedAssetImpairment,
  reverseFixedAssetImpairment,
  transferFixedAsset,
} from "@/server/actions/fixed-assets";

export default async function FixedAssets() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.view");
  const [
    { data: assets = [], error },
    { data: organization },
    { data: canManage },
    { data: depreciationEntries = [] },
    { data: impairmentEntries = [] },
    { data: ifrsAdjustments = [] },
  ] = await Promise.all([
    ctx.supabase.from("fixed_assets")
      .select("id,asset_code,name,category,acquisition_date,in_service_date,acquisition_cost,directly_attributable_cost,residual_value,useful_life_months,depreciation_method,pcg_asset_account_code,pcg_acquisition_counterpart_account_code,acquisition_journal_entry_id,accumulated_depreciation,net_book_value,impairment_loss,status,magnisa_reference,location,custodian")
      .eq("organization_id", ctx.organizationId)
      .order("acquisition_date", { ascending: false }),
    ctx.supabase.from("organizations").select("currency").eq("id", ctx.organizationId).single(),
    ctx.supabase.rpc("has_org_permission", { p_org: ctx.organizationId, p_permission: "accounting.manage" }),
    ctx.supabase.from("fixed_asset_depreciation_entries")
      .select("id,fixed_asset_id,period_start,period_end,depreciation_charge,closing_net_book_value,status,journal_entry_id")
      .eq("organization_id", ctx.organizationId).eq("status", "planned").order("period_end", { ascending: true }).limit(50),
    ctx.supabase.from("fixed_asset_impairments")
      .select("id,fixed_asset_id,event_date,amount,reason,event_type")
      .eq("organization_id", ctx.organizationId).eq("event_type", "impairment").order("event_date", { ascending: false }).limit(50),
    ctx.supabase.from("fixed_asset_ifrs_adjustments")
      .select("id,fixed_asset_id,adjustment_date,adjustment_type,standard_reference,statutory_carrying_amount,ifrs_carrying_amount,adjustment_amount,reason,status")
      .eq("organization_id", ctx.organizationId).order("adjustment_date", { ascending: false }).limit(50),
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
    {canManage === true && <>
    <section className="card section">
      <h2>Enregistrer une immobilisation</h2>
      <p className="muted">Cette opération crée la fiche du registre. Elle ne comptabilise pas l'acquisition et ne génère pas encore de dotation automatique.</p>
      <form action={createFixedAsset} className="form">
        <div className="grid3">
          <div className="field"><label>Code immobilisation</label><input name="asset_code" required maxLength={40} placeholder="IMO-00001"/></div>
          <div className="field"><label>Désignation</label><input name="name" required maxLength={180}/></div>
          <div className="field"><label>Catégorie</label><input name="category" maxLength={100} placeholder="Matériel informatique, véhicule..."/></div>
          <div className="field"><label>Compte d'immobilisation PCG</label><input name="pcg_asset_account_code" required pattern="(20|21|22|23|26|27)[0-9]{0,4}" placeholder="218"/></div>
          <div className="field"><label>Contrepartie d'acquisition (404 ou 512)</label><input name="pcg_acquisition_counterpart_account_code" required placeholder="404"/></div>
          <div className="field"><label>Date d'acquisition</label><input name="acquisition_date" type="date" required/></div>
          <div className="field"><label>Date de mise en service</label><input name="in_service_date" type="date" required/></div>
          <div className="field"><label>Coût d'acquisition</label><input name="acquisition_cost" type="number" min="0.01" step="0.01" required/></div>
          <div className="field"><label>Coûts directement attribuables</label><input name="directly_attributable_cost" type="number" min="0" step="0.01" defaultValue="0"/></div>
          <div className="field"><label>Valeur résiduelle</label><input name="residual_value" type="number" min="0" step="0.01" defaultValue="0"/></div>
          <div className="field"><label>Méthode d'amortissement</label><select name="depreciation_method" defaultValue="straight_line"><option value="straight_line">Linéaire</option><option value="none">Non amortissable</option></select></div>
          <div className="field"><label>Durée d'utilisation (mois)</label><input name="useful_life_months" type="number" min="1" step="1" placeholder="60"/></div>
          <div className="field"><label>Compte amortissements (28)</label><input name="pcg_accumulated_depreciation_account_code" placeholder="281"/></div>
          <div className="field"><label>Compte dotations amortissements (68)</label><input name="pcg_depreciation_expense_account_code" placeholder="681"/></div>
          <div className="field"><label>Compte dépréciations cumulées (29)</label><input name="pcg_impairment_account_code" placeholder="291"/></div>
          <div className="field"><label>Compte dotation dépréciation (68)</label><input name="pcg_impairment_expense_account_code" placeholder="681"/></div>
          <div className="field"><label>Compte reprise dépréciation (78)</label><input name="pcg_impairment_reversal_income_account_code" placeholder="781"/></div>
          <div className="field"><label>Compte créance de cession (46)</label><input name="pcg_disposal_receivable_account_code" placeholder="462"/></div>
          <div className="field"><label>Compte moins-value de cession (652)</label><input name="pcg_disposal_expense_account_code" placeholder="652"/></div>
          <div className="field"><label>Compte plus-value de cession (752)</label><input name="pcg_disposal_income_account_code" placeholder="752"/></div>
          <div className="field"><label>Fournisseur</label><input name="supplier_name" maxLength={180}/></div>
          <div className="field"><label>Référence facture</label><input name="invoice_reference" maxLength={100}/></div>
          <div className="field"><label>Numéro de série</label><input name="serial_number" maxLength={120}/></div>
          <div className="field"><label>Emplacement</label><input name="location" maxLength={180}/></div>
          <div className="field"><label>Responsable / détenteur</label><input name="custodian" maxLength={180}/></div>
        </div>
        <div className="field"><label>Notes et justificatifs</label><textarea name="notes" rows={3} maxLength={2000}/></div>
        <button className="button primary" type="submit">Enregistrer la fiche</button>
      </form>
    </section></>}
    <section className="card section">
      <h2>Registre des immobilisations</h2>
      <p className="muted">La valeur nette affichée provient du registre. Les dotations ne seront considérées comme comptabilisées qu'après génération et validation d'une écriture équilibrée.</p>
      {!assets.length ? <EmptyState title="Aucune immobilisation enregistrée" description="Les biens durables peuvent être enregistrés dans le formulaire ci-dessus par un utilisateur autorisé." /> :
        <div className="tableWrap"><table><thead><tr>
          <th>Code</th><th>Bien</th><th>Compte PCG</th><th>Date de mise en service</th><th className="right">Valeur brute</th><th>Durée</th><th className="right">Amortissements cumulés</th><th className="right">Dépréciations</th><th className="right">Valeur nette</th><th>Statut</th><th>Acquisition</th>
        </tr></thead><tbody>{assets.map((asset: any) => {
          const gross = Number(asset.acquisition_cost || 0) + Number(asset.directly_attributable_cost || 0);
          const life = Number(asset.useful_life_months || 0);
          return <tr key={asset.id}>
            <td>{asset.asset_code || asset.magnisa_reference || "—"}</td><td>{asset.name}<div className="muted">{asset.category || "À préciser"}</div></td>
            <td>{asset.pcg_asset_account_code || "À mapper"}</td><td>{asset.in_service_date || asset.acquisition_date}</td>
            <td className="right">{money(gross, currency)}</td><td>{life > 0 ? `${life} mois` : "Non amortissable / à définir"}</td>
            <td className="right">{money(Number(asset.accumulated_depreciation || 0), currency)}</td>
            <td className="right">{money(Number(asset.impairment_loss || 0), currency)}</td>
            <td className="right">{money(Number(asset.net_book_value || 0), currency)}</td><td>{asset.status}</td>
            <td>{asset.acquisition_journal_entry_id ? "Comptabilisée" : canManage === true ? <form action={postFixedAssetAcquisition}><input type="hidden" name="asset_id" value={asset.id}/><button className="button" type="submit">Comptabiliser</button></form> : "En attente"}</td>
          </tr>;
        })}</tbody></table></div>}
    </section>

    {canManage === true && <>
    <section className="card section">
      <h2>Planifier et comptabiliser les dotations</h2>
      <p className="muted">La préparation calcule une dotation sans journal. La comptabilisation appelle le moteur central, contrôle la période, vérifie les comptes PCG et crée une écriture équilibrée, protégée contre les doublons.</p>
      <form action={planFixedAssetDepreciation} className="form">
        <div className="grid3">
          <div className="field"><label>Immobilisation</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien</option>{assets.filter((a: any) => a.status === "active" && a.depreciation_method === "straight_line").map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · {a.name}</option>)}</select></div>
          <div className="field"><label>Début de période</label><input name="period_start" type="date" required/></div>
          <div className="field"><label>Fin de période</label><input name="period_end" type="date" required/></div>
        </div>
        <button className="button" type="submit">Calculer le plan</button>
      </form>
      {!depreciationEntries.length ? <p className="muted">Aucune dotation en attente de comptabilisation.</p> :
        <div className="tableWrap"><table><thead><tr><th>Bien</th><th>Période</th><th className="right">Dotation</th><th className="right">VNC après dotation</th><th>Action</th></tr></thead><tbody>
          {depreciationEntries.map((entry: any) => {
            const asset = assets.find((a: any) => a.id === entry.fixed_asset_id);
            return <tr key={entry.id}><td>{asset?.asset_code || asset?.name || entry.fixed_asset_id}</td><td>{entry.period_start} au {entry.period_end}</td><td className="right">{money(Number(entry.depreciation_charge), currency)}</td><td className="right">{money(Number(entry.closing_net_book_value), currency)}</td><td><form action={postFixedAssetDepreciation}><input type="hidden" name="depreciation_entry_id" value={entry.id}/><button className="button primary" type="submit">Comptabiliser</button></form></td></tr>;
          })}
        </tbody></table></div>}
    </section>

    <section className="card section">
      <h2>Dépréciation et reprise</h2>
      <p className="muted">Une dépréciation compare la valeur nette comptable à la valeur recouvrable documentée. La reprise est plafonnée au montant de la dépréciation cumulée et passe par une écriture distincte.</p>
      <form action={recordFixedAssetImpairment} className="form">
        <div className="grid3">
          <div className="field"><label>Immobilisation</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien</option>{assets.filter((a: any) => a.status === "active").map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · VNC {money(Number(a.net_book_value || 0), currency)}</option>)}</select></div>
          <div className="field"><label>Date</label><input name="event_date" type="date" required/></div>
          <div className="field"><label>Valeur recouvrable</label><input name="recoverable_amount" type="number" min="0" step="0.01" required/></div>
        </div>
        <div className="field"><label>Justification et référence de l'évaluation</label><textarea name="reason" minLength={10} required rows={2}/></div>
        <button className="button" type="submit">Comptabiliser la dépréciation</button>
      </form>
      {impairmentEntries.length > 0 && <div className="tableWrap"><table><thead><tr><th>Bien</th><th>Date</th><th className="right">Dépréciation</th><th>Reprise</th></tr></thead><tbody>{impairmentEntries.map((entry: any) => <tr key={entry.id}><td>{assets.find((a: any) => a.id === entry.fixed_asset_id)?.name || entry.fixed_asset_id}</td><td>{entry.event_date}</td><td className="right">{money(Number(entry.amount), currency)}</td><td><form action={reverseFixedAssetImpairment}><input type="hidden" name="impairment_id" value={entry.id}/><input type="hidden" name="event_date" value={new Date().toISOString().slice(0,10)}/><input type="hidden" name="reason" value={"Reprise après nouvelle évaluation documentée de la valeur recouvrable."}/><button className="button" type="submit">Reprendre</button></form></td></tr>)}</tbody></table></div>}
    </section>

    <section className="card section">
      <h2>Transfert et sortie d'immobilisation</h2>
      <div className="grid2">
        <form action={transferFixedAsset} className="form">
          <h3>Transfert interne</h3>
          <div className="field"><label>Immobilisation</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien</option>{assets.filter((a: any) => a.status === "active").map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · {a.name}</option>)}</select></div>
          <div className="field"><label>Date</label><input name="transfer_date" type="date" required/></div>
          <div className="field"><label>Nouvel emplacement</label><input name="new_location" maxLength={180}/></div>
          <div className="field"><label>Nouveau détenteur</label><input name="new_custodian" maxLength={180}/></div>
          <div className="field"><label>Motif</label><textarea name="reason" minLength={3} required rows={2}/></div>
          <button className="button" type="submit">Enregistrer le transfert</button>
        </form>
        <form action={disposeFixedAsset} className="form">
          <h3>Cession ou mise au rebut</h3>
          <div className="field"><label>Immobilisation</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien</option>{assets.filter((a: any) => a.status === "active" || a.status === "fully_depreciated").map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · {a.name}</option>)}</select></div>
          <div className="field"><label>Date de sortie</label><input name="disposal_date" type="date" required/></div>
          <div className="field"><label>Prix de cession (0 pour mise au rebut)</label><input name="proceeds" type="number" min="0" step="0.01" defaultValue="0" required/></div>
          <div className="field"><label>Motif et justificatif</label><textarea name="reason" minLength={5} required rows={2}/></div>
          <button className="button primary" type="submit">Comptabiliser la sortie</button>
        </form>
      </div>
    </section>

    <section className="card section">
      <h2>Rapprochement IFRS distinct</h2>
      <p className="muted">Les ajustements sont conservés dans un sous-registre séparé. Leur approbation ne modifie ni la fiche statutaire PCG ni le grand livre PCG.</p>
      <form action={createFixedAssetIfrsAdjustment} className="form">
        <div className="grid3">
          <div className="field"><label>Immobilisation</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien</option>{assets.map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · {a.name}</option>)}</select></div>
          <div className="field"><label>Date d'effet</label><input name="adjustment_date" type="date" required/></div>
          <div className="field"><label>Norme</label><input name="standard_reference" defaultValue="IAS 16" required/></div>
          <div className="field"><label>Nature</label><select name="adjustment_type" defaultValue="componentization"><option value="componentization">Composants</option><option value="useful_life">Durée d'utilisation</option><option value="residual_value">Valeur résiduelle</option><option value="revaluation">Réévaluation</option><option value="impairment">Dépréciation</option><option value="derecognition">Décomptabilisation</option><option value="other">Autre</option></select></div>
          <div className="field"><label>VNC statutaire PCG</label><input name="statutory_carrying_amount" type="number" min="0" step="0.01" required/></div>
          <div className="field"><label>Valeur comptable IFRS</label><input name="ifrs_carrying_amount" type="number" min="0" step="0.01" required/></div>
        </div>
        <div className="field"><label>Justification de l'écart</label><textarea name="reason" minLength={10} required rows={2}/></div>
        <div className="field"><label>Référence justificative</label><input name="supporting_reference" maxLength={180}/></div>
        <button className="button" type="submit">Enregistrer l'ajustement IFRS</button>
      </form>
      {!ifrsAdjustments.length ? <p className="muted">Aucun ajustement IFRS enregistré.</p> :
        <div className="tableWrap"><table><thead><tr><th>Bien</th><th>Norme</th><th>Nature</th><th className="right">PCG</th><th className="right">IFRS</th><th className="right">Écart</th><th>Statut</th><th>Action</th></tr></thead><tbody>
          {ifrsAdjustments.map((entry: any) => <tr key={entry.id}><td>{assets.find((a: any) => a.id === entry.fixed_asset_id)?.name || entry.fixed_asset_id}</td><td>{entry.standard_reference}</td><td>{entry.adjustment_type}</td><td className="right">{money(Number(entry.statutory_carrying_amount), currency)}</td><td className="right">{money(Number(entry.ifrs_carrying_amount), currency)}</td><td className="right">{money(Number(entry.adjustment_amount), currency)}</td><td>{entry.status}</td><td>{entry.status === "draft" ? <form action={approveFixedAssetIfrsAdjustment}><input type="hidden" name="adjustment_id" value={entry.id}/><button className="button" type="submit">Approuver</button></form> : "—"}</td></tr>)}
        </tbody></table></div>}
    </section>
    </>}
  </>;
}
