import React from "react";
import {Document,Page,Text,View,StyleSheet,renderToBuffer,Image} from "@react-pdf/renderer";
import {amountInWords} from "@/lib/amount-in-words";

const s=StyleSheet.create({
  page:{padding:34,fontSize:9.5,color:"#172033"},head:{flexDirection:"row",justifyContent:"space-between",paddingBottom:14,borderBottomWidth:1.4},
  brand:{fontSize:18,fontWeight:700},slogan:{fontSize:8,color:"#667085",marginTop:3},h1:{fontSize:16,fontWeight:700},row:{flexDirection:"row",borderBottomWidth:.5,borderBottomColor:"#d9dee7",paddingVertical:7},
  desc:{width:"43%"},qty:{width:"12%",textAlign:"right"},price:{width:"20%",textAlign:"right"},tax:{width:"10%",textAlign:"right"},num:{width:"15%",textAlign:"right"},
  totals:{marginTop:18,alignItems:"flex-end"},muted:{color:"#667085"},logo:{width:76,height:46,objectFit:"contain",marginBottom:5},words:{marginTop:18,paddingTop:12,borderTopWidth:.6,borderTopColor:"#d9dee7",lineHeight:1.45},footer:{position:"absolute",left:34,right:34,bottom:20,textAlign:"center",color:"#667085",fontSize:7.5}
});
export type PdfData={
  type:"DEVIS"|"FACTURE";number:string;company:string;slogan?:string|null;companyAddress?:string|null;logoUrl?:string|null;taxId?:string|null;statId?:string|null;registryId?:string|null;bankDetails?:string|null;
  customer:string;issueDate:string;dueDate?:string|null;lines:Array<{description:string;quantity:number;unitPrice:number;discountPct:number;taxRate:number;total:number}>;subtotal:number;discountTotal?:number;taxTotal:number;total:number;paidAmount?:number;balanceDue?:number;
  currency:string;paymentTerms?:string|null;legalMentions?:string|null;template?:{primaryColor?:string;secondaryColor?:string;fontFamily?:string;headerText?:string;footerText?:string;showTaxId?:boolean;showBankDetails?:boolean;showSlogan?:boolean;showAmountInWords?:boolean;amountWordsPrefix?:string;showStatId?:boolean;showRegistryId?:boolean;showTaxColumn?:boolean}
};
function money(v:number,c:string){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:2}).format(v)}
function F({v,c}:{v:number;c:string}){return <Text>{money(v,c)}</Text>}
export function PdfDocument({d}:{d:PdfData}){
  const color=d.template?.primaryColor||"#1663FF";const font=d.template?.fontFamily||"Helvetica";const showTax=d.template?.showTaxColumn!==false;
  const prefix=d.template?.amountWordsPrefix|| (d.type==="FACTURE"?"Arrêtée la présente facture à la somme de :":"Arrêté le présent devis à la somme de :");
  return <Document><Page size="A4" style={[s.page,{fontFamily:font}]}>
    {d.template?.headerText&&<Text style={[s.muted,{marginBottom:8}]}>{d.template.headerText}</Text>}
    <View style={[s.head,{borderBottomColor:color}]}><View style={{maxWidth:"62%"}}>{d.logoUrl&&<Image src={d.logoUrl} style={s.logo}/>}<Text style={[s.brand,{color}]}>{d.company}</Text>{d.template?.showSlogan!==false&&d.slogan&&<Text style={s.slogan}>{d.slogan}</Text>}{d.companyAddress&&<Text style={[s.muted,{marginTop:5}]}>{d.companyAddress}</Text>}{d.template?.showTaxId!==false&&d.taxId&&<Text style={s.muted}>NIF : {d.taxId}</Text>}{d.template?.showStatId!==false&&d.statId&&<Text style={s.muted}>STAT : {d.statId}</Text>}{d.template?.showRegistryId!==false&&d.registryId&&<Text style={s.muted}>RCS : {d.registryId}</Text>}</View><View style={{alignItems:"flex-end"}}><Text style={s.h1}>{d.type}</Text><Text style={{color}}>{d.number}</Text><Text>{d.issueDate}</Text>{d.dueDate&&<Text>{d.type==="DEVIS"?"Validité":"Échéance"} : {d.dueDate}</Text>}</View></View>
    <View style={{marginTop:20,marginBottom:16}}><Text style={s.muted}>Client</Text><Text style={{fontSize:13,fontWeight:700}}>{d.customer}</Text></View>
    <View style={[s.row,{backgroundColor:"#f8fafc",borderBottomColor:color}]}><Text style={s.desc}>Description</Text><Text style={s.qty}>Qté</Text><Text style={s.price}>Prix unitaire</Text>{showTax&&<Text style={s.tax}>Taxe</Text>}<Text style={s.num}>Total</Text></View>
    {d.lines.map((l,i)=><View style={s.row} key={i}><Text style={s.desc}>{l.description}</Text><Text style={s.qty}>{l.quantity}</Text><View style={s.price}><F v={l.unitPrice} c={d.currency}/></View>{showTax&&<Text style={s.tax}>{l.taxRate}%</Text>}<View style={s.num}><F v={l.total} c={d.currency}/></View></View>)}
    <View style={s.totals}><Text>Sous-total : {money(d.subtotal,d.currency)}</Text>{!!d.discountTotal&&<Text>Remises : -{money(d.discountTotal,d.currency)}</Text>}<Text>Taxes : {money(d.taxTotal,d.currency)}</Text><Text style={{fontSize:14,fontWeight:700,marginTop:5,color}}>Total : {money(d.total,d.currency)}</Text>{d.type==="FACTURE"&&typeof d.paidAmount==="number"&&d.paidAmount>0&&<><Text style={{marginTop:4}}>Déjà payé : {money(d.paidAmount,d.currency)}</Text><Text style={{fontWeight:700}}>Reste à payer : {money(d.balanceDue??Math.max(0,d.total-d.paidAmount),d.currency)}</Text></>}</View>
    {d.template?.showAmountInWords!==false&&<View style={s.words}><Text style={s.muted}>Montant en lettres</Text><Text>{prefix} {amountInWords(d.total,d.currency)}.</Text>{d.type==="FACTURE"&&typeof d.balanceDue==="number"&&d.balanceDue>0&&d.balanceDue<d.total&&<Text style={{marginTop:4}}>Solde restant dû : {amountInWords(d.balanceDue,d.currency)}.</Text>}</View>}
    {d.paymentTerms&&<View style={{marginTop:20}}><Text style={s.muted}>Conditions de paiement</Text><Text>{d.paymentTerms}</Text></View>}
    {d.template?.showBankDetails!==false&&d.bankDetails&&<View style={{marginTop:14}}><Text style={s.muted}>Coordonnées bancaires</Text><Text>{d.bankDetails}</Text></View>}
    {d.legalMentions&&<View style={{marginTop:14}}><Text style={s.muted}>{d.legalMentions}</Text></View>}
    {d.template?.footerText&&<Text fixed style={s.footer}>{d.template.footerText}</Text>}
  </Page></Document>
}
export async function renderPdf(d:PdfData){return renderToBuffer(<PdfDocument d={d}/>)}
