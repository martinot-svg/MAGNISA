import { FormDialog } from "@/components/form-dialog";
import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { loadFiscalStatements } from "@/lib/accounting/fiscal-statements";
import { money } from "@/lib/money";
import { revalidatePath } from "next/cache";
import { EmptyState } from "@/components/empty-state";
import { formatDateDisplay } from "@/lib/date-format";

async function saveFiscalNotes(formData:FormData){
 "use server";
 const ctx=await requireOrganization();await requirePermission(ctx,"accounting.manage");
 const yearId=String(formData.get("year_id")||"");
 const keys=["accounting_policies","valuation_methods","fixed_assets","inventories","receivables_payables","commitments","contingencies","related_parties","subsequent_events"];
 const notes=Object.fromEntries(keys.map(k=>[k,String(formData.get(k)||"").trim()]));
 const {error}=await ctx.supabase.rpc("magnisa_update_fiscal_year_notes",{p_org:ctx.organizationId,p_year:yearId,p_notes:notes});
 if(error)throw new Error(error.message);
 revalidatePath("/etats-financiers");revalidatePath("/exercices-comptables");
}

export default async function Statements({searchParams}:{searchParams:Promise<{year?:string}>}){
 const params=await searchParams;const ctx=await requireOrganization();await requirePermission(ctx,"accounting.view");
 const {supabase,organizationId}=ctx;
 const {data:years,error}=await supabase.from("accounting_fiscal_years").select("id,label,period_start,period_end,status")
  .eq("organization_id",organizationId).order("period_start",{ascending:false});
 if(error)throw new Error(error.message);
 const selected=(years||[]).find((y:any)=>y.id===params.year)||(years||[])[0];
 if(!selected)return <><div className="pageHead"><div><h1>États financiers</h1><p>États annuels selon le PCG 2005 de Madagascar.</p></div></div><EmptyState title="Aucun exercice comptable" description="Crée d'abord un exercice et génère ses à-nouveaux dans le module Exercices comptables."/></>;
 const s=await loadFiscalStatements(ctx,selected.id);const fmt=(v:number)=>money(v,s.currency);
 const sourceLabel=(x:any)=>x.sourceEntries?.length?x.sourceEntries.map((entry:any)=>entry.reference||entry.entryId).join(", ")+(x.sourceEntryCount>x.sourceEntries.length?" … ("+x.sourceEntryCount+" lignes)":""):"Sous-grand-livre / détail source";
 const rows=(items:any[])=>items.length?items.map(x=><tr key={x.code}><td>{x.code}</td><td>{x.label}</td><td className="right">{fmt(x.debit)}</td><td className="right">{fmt(x.credit)}</td><td className="right">{fmt(x.balance)}</td><td className="right">{fmt(x.comparativeBalance)}</td><td>{sourceLabel(x)}</td></tr>):<tr><td colSpan={7}>Aucun mouvement comptabilisé.</td></tr>;
 return <>
  <div className="pageHead"><div><h1>États financiers</h1><p>Présentation annuelle selon le Plan Comptable Général 2005 de Madagascar.</p></div>
   <div className="actions"><a className="button" href={`/api/accounting/fiscal-years/${selected.id}/statements/pdf`}>Exporter PDF</a><a className="button" href={`/api/accounting/fiscal-years/${selected.id}/statements/excel`}>Exporter Excel</a></div>
  </div>
  <section className="card section">
   <form method="get" className="form"><div className="field"><label>Exercice comptable</label><select name="year" defaultValue={selected.id}>
    {(years||[]).map((y:any)=><option key={y.id} value={y.id}>{y.label} • {formatDateDisplay(y.period_start)} au {formatDateDisplay(y.period_end)} • {y.status==="closed"?"Clôturé":"Ouvert"}</option>)}
   </select></div><button className="button">Afficher l'exercice</button></form>
   <p className="muted">Entreprise : {s.organization?.trade_name||s.organization?.legal_name||s.organization?.name||"Entreprise"} • Devise : {s.currency} • Période : {formatDateDisplay(s.year.period_start)} au {formatDateDisplay(s.year.period_end)} • Comparatif : {s.priorYearLabel||"Aucun exercice antérieur disponible"}</p>
   <p><strong>Bilan : {s.controls.balanceSheetReady?"COMPLET ET CONTRÔLÉ":"À COMPLÉTER"}</strong> • Clôture : {s.controls.isClosed?"Oui":"Non"} • Actif : {s.controls.assetPresentationReady?"Validé":"À compléter"} • Passif : {s.controls.passifPresentationReady?"Validé":"À compléter"} • Écart : {fmt(s.totals.balanceDifference)}</p>
   <p><strong>{s.controls.ready?"États contrôlés":"PROJET / NON VALIDÉ"}</strong> • Exercice clôturé : {s.controls.isClosed?"Oui":"Non"} • Comptes non imputés : {s.controls.unmapped} • Écritures déséquilibrées : {s.controls.unbalancedEntries} • Écart de bilan : {fmt(s.totals.balanceDifference)} • Flux non classés : {s.controls.unclassifiedCashFlowEntries} • Écart de rapprochement de trésorerie : {fmt(s.controls.cashFlowReconciliationDifference)} • Annexe renseignée : {s.controls.notesReady?"Oui":"Non"} • Ventilation PCG de l’actif : {s.controls.assetPresentationReady?"Validée":"À compléter"} • Ventilation PCG du passif : {s.controls.passifPresentationReady?"Validée":"À compléter"} • Rapprochement trésorerie : {s.controls.cashReconciliationReady?"Validé":"À compléter"} • Inventaire physique : {s.controls.inventoryCountReady?"Validé":"À compléter"} • Rapprochement flux opérationnel / résultat avant impôt : {s.controls.operatingCashFlowReconciliationReady?"Validé":"À construire"} • Présentation PCG complète : {s.controls.pcgPresentationReady?"Validée":"À compléter"}</p>
   {!s.controls.ready&&<p role="alert">Les documents exportés portent le statut PROJET / NON VALIDÉ. Les rapprochements du tableau des flux et les ventilations PCG du bilan et du compte de résultat restent à compléter avant tout arrêté définitif.</p>}
  </section>
  <section className="section">
   <h2>1. Bilan</h2>
   <div className="grid3"><div className="card"><div className="muted">Total actif</div><div className="metric">{fmt(s.totals.assets)}</div></div><div className="card"><div className="muted">Capitaux propres</div><div className="metric">{fmt(s.totals.equity)}</div></div><div className="card"><div className="muted">Passifs</div><div className="metric">{fmt(s.totals.liabilities)}</div></div></div>
   {[["Actifs",s.assets],["Capitaux propres",s.equity],["Passifs",s.liabilities]].map(([title,items]:any)=><div className="tableWrap" key={title}><h3>{title}</h3><table><thead><tr><th>Compte</th><th>Intitulé</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde N</th><th className="right">Solde N-1</th><th>Sources / pièces</th></tr></thead><tbody>{rows(items)}</tbody></table></div>)}
   <div className="tableWrap">
    <h3>Ventilation réglementaire de l'actif selon le PCG 2005</h3>
    <p className="muted">Les comptes correcteurs sont isolés des valeurs brutes. Les créances sans échéance documentée et les comptes transitoires restent signalés, sans classement arbitraire.</p>
    {[{title:"Actif non courant",items:s.assetPresentation.nonCurrent},{title:"Actif courant",items:s.assetPresentation.current},{title:"Créances en attente de ventilation par échéance",items:s.assetPresentation.maturityPending},{title:"Comptes à justifier ou à reclasser",items:s.assetPresentation.reviewRequired},{title:"Comptes sans règle de présentation PCG",items:s.assetPresentation.unmapped}].map(group=><div key={group.title}>
     <h4>{group.title}</h4>
     <table><thead><tr><th>Rubrique</th><th>Comptes sources</th><th>Écritures / pièces sources</th><th className="right">Montant</th></tr></thead><tbody>
      {group.items.length?group.items.map(item=><tr key={item.key}><td>{item.label}</td><td>{item.accounts.map((a:any)=>a.code+" • "+a.label+(a.sourceEntries?.length?" • "+a.sourceEntries.map((entry:any)=>entry.reference||entry.entryId).join(", "):"")).join("; ")}</td><td>{item.accounts.map((a:any)=>{const refs=(a.sourceEntries||[]).map((e:any)=>e.reference||e.entryId);const more=Math.max(0,(a.sourceEntryCount||refs.length)-refs.length);return a.code+": "+(refs.length?refs.join(", "):a.label)+(more?" (+"+more+" autres)":"");}).join("; ")}</td><td className="right">{fmt(item.amount)}</td></tr>):<tr><td colSpan={4}>Aucun montant identifié.</td></tr>}
     </tbody></table>
    </div>)}
    <p>Inventaire physique : {s.inventoryValuation.count_available?("Approuvé le "+s.inventoryValuation.count_date+" • Méthode "+s.inventoryValuation.valuation_method):"Absent ou non approuvé"} • Écart brut : {fmt(s.inventoryValuation.gross_ledger_gap)} • Écart dépréciations : {fmt(s.inventoryValuation.impairment_ledger_gap)}</p>
    <p><strong>Actif non courant net classé : {fmt(s.assetPresentation.totals.nonCurrentNet)}</strong> • <strong>Actif courant net classé : {fmt(s.assetPresentation.totals.currentNet)}</strong> • Créances en attente d'échéance : {fmt(s.assetPresentation.totals.maturityPendingNet)} • Total identifié hors comptes à justifier : {fmt(s.assetPresentation.totals.identifiedNet)}</p>
    {s.assetPresentation.blockingIssues.length>0&&<ul role="alert">{s.assetPresentation.blockingIssues.map((issue:string,i:number)=><li key={i}>{issue}</li>)}</ul>}
    {!s.controls.assetPresentationReady&&<p role="alert">La présentation de l'actif n'est pas validable : des rapprochements, échéances, comptes transitoires, soldes anormaux, mappings ou migrations restent à contrôler.</p>}
   </div>
   <div className="tableWrap">
    <h3>Ventilation réglementaire des capitaux propres et du passif selon le PCG 2005</h3>
    <p className="muted">Les soldes créditeurs et débiteurs des comptes mixtes sont présentés selon leur sens réel. Les emprunts sont ventilés à partir de leurs échéanciers actifs; les échéances absentes ou incohérentes restent bloquantes.</p>
    {[
      {title:"Capitaux propres",items:s.passifPresentation.equity},
      {title:"Passifs non courants",items:s.passifPresentation.nonCurrentLiabilities},
      {title:"Passifs courants",items:s.passifPresentation.currentLiabilities},
      {title:"Dettes en attente de ventilation par échéance",items:s.passifPresentation.maturityPending},
      {title:"Comptes à justifier ou à reclasser",items:s.passifPresentation.reviewRequired},
      {title:"Comptes sans règle de présentation du passif",items:s.passifPresentation.unmapped},
    ].map(group=><div key={group.title}>
      <h4>{group.title}</h4>
      <table><thead><tr><th>Rubrique</th><th>Comptes sources</th><th>Écritures / pièces sources</th><th className="right">Montant</th></tr></thead><tbody>
        {group.items.length?group.items.map(item=><tr key={item.key}><td>{item.label}</td><td>{item.accounts.map((a:any)=>a.code+" • "+a.label).join("; ")}</td><td>{item.accounts.map((a:any)=>{const refs=(a.sourceEntries||[]).map((e:any)=>e.reference||e.entryId);const more=Math.max(0,(a.sourceEntryCount||refs.length)-refs.length);return a.code+": "+(refs.length?refs.join(", "):a.label)+(more?" (+"+more+" autres)":"");}).join("; ")}</td><td className="right">{fmt(item.amount)}</td></tr>):<tr><td colSpan={4}>Aucun montant identifié.</td></tr>}
      </tbody></table>
    </div>)}
    <p><strong>Capitaux propres nets : {fmt(s.passifPresentation.totals.equity)}</strong> • Passifs non courants : {fmt(s.passifPresentation.totals.nonCurrentLiabilities)} • Passifs courants : {fmt(s.passifPresentation.totals.currentLiabilities)} • Échéances à justifier : {fmt(s.passifPresentation.totals.maturityPending)} • <strong>Total capitaux propres et passifs : {fmt(s.passifPresentation.totals.passif)}</strong></p>
    {s.passifPresentation.blockingIssues.length>0&&<ul role="alert">{s.passifPresentation.blockingIssues.map((issue:string,i:number)=><li key={i}>{issue}</li>)}</ul>}
    {!s.controls.passifPresentationReady&&<p role="alert">La présentation du passif n'est pas validable : des comptes, échéanciers d'emprunts ou rapprochements doivent encore être justifiés.</p>}
   </div>
   <p><a href="/inventaires">Gérer l'inventaire physique de clôture</a></p>
   <div className="tableWrap">
    <h3>Rapprochement des banques, mobile money et caisse</h3>
    <table><thead><tr><th>Compte financier</th><th>Type</th><th>Compte PCG</th><th className="right">Solde actuel</th><th className="right">Mouvements</th><th className="right">Solde à la clôture</th><th className="right">Écart interne</th></tr></thead><tbody>
     {s.cashReconciliation.accounts.length?s.cashReconciliation.accounts.map((a:any)=><tr key={a.id}><td>{a.name}</td><td>{a.type}</td><td>{a.pcg_account_code||"À mapper"}</td><td className="right">{fmt(a.current_balance)}</td><td className="right">{fmt(a.movements_total)}</td><td className="right">{fmt(a.as_of_balance)}</td><td className="right">{fmt(a.movement_gap)}</td></tr>):<tr><td colSpan={7}>Aucun compte financier.</td></tr>}
    </tbody></table>
    <table><thead><tr><th>Compte PCG</th><th className="right">Auxiliaire trésorerie</th><th className="right">Grand livre</th><th className="right">Écart</th></tr></thead><tbody>
     {s.cashReconciliation.comparisons.length?s.cashReconciliation.comparisons.map((a:any)=><tr key={a.pcg_account_code}><td>{a.pcg_account_code}</td><td className="right">{fmt(a.financial_balance)}</td><td className="right">{fmt(a.ledger_balance)}</td><td className="right">{fmt(a.difference)}</td></tr>):<tr><td colSpan={4}>Aucun rapprochement disponible.</td></tr>}
    </tbody></table>
    <p>Écart comptes financiers / mouvements : {fmt(s.cashReconciliation.account_movement_gap)} • Écart auxiliaire / grand livre : {fmt(s.cashReconciliation.gl_reconciliation_gap)} • Comptes financiers sans mapping PCG : {s.cashReconciliation.unknown_account_count}</p>
   </div>
   <p><strong>Écart de bilan : {fmt(s.totals.balanceDifference)}</strong></p>
  </section>
  <section className="section">
   <h2>2. Compte de résultat</h2>
   {[["Produits",s.income],["Charges",s.expenses]].map(([title,items]:any)=><div className="tableWrap" key={title}><h3>{title}</h3><table><thead><tr><th>Compte</th><th>Intitulé</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde N</th><th className="right">Solde N-1</th></tr></thead><tbody>{rows(items)}</tbody></table></div>)}
   <p><strong>Résultat de l'exercice : {fmt(s.profit)}</strong></p>
  </section>
  <section className="section"><h2>3. Tableau des variations des capitaux propres</h2><div className="tableWrap"><table><thead><tr><th>Compte</th><th>Intitulé</th><th className="right">Ouverture</th><th className="right">Augmentations</th><th className="right">Diminutions</th><th className="right">Clôture</th></tr></thead><tbody>{s.equityChanges.map(x=><tr key={x.code}><td>{x.code}</td><td>{x.label}</td><td className="right">{fmt(x.opening)}</td><td className="right">{fmt(x.increase)}</td><td className="right">{fmt(x.decrease)}</td><td className="right">{fmt(x.closing)}</td></tr>)}</tbody></table></div></section>
  <section className="section"><h2>4. Tableau des flux de trésorerie</h2><p>Présentation des encaissements et décaissements bruts identifiables. Les écritures complexes non ventilables sont exclues et signalées dans les contrôles.</p><div className="tableWrap"><table><thead><tr><th>Rubrique</th><th className="right">Montant</th></tr></thead><tbody>{s.cashFlows.map(x=><tr key={x.label}><td>{x.label}</td><td className="right">{fmt(x.amount)}</td></tr>)}<tr><td>Trésorerie d'ouverture</td><td className="right">{fmt(s.openingCash)}</td></tr><tr><td>Trésorerie de clôture</td><td className="right">{fmt(s.closingCash)}</td></tr><tr><td>Écart de rapprochement</td><td className="right">{fmt(s.controls.cashFlowReconciliationDifference)}</td></tr></tbody></table></div></section>
  <section className="section"><h2>5. Annexe aux états financiers</h2>
   <p className="muted">Complète les neuf rubriques de l'annexe. Les documents définitifs restent bloqués tant que ces informations ne sont pas renseignées.</p>
   <FormDialog title="Modifier les notes de l’annexe fiscale" buttonLabel="Enregistrer l’annexe"><form action={saveFiscalNotes} className="card form"><input type="hidden" name="year_id" value={s.year.id}/>
    <div className="field"><label>Règles et méthodes comptables</label><textarea name="accounting_policies" rows={3} defaultValue={s.year.notes?.accounting_policies||""} required placeholder="Principes comptables, continuité d'exploitation, permanence des méthodes, base de préparation..."/></div>
    <div className="field"><label>Méthodes d'évaluation et estimations</label><textarea name="valuation_methods" rows={3} defaultValue={s.year.notes?.valuation_methods||""} required placeholder="Coût historique, amortissements, dépréciations, provisions, change..."/></div>
    <div className="field"><label>Immobilisations, amortissements et dépréciations</label><textarea name="fixed_assets" rows={3} defaultValue={s.year.notes?.fixed_assets||""} required placeholder="Valeurs brutes, acquisitions, cessions, amortissements, valeurs nettes..."/></div>
    <div className="field"><label>Stocks et en-cours</label><textarea name="inventories" rows={3} defaultValue={s.year.notes?.inventories||""} required placeholder="Méthode de valorisation, inventaire physique, dépréciations, en-cours..."/></div>
    <div className="field"><label>Échéances des créances et dettes</label><textarea name="receivables_payables" rows={3} defaultValue={s.year.notes?.receivables_payables||""} required placeholder="Ventilation à moins d'un an, entre un et cinq ans, à plus de cinq ans..."/></div>
    <div className="field"><label>Engagements hors bilan</label><textarea name="commitments" rows={3} defaultValue={s.year.notes?.commitments||""} required placeholder="Garanties, cautions, crédit-bail, engagements contractuels ou néant justifié..."/></div>
    <div className="field"><label>Passifs éventuels et litiges</label><textarea name="contingencies" rows={3} defaultValue={s.year.notes?.contingencies||""} required placeholder="Contentieux, risques, provisions et incertitudes ou néant justifié..."/></div>
    <div className="field"><label>Parties liées et opérations avec dirigeants</label><textarea name="related_parties" rows={3} defaultValue={s.year.notes?.related_parties||""} required placeholder="Transactions, soldes, rémunérations et liens de contrôle ou néant justifié..."/></div>
    <div className="field"><label>Événements postérieurs à la clôture</label><textarea name="subsequent_events" rows={3} defaultValue={s.year.notes?.subsequent_events||""} required placeholder="Événements significatifs entre clôture et arrêté ou absence d'événement significatif..."/></div>
    <button className="button primary">Enregistrer l'annexe</button>
   </form></FormDialog>
   <ol>{s.notes.map((note,i)=><li key={i}>{note}</li>)}</ol>
  </section>
 </>;
}
