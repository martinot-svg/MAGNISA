import { formatDateDisplay } from "@/lib/date-format";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { money } from "@/lib/money";
import {
  approveFixedAssetIfrsAdjustment,
  componentizeFixedAsset,
  commissionFixedAsset,
  createFixedAsset,
  createFixedAssetIfrsAdjustment,
  disposeFixedAsset,
  planFixedAssetDepreciation,
  postFixedAssetAcquisition,
  postFixedAssetDepreciation,
  recordFixedAssetImpairment,
  reverseFixedAssetDepreciation,
  reverseFixedAssetIfrsAdjustment,
  reverseFixedAssetImpairment,
  transferFixedAsset,
  reclassifySupplierInvoiceToFixedAssetAction,
} from "@/server/actions/fixed-assets";

export default async function FixedAssets() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.view");
  const [
    { data: assets = [], error },
    { data: organization },
    { data: assetAccounts = [], error: assetAccountsError },
    { data: canManage },
    { data: depreciationEntries = [] },
    { data: postedDepreciationEntries = [] },
    { data: impairmentEntries = [] },
    { data: commissionings = [], error: commissioningError },
    { data: ifrsAdjustments = [] },
    { data: reconciliation = [], error: reconciliationError },
    { data: supplierInvoices = [] },
  ] = await Promise.all([
    ctx.supabase.from("fixed_assets")
      .select("id,asset_code,name,category,acquisition_date,in_service_date,acquisition_cost,directly_attributable_cost,residual_value,useful_life_months,depreciation_method,pcg_asset_account_code,pcg_acquisition_counterpart_account_code,acquisition_journal_entry_id,source_supplier_invoice_id,supplier_name,invoice_reference,legacy_accounting_origin,parent_asset_id,component_reference,accumulated_depreciation,net_book_value,impairment_loss,status,magnisa_reference,location,custodian")
      .eq("organization_id", ctx.organizationId)
      .order("acquisition_date", { ascending: false }),
    ctx.supabase.from("organizations").select("currency").eq("id", ctx.organizationId).single(),
    ctx.supabase.from("pcg2005_accounts").select("code,label").eq("kind", "asset").order("code"),
    ctx.supabase.rpc("has_org_permission", { p_org: ctx.organizationId, p_permission: "accounting.manage" }),
    ctx.supabase.from("fixed_asset_depreciation_entries")
      .select("id,fixed_asset_id,period_start,period_end,depreciation_charge,closing_net_book_value,status,journal_entry_id")
      .eq("organization_id", ctx.organizationId).eq("status", "planned").order("period_end", { ascending: true }).limit(50),
    ctx.supabase.from("fixed_asset_depreciation_entries")
      .select("id,fixed_asset_id,period_start,period_end,depreciation_charge,journal_entry_id")
      .eq("organization_id", ctx.organizationId).eq("status", "posted").not("journal_entry_id", "is", null).order("period_end", { ascending: false }).limit(50),
    ctx.supabase.from("fixed_asset_impairments")
      .select("id,fixed_asset_id,event_date,amount,reason,event_type")
      .eq("organization_id", ctx.organizationId).eq("event_type", "impairment").order("event_date", { ascending: false }).limit(50),
    ctx.supabase.from("fixed_asset_commissionings")
      .select("id,fixed_asset_id,event_date,old_asset_account_code,new_asset_account_code,gross_cost_reclassified,impairment_reclassified,depreciation_method,useful_life_months,reason,journal_entry_id")
      .eq("organization_id", ctx.organizationId).order("event_date", { ascending: false }).limit(50),
    ctx.supabase.from("fixed_asset_ifrs_adjustments")
      .select("id,fixed_asset_id,adjustment_date,adjustment_type,standard_reference,statutory_carrying_amount,ifrs_carrying_amount,adjustment_amount,reason,status")
      .eq("organization_id", ctx.organizationId).order("adjustment_date", { ascending: false }).limit(50),
    ctx.supabase.from("fixed_asset_register_reconciliation")
      .select("account_code,register_debit,register_credit,ledger_debit,ledger_credit,debit_difference,credit_difference,reconciliation_status")
      .eq("organization_id", ctx.organizationId).order("account_code"),
    ctx.supabase.from("supplier_invoices").select("id,supplier_number,invoice_date,subtotal,tax_total,total,tax_treatment,expense_account_code,accounting_treatment,status,suppliers(name)")
      .eq("organization_id",ctx.organizationId).eq("accounting_treatment","expense").neq("status","cancelled").order("invoice_date",{ascending:false}),
  ]);
  if (error) throw new Error("Impossible de charger le registre des immobilisations : " + error.message);
  if (assetAccountsError) throw new Error("Impossible de charger le plan comptable PCG : " + assetAccountsError.message);
  if (reconciliationError) throw new Error("Impossible de charger le rapprochement registre / grand livre : " + reconciliationError.message);
  if (commissioningError) throw new Error("Impossible de charger l’historique des mises en service : " + commissioningError.message);
  const currency = organization?.currency || "MGA";
  const totalCost = assets.reduce((sum: number, asset: any) => sum + Number(asset.acquisition_cost || 0) + Number(asset.directly_attributable_cost || 0), 0);
  const totalAccumulated = assets.reduce((sum: number, asset: any) => sum + Number(asset.accumulated_depreciation || 0), 0);
  const totalNet = assets.reduce((sum: number, asset: any) => sum + Number(asset.net_book_value || 0), 0);
  const commissionableAssets = assets.filter((asset: any) => asset.status === "active" && asset.pcg_asset_account_code?.startsWith("23") && !asset.in_service_date);
  const commissionTargetAccounts = assetAccounts.filter((account: any) => /^(20|21|22[0-8])[0-9]{0,4}$/.test(account.code));
  const registrationAssetAccounts = assetAccounts.filter((account: any) => /^(20|21|22[0-8]|23|26|27)[0-9]{0,4}$/.test(account.code));
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
      <FormDialog title="Créer une fiche d'immobilisation" buttonLabel="Nouvelle immobilisation"><form action={createFixedAsset} className="form">
        <div className="grid3">
          <div className="field"><label>Code immobilisation</label><input name="asset_code" required maxLength={40} placeholder="IMO-00001"/></div>
          <div className="field"><label>Désignation</label><input name="name" required maxLength={180}/></div>
          <div className="field"><label>Catégorie</label><input name="category" maxLength={100} placeholder="Matériel informatique, véhicule..."/></div>
          <div className="field"><label>Compte d'immobilisation PCG</label><select name="pcg_asset_account_code" required defaultValue=""><option value="" disabled>Choisir le compte d’immobilisation</option>{registrationAssetAccounts.map((account: any) => <option key={account.code} value={account.code}>{account.code} · {account.label}</option>)}</select></div>
          <div className="field"><label>Contrepartie PCG (404, 512, 10x, 45x ou 72x)</label><input name="pcg_acquisition_counterpart_account_code" required placeholder="404"/></div>
          <div className="field"><label>Date d'acquisition</label><input name="acquisition_date" type="date" required/></div>
          <div className="field"><label>Date de mise en service</label><input name="in_service_date" type="date"/></div>
          <div className="field"><label>Coût d'acquisition</label><input name="acquisition_cost" type="number" min="0.01" step="0.01" required/></div>
          <div className="field"><label>Coûts directement attribuables</label><input name="directly_attributable_cost" type="number" min="0" step="0.01" defaultValue="0"/></div>
          <div className="field"><label>Valeur résiduelle</label><input name="residual_value" type="number" min="0" step="0.01" defaultValue="0"/></div>
          <div className="field"><label>Méthode d'amortissement</label><select name="depreciation_method" defaultValue="straight_line"><option value="straight_line">Linéaire</option><option value="none">Non amortissable</option></select></div><small className="muted">Pour un compte 23 (immobilisation en cours), sélectionne Non amortissable. La durée et le départ des amortissements seront définis lors de la mise en service.</small>
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
      </form></FormDialog>
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
            <td>{asset.asset_code || asset.magnisa_reference || "—"}</td><td>{asset.name}<div className="muted">{asset.parent_asset_id ? "Composant de " + (assets.find((p: any) => p.id === asset.parent_asset_id)?.name || "immobilisation mère") : asset.component_reference === "componentized_parent" ? "Regroupement de composants" : asset.category || "À préciser"}</div></td>
            <td>{asset.pcg_asset_account_code || "À mapper"}</td><td>{asset.in_service_date || (asset.pcg_asset_account_code?.startsWith("23") ? "En cours" : asset.acquisition_date)}</td>
            <td className="right">{money(gross, currency)}</td><td>{life > 0 ? `${life} mois` : "Non amortissable / à définir"}</td>
            <td className="right">{money(Number(asset.accumulated_depreciation || 0), currency)}</td>
            <td className="right">{money(Number(asset.impairment_loss || 0), currency)}</td>
            <td className="right">{money(Number(asset.net_book_value || 0), currency)}</td><td>{asset.status}</td>
            <td>{asset.acquisition_journal_entry_id ? (asset.source_supplier_invoice_id ? "Facture fournisseur reclassée" : "Comptabilisée") : asset.parent_asset_id ? "Composant reclassé" : asset.legacy_accounting_origin ? "Historique à rapprocher" : canManage === true ? (()=>{const candidates=(supplierInvoices as any[]).filter(inv=>inv.supplier_number===asset.invoice_reference&&String(Array.isArray(inv.suppliers)?inv.suppliers[0]?.name:inv.suppliers?.name||"").trim().toLowerCase()===String(asset.supplier_name||"").trim().toLowerCase());return candidates.length>0?<FormDialog title="Rattacher une facture fournisseur" buttonLabel="Rattacher et reclasser"><form action={reclassifySupplierInvoiceToFixedAssetAction} className="stack"><input type="hidden" name="asset_id" value={asset.id}/><select name="supplier_invoice_id" required defaultValue=""><option value="" disabled>Facture fournisseur correspondante</option>{candidates.map(inv=><option key={inv.id} value={inv.id}>{inv.supplier_number} · {inv.invoice_date} · {money(Number(inv.total||0),currency)}</option>)}</select><button className="button" type="submit">Rattacher et reclasser</button></form></FormDialog>:<FormDialog title="Comptabiliser une acquisition" buttonLabel="Comptabiliser l’acquisition"><form action={postFixedAssetAcquisition}><input type="hidden" name="asset_id" value={asset.id}/><button className="button" type="submit">Comptabiliser l’acquisition</button></form></FormDialog>;})() : "En attente"}</td>
          </tr>;
        })}</tbody></table></div>}
    </section>
    <section className="card section">
      <h2>Rapprochement registre / grand livre / bilan</h2>
      <p className="muted">Les soldes nets des comptes 2, 28 et 29 sont comparés aux valeurs brutes, amortissements et dépréciations du registre. Les écritures de cession et de contrepassation sont prises en compte.</p>
      {!reconciliation.length ? <p className="muted">Aucun solde à rapprocher pour le moment.</p> :
        <div className="tableWrap"><table><thead><tr><th>Compte PCG</th><th className="right">Registre débit</th><th className="right">Grand livre débit</th><th className="right">Écart débit</th><th className="right">Registre crédit</th><th className="right">Grand livre crédit</th><th className="right">Écart crédit</th><th>État</th></tr></thead><tbody>
          {reconciliation.map((r: any) => <tr key={r.account_code}>
            <td>{r.account_code}</td>
            <td className="right">{money(Number(r.register_debit), currency)}</td>
            <td className="right">{money(Number(r.ledger_debit), currency)}</td>
            <td className="right">{money(Number(r.debit_difference), currency)}</td>
            <td className="right">{money(Number(r.register_credit), currency)}</td>
            <td className="right">{money(Number(r.ledger_credit), currency)}</td>
            <td className="right">{money(Number(r.credit_difference), currency)}</td>
            <td>{r.reconciliation_status === "reconciled" ? "Rapproché" : "Écart à analyser"}</td>
          </tr>)}
        </tbody></table></div>}
    </section>

    {canManage === true && <>
    <section className="card section">
      <h2>Mise en service des immobilisations en cours</h2>
      <p className="muted">Les comptes 23 ne sont pas amortis avant l’achèvement. Cette opération reclassifie le coût vers le compte définitif, transfère les dépréciations existantes vers le compte 29 adapté et fixe la date de départ des amortissements.</p>
      {canManage === true && <FormDialog title="Mettre une immobilisation en service" buttonLabel="Comptabiliser la mise en service"><form action={commissionFixedAsset} className="form">
        <div className="grid3">
          <div className="field"><label>Immobilisation en cours</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien en compte 23</option>{commissionableAssets.map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · {a.name}</option>)}</select></div>
          <div className="field"><label>Date effective de mise en service</label><input name="event_date" type="date" required/></div>
          <div className="field"><label>Nouveau compte d’actif PCG</label><select name="new_asset_account_code" required defaultValue=""><option value="" disabled>Choisir le compte définitif</option>{commissionTargetAccounts.map((account: any) => <option key={account.code} value={account.code}>{account.code} · {account.label}</option>)}</select></div>
          <div className="field"><label>Méthode après mise en service</label><select name="depreciation_method" defaultValue="straight_line"><option value="straight_line">Linéaire</option><option value="none">Sans amortissement</option></select></div>
          <div className="field"><label>Durée d’utilisation (mois)</label><input name="useful_life_months" type="number" min="1" max="1200" placeholder="60"/></div>
          <div className="field"><label>Compte 28 adapté</label><input name="pcg_accumulated_depreciation_account_code" placeholder="280, 281 ou 282"/></div>
          <div className="field"><label>Compte de dotation 681</label><input name="pcg_depreciation_expense_account_code" placeholder="681"/></div>
          <div className="field"><label>Compte 29 adapté</label><input name="pcg_impairment_account_code" placeholder="290, 291 ou 292" required/></div>
          <div className="field"><label>Justification</label><input name="reason" minLength={10} required placeholder="Réception, procès-verbal, mise en exploitation..."/></div>
        </div>
        <button className="button" type="submit" disabled={!commissionableAssets.length || !commissionTargetAccounts.length}>Comptabiliser la mise en service</button>
      </form></FormDialog>}
      {!commissionableAssets.length && <p className="muted">Aucune immobilisation en cours à mettre en service actuellement.</p>}
      {commissionings.length > 0 && <div className="tableWrap"><table><thead><tr><th>Date</th><th>Immobilisation</th><th>Reclassement PCG</th><th>Coût reclassé</th><th>Dépréciation transférée</th><th>Méthode / durée</th><th>Journal</th></tr></thead><tbody>
        {commissionings.map((entry: any) => <tr key={entry.id}><td>{entry.event_date}</td><td>{assets.find((a: any) => a.id === entry.fixed_asset_id)?.name || entry.fixed_asset_id}</td><td>{entry.old_asset_account_code} → {entry.new_asset_account_code}</td><td>{money(Number(entry.gross_cost_reclassified), currency)}</td><td>{money(Number(entry.impairment_reclassified), currency)}</td><td>{entry.depreciation_method === "straight_line" ? `Linéaire · ${entry.useful_life_months} mois` : "Sans amortissement"}</td><td>{entry.journal_entry_id}</td></tr>)}
      </tbody></table></div>}
    </section>

    <section className="card section">
      <h2>Planifier et comptabiliser les dotations</h2>
      <p className="muted">La préparation calcule une dotation sans journal. La comptabilisation appelle le moteur central, contrôle la période, vérifie les comptes PCG et crée une écriture équilibrée, protégée contre les doublons.</p>
      <FormDialog title="Calculer un plan d'amortissement" buttonLabel="Calculer le plan"><form action={planFixedAssetDepreciation} className="form">
        <div className="grid3">
          <div className="field"><label>Immobilisation</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien</option>{assets.filter((a: any) => a.status === "active" && a.depreciation_method === "straight_line").map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · {a.name}</option>)}</select></div>
          <div className="field"><label>Début de période</label><input name="period_start" type="date" required/></div>
          <div className="field"><label>Fin de période</label><input name="period_end" type="date" required/></div>
        </div>
        <button className="button" type="submit">Calculer le plan</button>
      </form></FormDialog>
      {!depreciationEntries.length ? <p className="muted">Aucune dotation en attente de comptabilisation.</p> :
        <div className="tableWrap"><table><thead><tr><th>Bien</th><th>Période</th><th className="right">Dotation</th><th className="right">VNC après dotation</th><th>Action</th></tr></thead><tbody>
          {depreciationEntries.map((entry: any) => {
            const asset = assets.find((a: any) => a.id === entry.fixed_asset_id);
            return <tr key={entry.id}><td>{asset?.asset_code || asset?.name || entry.fixed_asset_id}</td><td>{formatDateDisplay(entry.period_start)} au {formatDateDisplay(entry.period_end)}</td><td className="right">{money(Number(entry.depreciation_charge), currency)}</td><td className="right">{money(Number(entry.closing_net_book_value), currency)}</td><td><FormDialog title="Comptabiliser une dotation aux amortissements" buttonLabel="Comptabiliser"><form action={postFixedAssetDepreciation}><input type="hidden" name="depreciation_entry_id" value={entry.id}/><button className="button primary" type="submit">Comptabiliser</button></form></FormDialog></td></tr>;
          })}
        </tbody></table></div>}
      {postedDepreciationEntries.length > 0 && <>
        <h3>Dotations déjà comptabilisées</h3>
        <div className="tableWrap"><table><thead><tr><th>Bien</th><th>Période</th><th className="right">Dotation</th><th>Journal</th><th>Contrepassation</th></tr></thead><tbody>
          {postedDepreciationEntries.map((entry: any) => <tr key={entry.id}>
            <td>{assets.find((a: any) => a.id === entry.fixed_asset_id)?.asset_code || assets.find((a: any) => a.id === entry.fixed_asset_id)?.name || entry.fixed_asset_id}</td>
            <td>{entry.period_start} au {entry.period_end}</td>
            <td className="right">{money(Number(entry.depreciation_charge), currency)}</td>
            <td>{entry.journal_entry_id}</td>
            <td><FormDialog title="Contrepasser une dotation aux amortissements" buttonLabel="Contrepasser"><form action={reverseFixedAssetDepreciation} className="form">
              <input type="hidden" name="depreciation_entry_id" value={entry.id}/>
              <input type="date" name="reversal_date" required aria-label="Date de contrepassation"/>
              <input name="reason" minLength={10} required placeholder="Motif de contrepassation" aria-label="Motif de contrepassation"/>
              <button className="button" type="submit">Contrepasser</button>
            </form></FormDialog></td>
          </tr>)}
        </tbody></table></div>
      </>}
    </section>

    <section className="card section">
      <h2>Dépréciation et reprise</h2>
      <p className="muted">Une dépréciation compare la valeur nette comptable à la valeur recouvrable documentée. La reprise est plafonnée au montant de la dépréciation cumulée et passe par une écriture distincte.</p>
      <FormDialog title="Enregistrer une dépréciation" buttonLabel="Comptabiliser la dépréciation"><form action={recordFixedAssetImpairment} className="form">
        <div className="grid3">
          <div className="field"><label>Immobilisation</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien</option>{assets.filter((a: any) => a.status === "active").map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · VNC {money(Number(a.net_book_value || 0), currency)}</option>)}</select></div>
          <div className="field"><label>Date</label><input name="event_date" type="date" required/></div>
          <div className="field"><label>Valeur recouvrable</label><input name="recoverable_amount" type="number" min="0" step="0.01" required/></div>
        </div>
        <div className="field"><label>Justification et référence de l'évaluation</label><textarea name="reason" minLength={10} required rows={2}/></div>
        <button className="button" type="submit">Comptabiliser la dépréciation</button>
      </form></FormDialog>
      {impairmentEntries.length > 0 && <div className="tableWrap"><table><thead><tr><th>Bien</th><th>Date</th><th className="right">Dépréciation</th><th>Reprise</th></tr></thead><tbody>{impairmentEntries.map((entry: any) => <tr key={entry.id}><td>{assets.find((a: any) => a.id === entry.fixed_asset_id)?.name || entry.fixed_asset_id}</td><td>{entry.event_date}</td><td className="right">{money(Number(entry.amount), currency)}</td><td><FormDialog title="Reprendre une dépréciation" buttonLabel="Reprendre"><form action={reverseFixedAssetImpairment}><input type="hidden" name="impairment_id" value={entry.id}/><input type="hidden" name="event_date" value={new Date().toISOString().slice(0,10)}/><input type="hidden" name="reason" value={"Reprise après nouvelle évaluation documentée de la valeur recouvrable."}/><button className="button" type="submit">Reprendre</button></form></FormDialog></td></tr>)}</tbody></table></div>}
    </section>

    <section className="card section">
      <h2>Transfert et sortie d'immobilisation</h2>
      <div className="grid2">
        <FormDialog title="Transférer une immobilisation" buttonLabel="Enregistrer le transfert"><form action={transferFixedAsset} className="form">
          <h3>Transfert interne</h3>
          <div className="field"><label>Immobilisation</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien</option>{assets.filter((a: any) => a.status === "active").map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · {a.name}</option>)}</select></div>
          <div className="field"><label>Date</label><input name="transfer_date" type="date" required/></div>
          <div className="field"><label>Nouvel emplacement</label><input name="new_location" maxLength={180}/></div>
          <div className="field"><label>Nouveau détenteur</label><input name="new_custodian" maxLength={180}/></div>
          <div className="field"><label>Motif</label><textarea name="reason" minLength={3} required rows={2}/></div>
          <button className="button" type="submit">Enregistrer le transfert</button>
        </form></FormDialog>
        <FormDialog title="Comptabiliser la sortie d'une immobilisation" buttonLabel="Comptabiliser la sortie"><form action={disposeFixedAsset} className="form">
          <h3>Cession ou mise au rebut</h3>
          <div className="field"><label>Immobilisation</label><select name="asset_id" required defaultValue=""><option value="" disabled>Choisir un bien</option>{assets.filter((a: any) => a.status === "active" || a.status === "fully_depreciated").map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · {a.name}</option>)}</select></div>
          <div className="field"><label>Date de sortie</label><input name="disposal_date" type="date" required/></div>
          <div className="field"><label>Prix de cession (0 pour mise au rebut)</label><input name="proceeds" type="number" min="0" step="0.01" defaultValue="0" required/></div>
          <div className="field"><label>Motif et justificatif</label><textarea name="reason" minLength={5} required rows={2}/></div>
          <button className="button primary" type="submit">Comptabiliser la sortie</button>
        </form></FormDialog>
      </div>
    </section>


    <section className="card section">
      <h2>Ventilation par composants</h2>
      <p className="muted">La ventilation conserve le coût brut, les amortissements et les dépréciations cumulés. Elle crée des fiches enfants dans le registre existant et une écriture de reclassement équilibrée. L’acquisition de la fiche mère doit être comptabilisée au préalable.</p>
      <FormDialog title="Ventiler une immobilisation en composants" buttonLabel="Ventiler et comptabiliser le reclassement"><form action={componentizeFixedAsset} className="form">
        <div className="grid3">
          <div className="field"><label>Immobilisation mère</label><select name="parent_asset_id" required defaultValue=""><option value="" disabled>Choisir un bien non ventilé</option>{assets.filter((a: any) => a.status === "active" && !a.parent_asset_id && a.component_reference !== "componentized_parent" && !!a.acquisition_journal_entry_id).map((a: any) => <option key={a.id} value={a.id}>{a.asset_code || a.name} · {a.name}</option>)}</select></div>
          <div className="field"><label>Date de ventilation</label><input name="event_date" type="date" required/></div>
        </div>
        <div className="field"><label>Justification et référence de l'étude des composants</label><textarea name="reason" minLength={10} required rows={2}/></div>
        <div className="field"><label>Composants (JSON, 2 à 20 lignes)</label><textarea name="components_json" required rows={10} defaultValue={JSON.stringify([
          {asset_code:"IMO-C1",name:"Composant principal",acquisition_cost:600000,directly_attributable_cost:0,residual_value:0,accumulated_depreciation:0,impairment_loss:0,useful_life_months:60,depreciation_method:"straight_line",pcg_asset_account_code:"215",pcg_accumulated_depreciation_account_code:"281",pcg_depreciation_expense_account_code:"681",pcg_impairment_account_code:"291",pcg_impairment_expense_account_code:"681",pcg_impairment_reversal_income_account_code:"781",pcg_disposal_receivable_account_code:"462",pcg_disposal_expense_account_code:"652",pcg_disposal_income_account_code:"752"},
          {asset_code:"IMO-C2",name:"Composant secondaire",acquisition_cost:400000,directly_attributable_cost:0,residual_value:0,accumulated_depreciation:0,impairment_loss:0,useful_life_months:120,depreciation_method:"straight_line",in_service_date:"2026-01-01",pcg_asset_account_code:"215",pcg_accumulated_depreciation_account_code:"281",pcg_depreciation_expense_account_code:"681",pcg_impairment_account_code:"291",pcg_impairment_expense_account_code:"681",pcg_impairment_reversal_income_account_code:"781",pcg_disposal_receivable_account_code:"462",pcg_disposal_expense_account_code:"652",pcg_disposal_income_account_code:"752"}
        ],null,2)}/></div>
        <p className="muted">Les coûts bruts, valeurs résiduelles, amortissements et dépréciations des composants doivent chacun totaliser exactement les montants de la fiche mère. Adapte les codes PCG et les dates à chaque composant.</p>
        <button className="button primary" type="submit">Ventiler et comptabiliser le reclassement</button>
      </form></FormDialog>
    </section>
    <section className="card section">
      <h2>Rapprochement IFRS distinct</h2>
      <p className="muted">Les ajustements sont conservés dans un sous-registre séparé. Leur approbation ne modifie ni la fiche statutaire PCG ni le grand livre PCG.</p>
      <FormDialog title="Enregistrer un ajustement IFRS" buttonLabel="Enregistrer l'ajustement IFRS"><form action={createFixedAssetIfrsAdjustment} className="form">
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
      </form></FormDialog>
      {!ifrsAdjustments.length ? <p className="muted">Aucun ajustement IFRS enregistré.</p> :
        <div className="tableWrap"><table><thead><tr><th>Bien</th><th>Norme</th><th>Nature</th><th className="right">PCG</th><th className="right">IFRS</th><th className="right">Écart</th><th>Statut</th><th>Action</th></tr></thead><tbody>
          {ifrsAdjustments.map((entry: any) => <tr key={entry.id}><td>{assets.find((a: any) => a.id === entry.fixed_asset_id)?.name || entry.fixed_asset_id}</td><td>{entry.standard_reference}</td><td>{entry.adjustment_type}</td><td className="right">{money(Number(entry.statutory_carrying_amount), currency)}</td><td className="right">{money(Number(entry.ifrs_carrying_amount), currency)}</td><td className="right">{money(Number(entry.adjustment_amount), currency)}</td><td>{entry.status}</td><td>{entry.status === "draft" ? <FormDialog title="Approuver un ajustement IFRS" buttonLabel="Approuver"><form action={approveFixedAssetIfrsAdjustment}><input type="hidden" name="adjustment_id" value={entry.id}/><button className="button" type="submit">Approuver</button></form></FormDialog> : entry.status === "approved" ? <FormDialog title="Contrepasser un ajustement IFRS" buttonLabel="Contrepasser"><form action={reverseFixedAssetIfrsAdjustment} className="form"><input type="hidden" name="adjustment_id" value={entry.id}/><input name="reason" minLength={10} required placeholder="Motif d'annulation"/><button className="button" type="submit">Contrepasser</button></form></FormDialog> : "Contrepassé"}</td></tr>)}
        </tbody></table></div>}
    </section>
    </>}
  </>;
}
