import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { loadFiscalStatements } from "@/lib/accounting/fiscal-statements";
import { money } from "@/lib/money";
import { revalidatePath } from "next/cache";
import { EmptyState } from "@/components/empty-state";

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
 const rows=(items:any[])=>items.length?items.map(x=><tr key={x.code}><td>{x.code}</td><td>{x.label}</td><td className="right">{fmt(x.debit)}</td><td className="right">{fmt(x.credit)}</td><td className="right">{fmt(x.balance)}</td><td className="right">{fmt(x.comparativeBalance)}</td></tr>):<tr><td colSpan={6}>Aucun mouvement comptabilisé.</td></tr>;
 return <>
  <div className="pageHead"><div><h1>États financiers</h1><p>Présentation annuelle selon le Plan Comptable Général 2005 de Madagascar.</p></div>
   <div className="actions"><a className="button" href={`/api/accounting/fiscal-years/${selected.id}/statements/pdf`}>Exporter PDF</a><a className="button" href={`/api/accounting/fiscal-years/${selected.id}/statements/excel`}>Exporter Excel</a></div>
  </div>
  <section className="card section">
   <form method="get" className="form"><div className="field"><label>Exercice comptable</label><select name="year" defaultValue={selected.id}>
    {(years||[]).map((y:any)=><option key={y.id} value={y.id}>{y.label} • {y.period_start} au {y.period_end} • {y.status==="closed"?"Clôturé":"Ouvert"}</option>)}
   </select></div><button className="button">Afficher l'exercice</button></form>
   <p className="muted">Entreprise : {s.organization?.trade_name||s.organization?.legal_name||s.organization?.name||"Entreprise"} • Devise : {s.currency} • Période : {s.year.period_start} au {s.year.period_end}</p>
   <p><strong>{s.controls.ready?"États contrôlés":"PROJET / NON VALIDÉ"}</strong> • Exercice clôturé : {s.controls.isClosed?"Oui":"Non"} • Comptes non imputés : {s.controls.unmapped} • Écritures déséquilibrées : {s.controls.unbalancedEntries} • Écart de bilan : {fmt(s.totals.balanceDifference)} • Flux non classés : {s.controls.unclassifiedCashFlowEntries} • Écart de rapprochement de trésorerie : {fmt(s.controls.cashFlowReconciliationDifference)} • Annexe renseignée : {s.controls.notesReady?"Oui":"Non"}</p>
   {!s.controls.ready&&<p role="alert">Les documents exportés portent le statut PROJET / NON VALIDÉ. L'annexe doit également être complétée et vérifiée par la direction avant arrêté définitif.</p>}
  </section>
  <section className="section">
   <h2>1. Bilan</h2>
   <div className="grid3"><div className="card"><div className="muted">Total actif</div><div className="metric">{fmt(s.totals.assets)}</div></div><div className="card"><div className="muted">Capitaux propres</div><div className="metric">{fmt(s.totals.equity)}</div></div><div className="card"><div className="muted">Passifs</div><div className="metric">{fmt(s.totals.liabilities)}</div></div></div>
   {[["Actifs",s.assets],["Capitaux propres",s.equity],["Passifs",s.liabilities]].map(([title,items]:any)=><div className="tableWrap" key={title}><h3>{title}</h3><table><thead><tr><th>Compte</th><th>Intitulé</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde N</th><th className="right">Solde N-1</th></tr></thead><tbody>{rows(items)}</tbody></table></div>)}
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
   <form action={saveFiscalNotes} className="card form"><input type="hidden" name="year_id" value={s.year.id}/>
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
   </form>
   <ol>{s.notes.map((note,i)=><li key={i}>{note}</li>)}</ol>
  </section>
 </>;
}
