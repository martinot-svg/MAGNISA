import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { loadFiscalStatements } from "@/lib/accounting/fiscal-statements";
import { money } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";

export default async function Statements({searchParams}:{searchParams:Promise<{year?:string}>}){
 const params=await searchParams;const ctx=await requireOrganization();await requirePermission(ctx,"accounting.view");
 const {supabase,organizationId}=ctx;
 const {data:years,error}=await supabase.from("accounting_fiscal_years").select("id,label,period_start,period_end,status")
  .eq("organization_id",organizationId).order("period_start",{ascending:false});
 if(error)throw new Error(error.message);
 const selected=(years||[]).find((y:any)=>y.id===params.year)||(years||[])[0];
 if(!selected)return <><div className="pageHead"><div><h1>États financiers</h1><p>États annuels selon le PCG 2005 de Madagascar.</p></div></div><EmptyState title="Aucun exercice comptable" description="Crée d'abord un exercice et génère ses à-nouveaux dans le module Exercices comptables."/></>;
 const s=await loadFiscalStatements(ctx,selected.id);const fmt=(v:number)=>money(v,s.currency);
 const rows=(items:any[])=>items.length?items.map(x=><tr key={x.code}><td>{x.code}</td><td>{x.label}</td><td className="right">{fmt(x.debit)}</td><td className="right">{fmt(x.credit)}</td><td className="right">{fmt(x.balance)}</td></tr>):<tr><td colSpan={5}>Aucun mouvement comptabilisé.</td></tr>;
 return <>
  <div className="pageHead"><div><h1>États financiers</h1><p>Présentation annuelle selon le Plan Comptable Général 2005 de Madagascar.</p></div>
   <div className="actions"><a className="button" href={`/api/accounting/fiscal-years/${selected.id}/statements/pdf`}>Exporter PDF</a><a className="button" href={`/api/accounting/fiscal-years/${selected.id}/statements/excel`}>Exporter Excel</a></div>
  </div>
  <section className="card section">
   <form method="get" className="form"><div className="field"><label>Exercice comptable</label><select name="year" defaultValue={selected.id}>
    {(years||[]).map((y:any)=><option key={y.id} value={y.id}>{y.label} • {y.period_start} au {y.period_end} • {y.status==="closed"?"Clôturé":"Ouvert"}</option>)}
   </select></div><button className="button">Afficher l'exercice</button></form>
   <p className="muted">Entreprise : {s.organization?.trade_name||s.organization?.legal_name||s.organization?.name||"Entreprise"} • Devise : {s.currency} • Période : {s.year.period_start} au {s.year.period_end}</p>
   <p><strong>{s.controls.ready?"États contrôlés":"PROJET / NON VALIDÉ"}</strong> • Exercice clôturé : {s.controls.isClosed?"Oui":"Non"} • Comptes non imputés : {s.controls.unmapped} • Écritures déséquilibrées : {s.controls.unbalancedEntries} • Écart de bilan : {fmt(s.totals.balanceDifference)}</p>
   {!s.controls.ready&&<p role="alert">Les documents exportés portent le statut PROJET / NON VALIDÉ. L'annexe doit également être complétée et vérifiée par la direction avant arrêté définitif.</p>}
  </section>
  <section className="section">
   <h2>1. Bilan</h2>
   <div className="grid3"><div className="card"><div className="muted">Total actif</div><div className="metric">{fmt(s.totals.assets)}</div></div><div className="card"><div className="muted">Capitaux propres</div><div className="metric">{fmt(s.totals.equity)}</div></div><div className="card"><div className="muted">Passifs</div><div className="metric">{fmt(s.totals.liabilities)}</div></div></div>
   {[["Actifs",s.assets],["Capitaux propres",s.equity],["Passifs",s.liabilities]].map(([title,items]:any)=><div className="tableWrap" key={title}><h3>{title}</h3><table><thead><tr><th>Compte</th><th>Intitulé</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde</th></tr></thead><tbody>{rows(items)}</tbody></table></div>)}
   <p><strong>Écart de bilan : {fmt(s.totals.balanceDifference)}</strong></p>
  </section>
  <section className="section">
   <h2>2. Compte de résultat</h2>
   {[["Produits",s.income],["Charges",s.expenses]].map(([title,items]:any)=><div className="tableWrap" key={title}><h3>{title}</h3><table><thead><tr><th>Compte</th><th>Intitulé</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde</th></tr></thead><tbody>{rows(items)}</tbody></table></div>)}
   <p><strong>Résultat de l'exercice : {fmt(s.profit)}</strong></p>
  </section>
  <section className="section"><h2>3. Tableau des variations des capitaux propres</h2><div className="tableWrap"><table><thead><tr><th>Compte</th><th>Intitulé</th><th className="right">Ouverture</th><th className="right">Augmentations</th><th className="right">Diminutions</th><th className="right">Clôture</th></tr></thead><tbody>{s.equityChanges.map(x=><tr key={x.code}><td>{x.code}</td><td>{x.label}</td><td className="right">{fmt(x.opening)}</td><td className="right">{fmt(x.increase)}</td><td className="right">{fmt(x.decrease)}</td><td className="right">{fmt(x.closing)}</td></tr>)}</tbody></table></div></section>
  <section className="section"><h2>4. Tableau des flux de trésorerie</h2><p>Classement des mouvements de trésorerie par nature des comptes de contrepartie PCG.</p><div className="tableWrap"><table><thead><tr><th>Rubrique</th><th className="right">Montant</th></tr></thead><tbody>{s.cashFlows.map(x=><tr key={x.label}><td>{x.label}</td><td className="right">{fmt(x.amount)}</td></tr>)}<tr><td>Trésorerie d'ouverture</td><td className="right">{fmt(s.openingCash)}</td></tr><tr><td>Trésorerie de clôture</td><td className="right">{fmt(s.closingCash)}</td></tr></tbody></table></div></section>
  <section className="section"><h2>5. Annexe aux états financiers</h2><ol>{s.notes.map((note,i)=><li key={i}>{note}</li>)}</ol><p className="muted">Les informations détaillées sur les méthodes d'évaluation, les immobilisations, les stocks, les échéances, les engagements et les éventualités doivent être documentées par l'entreprise avant l'arrêté définitif.</p></section>
 </>;
}
