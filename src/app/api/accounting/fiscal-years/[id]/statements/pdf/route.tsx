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
  <View style={[styles.row,styles.header]}><Text style={styles.cell}>Compte</Text><Text style={styles.cell}>Intitulé</Text><Text style={styles.right}>Débit</Text><Text style={styles.right}>Crédit</Text><Text style={styles.right}>Solde</Text></View>
  {rows.map((r:any)=><View style={styles.row} key={r.code}><Text style={styles.cell}>{r.code}</Text><Text style={styles.cell}>{r.label}</Text><Text style={styles.right}>{money(r.debit||0,currency)}</Text><Text style={styles.right}>{money(r.credit||0,currency)}</Text><Text style={styles.right}>{money(r.balance||0,currency)}</Text></View>)}
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
   <Text style={styles.subtitle}>États financiers annuels • PCG 2005 Madagascar • {s.year.label} • {s.year.period_start} au {s.year.period_end}</Text>
   <Text style={styles.warning}>{s.controls.ready?"ÉTATS FINANCIERS ARRÊTÉS":"PROJET / NON VALIDÉ — "+(s.controls.isClosed?"Contrôles incomplets":"Exercice non clôturé")}</Text>
   <Text style={styles.section}>1. BILAN</Text>
   <Text>Actif : {money(s.totals.assets,s.currency)} • Passifs : {money(s.totals.liabilities,s.currency)} • Capitaux propres : {money(s.totals.equity,s.currency)}</Text>
   <Table title="Actifs" rows={s.assets} currency={s.currency}/>
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
   <Text style={styles.note}>Exercice clôturé : {s.controls.isClosed?"Oui":"Non"} • Comptes non imputés : {s.controls.unmapped} • Écritures déséquilibrées : {s.controls.unbalancedEntries} • Bilan équilibré : {Math.abs(s.totals.balanceDifference)<0.01?"Oui":"Non"}</Text>
   <Text style={styles.note}>Document généré par MAGNISA. L'arrêté des états financiers demeure sous la responsabilité des dirigeants et nécessite la validation des informations complémentaires de l'annexe.</Text>
  </Page>
 </Document>;
 const buffer=await renderToBuffer(doc);
 const filename=("etats-financiers-"+String(s.year.label).replace(/[^a-z0-9-_]/gi,"-")+".pdf");
 return new NextResponse(buffer as BodyInit,{headers:{"Content-Type":"application/pdf","Content-Disposition":'attachment; filename="'+filename+'"'}});
}
