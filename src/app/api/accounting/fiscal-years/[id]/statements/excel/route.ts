import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { loadFiscalStatements } from "@/lib/accounting/fiscal-statements";

const esc=(v:any)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const str=(v:any)=>'<Cell><Data ss:Type="String">'+esc(v)+'</Data></Cell>';
const num=(v:any)=>'<Cell><Data ss:Type="Number">'+(Number.isFinite(Number(v))?Number(v):0)+'</Data></Cell>';
const row=(cells:string[])=>'<Row>'+cells.join("")+'</Row>';
const sheet=(name:string,rows:string[])=>'<Worksheet ss:Name="'+esc(name)+'"><Table>'+rows.join("")+'</Table></Worksheet>';
function accountRows(title:string,items:any[]){
 return [row([str(title)]),row([str("Compte"),str("Intitulé"),str("Débit (MGA)"),str("Crédit (MGA)"),str("Solde")]),
 ...items.map(x=>row([str(x.code),str(x.label),num(x.debit),num(x.credit),num(x.balance)])),
 row([str("Total"),str(""),num(items.reduce((s,x)=>s+x.debit,0)),num(items.reduce((s,x)=>s+x.credit,0)),num(items.reduce((s,x)=>s+x.balance,0))])];
}
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const ctx=await requireOrganization();
 await requirePermission(ctx,"accounting.view");await requirePermission(ctx,"reports.export");
 const s=await loadFiscalStatements(ctx,id);
 const bilan=[
  row([str("BILAN • "+(s.organization?.trade_name||s.organization?.legal_name||s.organization?.name||"Entreprise"))]),
  row([str("Exercice"),str(s.year.label),str("Période"),str(s.year.period_start+" au "+s.year.period_end)]),
  row([str("ACTIF")]),...accountRows("Actifs",s.assets),
  row([str("CAPITAUX PROPRES")]),...accountRows("Capitaux propres",s.equity),
  row([str("PASSIF")]),...accountRows("Passifs",s.liabilities),
  row([str("Total actif"),num(s.totals.assets),str("Total capitaux propres et passifs"),num(s.totals.equity+s.totals.liabilities)]),
  row([str("Écart de bilan"),num(s.totals.balanceDifference)]),
 ];
 const result=[
  row([str("COMPTE DE RÉSULTAT"),str(s.year.label)]),
  ...accountRows("Produits",s.income),...accountRows("Charges",s.expenses),
  row([str("Résultat de l'exercice"),num(s.profit)]),
 ];
 const equity=[row([str("VARIATION DES CAPITAUX PROPRES")]),row([str("Compte"),str("Intitulé"),str("Solde ouverture"),str("Augmentations"),str("Diminutions"),str("Solde clôture")]),
 ...s.equityChanges.map(x=>row([str(x.code),str(x.label),num(x.opening),num(x.increase),num(x.decrease),num(x.closing)]))];
 const cash=[row([str("TABLEAU DES FLUX DE TRÉSORERIE")]),row([str("Rubrique"),str("Montant")]),
 ...s.cashFlows.map(x=>row([str(x.label),num(x.amount)])),
 row([str("Trésorerie d'ouverture"),num(s.openingCash)]),row([str("Trésorerie de clôture"),num(s.closingCash)])];
 const notes=[row([str("ANNEXE AUX ÉTATS FINANCIERS")]),...s.notes.map((x,i)=>row([str("Note "+(i+1)),str(x)]))];
 const controls=[row([str("CONTRÔLES")]),row([str("Exercice clôturé"),str(s.controls.isClosed?"Oui":"Non")]),
 row([str("Comptes non imputés"),num(s.controls.unmapped)]),row([str("Écritures déséquilibrées"),num(s.controls.unbalancedEntries)]),
 row([str("Bilan équilibré"),str(Math.abs(s.totals.balanceDifference)<0.01?"Oui":"Non")]),
 row([str("Prêt à être arrêté"),str(s.controls.ready?"Oui":"Non")]),
 row([str("Statut"),str(s.controls.ready?"États financiers arrêtés":"PROJET / NON VALIDÉ")])];
 const xml='<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'+
 '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'+
 sheet("Bilan",bilan)+sheet("Compte résultat",result)+sheet("Capitaux propres",equity)+sheet("Flux trésorerie",cash)+sheet("Annexe",notes)+sheet("Contrôles",controls)+'</Workbook>';
 const filename="magnisa-etats-financiers-"+String(s.year.label).replace(/[^a-z0-9-_]/gi,"-")+".xls";
 return new NextResponse(xml,{headers:{"Content-Type":"application/vnd.ms-excel; charset=utf-8","Content-Disposition":'attachment; filename="'+filename+'"'}});
}
