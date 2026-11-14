import { formatDateDisplay } from "@/lib/date-format";
import React from "react";
import { NextResponse } from "next/server";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { loadFiscalStatements } from "@/lib/accounting/fiscal-statements";

const styles=StyleSheet.create({
 page:{padding:34,fontSize:8,color:"#172033",fontFamily:"Helvetica"},
 title:{fontSize:17,fontWeight:700,marginBottom:5},
 subtitle:{fontSize:9,color:"#526078",marginBottom:12},
 section:{fontSize:11,fontWeight:700,marginTop:15,marginBottom:6},
 row:{flexDirection:"row",borderBottomWidth:0.5,borderBottomColor:"#d8dee9",paddingVertical:4},
 cell:{flex:1},right:{textAlign:"right",width:82},
 header:{fontWeight:700,backgroundColor:"#eef2f7",padding:5},
 note:{fontSize:7,color:"#526078",marginBottom:4},
 warning:{fontSize:9,color:"#9a3412",marginBottom:8},
});
function money(v:number,c:string){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:0}).format(v);}
function Table({title,rows,currency}:{title:string;rows:any[];currency:string}){
 return <View>
  <Text style={styles.section}>{title}</Text>
  <View style={[styles.row,styles.header]}><Text style={styles.cell}>Compte</Text><Text style={styles.cell}>Intitulé</Text><Text style={styles.right}>Débit</Text><Text style={styles.right}>Crédit</Text><Text style={styles.right}>Solde N</Text><Text style={styles.right}>Solde N-1</Text></View>
  {rows.map((r:any)=><View style={styles.row} key={r.code}><Text style={styles.cell}>{r.code}</Text><Text style={styles.cell}>{r.label}</Text><Text style={styles.right}>{money(r.debit||0,currency)}</Text><Text style={styles.right}>{money(r.credit||0,currency)}</Text><Text style={styles.right}>{money(r.balance||0,currency)}</Text><Text style={styles.right}>{money(r.comparativeBalance||0,currency)}</Text></View>)}
  {!rows.length&&<Text style={styles.note}>Aucun mouvement comptabilisé sur cette rubrique.</Text>}
 </View>;
}
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const ctx=await requireOrganization();
 await requirePermission(ctx,"accounting.view");
 await requirePermission(ctx,"reports.export");
 const s=await loadFiscalStatements(ctx,id);
 const title=s.organization?.trade_name||s.organization?.legal_name||s.organization?.name||"Entreprise";
 const doc=<Document>
  <Page size="A4" style={styles.page} wrap>
   <Text style={styles.title}>{title}</Text>
   <Text style={styles.subtitle}>États financiers annuels • PCG 2005 Madagascar • {s.year.label} • {formatDateDisplay(s.year.period_start)} au {formatDateDisplay(s.year.period_end)} • Comparatif : {s.priorYearLabel||"Non disponible"}</Text>
   <Text style={styles.warning}>{s.controls.ready?"ÉTATS FINANCIERS ARRÊTÉS":"PROJET / NON VALIDÉ — "+(s.controls.isClosed?"Contrôles incomplets":"Exercice non clôturé")}</Text>
   <Text style={styles.section}>1. BILAN</Text>
   <Text>Actif : {money(s.totals.assets,s.currency)} • Passifs : {money(s.totals.liabilities,s.currency)} • Capitaux propres : {money(s.totals.equity,s.currency)}</Text>
   <Table title="Actifs • détail du grand livre" rows={s.assets} currency={s.currency}/>
   <Text style={styles.section}>Ventilation réglementaire de l'actif PCG 2005</Text>
   <Text style={styles.note}>Inventaire physique : {s.inventoryValuation.count_available?"Approuvé le "+s.inventoryValuation.count_date+" • "+s.inventoryValuation.valuation_method:"Absent / non approuvé"} • Écart brut {money(s.inventoryValuation.gross_ledger_gap,s.currency)} • Écart dépréciations {money(s.inventoryValuation.impairment_ledger_gap,s.currency)}</Text>
   <Text style={styles.note}>Actif non courant net classé : {money(s.assetPresentation.totals.nonCurrentNet,s.currency)} • Actif courant net classé : {money(s.assetPresentation.totals.currentNet,s.currency)} • Créances en attente d'échéance : {money(s.assetPresentation.totals.maturityPendingNet,s.currency)}</Text>
   {[{title:"Actif non courant",items:s.assetPresentation.nonCurrent},{title:"Actif courant",items:s.assetPresentation.current},{title:"Créances à ventiler selon leur échéance",items:s.assetPresentation.maturityPending},{title:"Comptes à justifier ou reclasser",items:s.assetPresentation.reviewRequired},{title:"Comptes sans règle PCG",items:s.assetPresentation.unmapped}].map(group=><View key={group.title}>
    <Text style={styles.note}>{group.title}</Text>
    {group.items.map(item=><View style={styles.row} key={item.key}><Text style={styles.cell}>{item.label} • {item.accounts.map((a:any)=>a.code+" "+a.label+" • "+((a.sourceEntries||[]).map((e:any)=>e.reference||e.entryId).join(", ")||a.label)).join("; ")}</Text><Text style={styles.right}>{money(item.amount,s.currency)}</Text></View>)}
    {!group.items.length&&<Text style={styles.note}>Aucun montant identifié.</Text>}
   </View>)}
   {s.assetPresentation.blockingIssues.map((issue:string,i:number)=><Text style={styles.warning} key={i}>{issue}</Text>)}
   {!s.controls.assetPresentationReady&&<Text style={styles.warning}>Ventilation de l'actif non validée : échéances, comptes transitoires, soldes anormaux, mappings ou migration de présentation à contrôler.</Text>}
   <Text style={styles.section}>Rapprochement banques, mobile money et caisse</Text>
   {s.cashReconciliation.accounts.map((a:any)=><View style={styles.row} key={a.id}><Text style={styles.cell}>{a.name} • {a.type} • PCG {a.pcg_account_code||"À mapper"}</Text><Text style={styles.right}>{money(a.as_of_balance,s.currency)} • Écart mouvements {money(a.movement_gap,s.currency)}</Text></View>)}
   {s.cashReconciliation.comparisons.map((a:any)=><View style={styles.row} key={a.pcg_account_code}><Text style={styles.cell}>PCG {a.pcg_account_code} • Auxiliaire {money(a.financial_balance,s.currency)} • Grand livre {money(a.ledger_balance,s.currency)}</Text><Text style={styles.right}>Écart {money(a.difference,s.currency)}</Text></View>)}
   <Text style={styles.note}>Écart interne trésorerie : {money(s.cashReconciliation.account_movement_gap,s.currency)} • Écart auxiliaire / grand livre : {money(s.cashReconciliation.gl_reconciliation_gap,s.currency)} • Comptes non mappés : {s.cashReconciliation.unknown_account_count}</Text>
   <Text style={styles.section}>Ventilation réglementaire des capitaux propres et du passif selon le PCG 2005</Text>
   {[{title:"Capitaux propres",items:s.passifPresentation.equity},{title:"Passifs non courants",items:s.passifPresentation.nonCurrentLiabilities},{title:"Passifs courants",items:s.passifPresentation.currentLiabilities},{title:"Échéances à ventiler",items:s.passifPresentation.maturityPending},{title:"Comptes à justifier ou reclasser",items:s.passifPresentation.reviewRequired},{title:"Comptes sans règle passif",items:s.passifPresentation.unmapped}].map(group=><View key={group.title}>
    <Text style={styles.note}>{group.title}</Text>
    {group.items.map(item=><View style={styles.row} key={item.key}><Text style={styles.cell}>{item.label} • {item.accounts.map((a:any)=>a.code+" "+a.label+" • "+((a.sourceEntries||[]).map((e:any)=>e.reference||e.entryId).join(", ")||a.label)).join("; ")}</Text><Text style={styles.right}>{money(item.amount,s.currency)}</Text></View>)}
    {!group.items.length&&<Text style={styles.note}>Aucun montant identifié.</Text>}
   </View>)}
   <Text style={styles.note}>Capitaux propres nets : {money(s.passifPresentation.totals.equity,s.currency)} • Passifs non courants : {money(s.passifPresentation.totals.nonCurrentLiabilities,s.currency)} • Passifs courants : {money(s.passifPresentation.totals.currentLiabilities,s.currency)} • Échéances à justifier : {money(s.passifPresentation.totals.maturityPending,s.currency)} • Total passif : {money(s.passifPresentation.totals.passif,s.currency)}</Text>
   {s.passifPresentation.blockingIssues.map((issue:string,i:number)=><Text style={styles.warning} key={i}>{issue}</Text>)}
   {!s.controls.passifPresentationReady&&<Text style={styles.warning}>Ventilation du passif non validée : comptes, échéanciers d’emprunts ou rapprochements à justifier.</Text>}
   <Table title="Capitaux propres" rows={s.equity} currency={s.currency}/>
   <Table title="Passifs" rows={s.liabilities} currency={s.currency}/>
   <Text style={styles.note}>Écart de bilan : {money(s.totals.balanceDifference,s.currency)}</Text>
   <Text style={styles.section}>2. COMPTE DE RÉSULTAT</Text>
   <Table title="Produits" rows={s.income} currency={s.currency}/>
   <Table title="Charges" rows={s.expenses} currency={s.currency}/>
   <Text>Résultat de l'exercice : {money(s.profit,s.currency)}</Text>
   <Text style={styles.section}>3. VARIATION DES CAPITAUX PROPRES</Text>
   {s.equityChanges.map(r=><Text style={styles.note} key={r.code}>{r.code} {r.label} • Ouverture {money(r.opening,s.currency)} • Augmentations {money(r.increase,s.currency)} • Diminutions {money(r.decrease,s.currency)} • Clôture {money(r.closing,s.currency)}</Text>)}
   <Text style={styles.section}>4. TABLEAU DES FLUX DE TRÉSORERIE</Text>
   <Text>Trésorerie d'ouverture : {money(s.openingCash,s.currency)} • Trésorerie de clôture : {money(s.closingCash,s.currency)}</Text>
   {s.cashFlows.map(r=><Text style={styles.note} key={r.label}>{r.label} : {money(r.amount,s.currency)}</Text>)}
   <Text style={styles.section}>5. ANNEXE</Text>
   {s.notes.map((r,i)=><Text style={styles.note} key={i}>{i+1}. {r}</Text>)}
   <Text style={styles.section}>Contrôles de préparation</Text>
   <Text style={styles.note}>Bilan prêt à être validé : {s.controls.balanceSheetReady?"Oui":"Non"} • Actif : {s.controls.assetPresentationReady?"Validé":"À compléter"} • Passif : {s.controls.passifPresentationReady?"Validé":"À compléter"} • Écart actif / passif : {money(s.totals.balanceDifference,s.currency)}</Text>
   <Text style={styles.note}>Exercice clôturé : {s.controls.isClosed?"Oui":"Non"} • Comptes non imputés : {s.controls.unmapped} • Écritures déséquilibrées : {s.controls.unbalancedEntries} • Flux non classés : {s.controls.unclassifiedCashFlowEntries} • Écart de trésorerie : {money(s.controls.cashFlowReconciliationDifference,s.currency)} • Bilan équilibré : {Math.abs(s.totals.balanceDifference)<0.01?"Oui":"Non"} • Ventilation PCG de l’actif : {s.controls.assetPresentationReady?"Validée":"À compléter"} • Ventilation PCG du passif : {s.controls.passifPresentationReady?"Validée":"À compléter"} • Rapprochement trésorerie : {s.controls.cashReconciliationReady?"Validé":"À compléter"} • Inventaire physique : {s.controls.inventoryCountReady?"Validé":"À compléter"}</Text><Text style={styles.warning}>Rapprochement du flux opérationnel avec le résultat avant impôt : {s.controls.operatingCashFlowReconciliationReady?"Validé":"À construire"}. Présentation PCG complète : {s.controls.pcgPresentationReady?"Validée":"À compléter"}. Cet export demeure un document de travail.</Text>
   <Text style={styles.note}>Document généré par MAGNISA. L'arrêté des états financiers demeure sous la responsabilité des dirigeants et nécessite la validation des informations complémentaires de l'annexe.</Text>
  </Page>
 </Document>;
 const buffer=await renderToBuffer(doc);
 const filename=("etats-financiers-"+String(s.year.label).replace(/[^a-z0-9-_]/gi,"-")+".pdf");
 return new NextResponse(buffer as BodyInit,{headers:{"Content-Type":"application/pdf","Content-Disposition":'attachment; filename="'+filename+'"'}});
}
