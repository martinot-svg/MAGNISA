import React from "react";
import {Document,Page,Text,View,StyleSheet,renderToBuffer,Image} from "@react-pdf/renderer";
import {amountInWords} from "@/lib/amount-in-words";
import {parseDocumentTheme} from "@/lib/document-theme";
import {formatDocumentAmount} from "@/lib/format-document-amount";
const s=StyleSheet.create({
 page:{padding:34,fontSize:9.5,color:"#172033"},head:{flexDirection:"row",justifyContent:"space-between",paddingBottom:14,borderBottomWidth:1.4},
 brand:{fontSize:18,fontWeight:700},slogan:{fontSize:8,color:"#667085",marginTop:3},h1:{fontSize:16,fontWeight:700},
 row:{flexDirection:"row",borderBottomWidth:.5,borderBottomColor:"#d9dee7",paddingVertical:7},
 desc:{flexGrow:1,flexShrink:1},qty:{width:"9%",textAlign:"right"},price:{width:"17%",textAlign:"right"},tax:{width:"9%",textAlign:"right"},num:{width:"17%",textAlign:"right"},
 totals:{marginTop:18,alignItems:"flex-end"},muted:{color:"#667085"},logo:{width:76,height:46,objectFit:"contain",marginBottom:5},
 words:{marginTop:18,paddingTop:12,borderTopWidth:.6,borderTopColor:"#d9dee7",lineHeight:1.45},footer:{position:"absolute",left:34,right:34,bottom:20,textAlign:"center",color:"#667085",fontSize:7.5}
});
export type PdfData={
 theme?:unknown;
 type:"DEVIS"|"FACTURE";number:string;company:string;slogan?:string|null;companyAddress?:string|null;logoUrl?:string|null;taxId?:string|null;statId?:string|null;registryId?:string|null;bankDetails?:string|null;
 customer:string;issueDate:string;dueDate?:string|null;lines:Array<{description:string;quantity:number;unitPrice:number;discountPct:number;taxRate:number;total:number}>;subtotal:number;discountTotal?:number;taxTotal:number;total:number;paidAmount?:number;balanceDue?:number;
 currency:string;paymentTerms?:string|null;legalMentions?:string|null;
 template?:{primaryColor?:string;secondaryColor?:string;fontFamily?:string;headerText?:string;footerText?:string;showLogo?:boolean;showTaxId?:boolean;showBankDetails?:boolean;showSlogan?:boolean;showAmountInWords?:boolean;amountWordsPrefix?:string;showStatId?:boolean;showRegistryId?:boolean;showTaxColumn?:boolean;amountDisplayMode?:"ht"|"ttc"|"both"|"none";selectedPresetId?:string}
};
function money(v:number,c:string){return formatDocumentAmount(v,{currency:c})}
function F({v,c}:{v:number;c:string}){return <Text>{money(v,c)}</Text>}
function lineHT(l:PdfData["lines"][number]){const gross=Math.round(l.quantity*l.unitPrice*100)/100;const discount=Math.round(gross*l.discountPct)/100;return Math.round((gross-discount)*100)/100}
export function PdfDocument({d}:{d:PdfData}){
 const base=parseDocumentTheme(d.theme),canvaCommercial=d.type==="FACTURE"&&d.template?.selectedPresetId==="invoice-canva-commercial-gris";
 const color=d.template?.primaryColor||base.primaryColor,font=d.template?.fontFamily||base.fontFamily;
 const showTax=!canvaCommercial&&d.template?.showTaxColumn!==false;
 const lineColor=canvaCommercial?"#d0d2d4":base.borderColor,tableHeaderColor=canvaCommercial?"#e8e9ea":base.tableHeaderColor;
 const mode=d.template?.amountDisplayMode||"both",showAmounts=mode!=="none";
 const prefix=d.template?.amountWordsPrefix||(d.type==="FACTURE"?"Arrêtée la présente facture à la somme de :":"Arrêté le présent devis à la somme de :");
 const wordAmount=mode==="ht"?d.subtotal:d.total;
 return <Document><Page size="A4" style={[s.page,{fontFamily:font,padding:base.pageMargin,color:base.textColor,backgroundColor:base.backgroundColor}]}>
  {d.template?.headerText&&<Text style={[s.muted,{marginBottom:8}]}>{d.template.headerText}</Text>}
  <View style={[s.head,{borderBottomColor:canvaCommercial?"#5b6066":base.borderColor,borderBottomWidth:canvaCommercial?2:1.4,paddingBottom:canvaCommercial?18:14}]}>
   <View style={{maxWidth:"62%"}}>{d.logoUrl&&d.template?.showLogo!==false&&<Image src={d.logoUrl} style={[s.logo,{width:base.logoWidth,objectFit:"contain",alignSelf:base.logoPosition==="center"?"center":base.logoPosition==="right"?"flex-end":"flex-start"}]}/>}<Text style={[s.brand,{color:canvaCommercial?"#42464a":base.headingColor,fontSize:canvaCommercial?19:18}]}>{d.company}</Text>{d.template?.showSlogan!==false&&d.slogan&&<Text style={s.slogan}>{d.slogan}</Text>}{d.companyAddress&&<Text style={[s.muted,{marginTop:5}]}>{d.companyAddress}</Text>}{d.template?.showTaxId!==false&&d.taxId&&<Text style={s.muted}>NIF : {d.taxId}</Text>}{d.template?.showStatId!==false&&d.statId&&<Text style={s.muted}>STAT : {d.statId}</Text>}{d.template?.showRegistryId!==false&&d.registryId&&<Text style={s.muted}>RCS : {d.registryId}</Text>}</View>
   <View style={{alignItems:"flex-end"}}><Text style={[s.h1,{color:canvaCommercial?"#5b6066":undefined,fontSize:canvaCommercial?18:16}]}>{d.type}</Text><Text style={{color}}>{d.number}</Text><Text>{d.issueDate}</Text>{d.dueDate&&<Text>{d.type==="DEVIS"?"Validité":"Échéance"} : {d.dueDate}</Text>}</View>
  </View>
  <View style={{marginTop:20,marginBottom:16}}><Text style={s.muted}>Client</Text><Text style={{fontSize:13,fontWeight:700}}>{d.customer}</Text></View>
  <View style={[s.row,{backgroundColor:tableHeaderColor,borderBottomColor:lineColor,borderTopWidth:canvaCommercial?0.8:0,borderTopColor:lineColor,paddingVertical:canvaCommercial?9:7}]}>
   <Text style={[s.desc,{width:mode==="both"?"25%":showAmounts?"43%":"82%"}]}>Description</Text><Text style={s.qty}>Qté</Text>
   {showAmounts&&<><Text style={s.price}>{mode==="ttc"?"PU TTC":"PU HT"}</Text>{showTax&&<Text style={s.tax}>Taxe</Text>}{mode==="both"?<><Text style={s.num}>Total HT</Text><Text style={s.num}>Total TTC</Text></>:<Text style={s.num}>{mode==="ht"?"Total HT":"Total TTC"}</Text>}</>}
  </View>
  {d.lines.map((l,i)=>{const ht=lineHT(l),ttc=l.total,unit=mode==="ttc"?l.unitPrice*(1+l.taxRate/100):l.unitPrice;return <View style={[s.row,{borderBottomColor:lineColor,paddingVertical:canvaCommercial?9:7,backgroundColor:canvaCommercial&&i%2===1?"#f7f7f7":"#ffffff"}]} key={i}>
   <Text style={[s.desc,{width:mode==="both"?"25%":showAmounts?"43%":"82%"}]}>{l.description}</Text><Text style={s.qty}>{formatDocumentAmount(l.quantity)}</Text>
   {showAmounts&&<><View style={s.price}><F v={unit} c={d.currency}/></View>{showTax&&<Text style={s.tax}>{formatDocumentAmount(l.taxRate)}%</Text>}{mode==="both"?<><View style={s.num}><F v={ht} c={d.currency}/></View><View style={s.num}><F v={ttc} c={d.currency}/></View></>:<View style={s.num}><F v={mode==="ht"?ht:ttc} c={d.currency}/></View>}</>}
  </View>})}
  {showAmounts&&<View style={s.totals}>
   {(mode==="ht"||mode==="both")&&<Text>Total HT : {money(d.subtotal,d.currency)}</Text>}
   {mode==="both"&&!!d.discountTotal&&<Text>Remises : -{money(d.discountTotal,d.currency)}</Text>}
   {mode==="both"&&<Text>TVA : {money(d.taxTotal,d.currency)}</Text>}
   {(mode==="ttc"||mode==="both")&&<Text style={{fontSize:canvaCommercial?15:14,fontWeight:700,marginTop:5,color:canvaCommercial?"#4e5256":base.primaryColor,borderTopWidth:canvaCommercial?1:0,borderTopColor:lineColor,paddingTop:canvaCommercial?6:0}}>Total TTC : {money(d.total,d.currency)}</Text>}
   {d.type==="FACTURE"&&(mode==="ttc"||mode==="both")&&typeof d.paidAmount==="number"&&d.paidAmount>0&&<><Text style={{marginTop:4}}>Déjà payé : {money(d.paidAmount,d.currency)}</Text><Text style={{fontWeight:700}}>Reste à payer : {money(d.balanceDue??Math.max(0,d.total-d.paidAmount),d.currency)}</Text></>}
  </View>}
  {showAmounts&&d.template?.showAmountInWords!==false&&<View style={[s.words,{borderTopColor:lineColor}]}><Text style={s.muted}>Montant en lettres</Text><Text>{prefix} {amountInWords(wordAmount,d.currency)}.</Text>{d.type==="FACTURE"&&(mode==="ttc"||mode==="both")&&typeof d.balanceDue==="number"&&d.balanceDue>0&&d.balanceDue<d.total&&<Text style={{marginTop:4}}>Solde restant dû : {amountInWords(d.balanceDue,d.currency)}.</Text>}</View>}
  {d.paymentTerms&&<View style={{marginTop:20}}><Text style={s.muted}>Conditions de paiement</Text><Text>{d.paymentTerms}</Text></View>}
  {d.template?.showBankDetails!==false&&d.bankDetails&&<View style={{marginTop:14}}><Text style={s.muted}>Coordonnées bancaires</Text><Text>{d.bankDetails}</Text></View>}
  {d.legalMentions&&<View style={{marginTop:14}}><Text style={s.muted}>{d.legalMentions}</Text></View>}
  {d.template?.footerText&&<Text fixed style={s.footer}>{d.template.footerText}</Text>}{base.showPageNumbers&&<Text fixed style={{position:"absolute",bottom:16,right:base.pageMargin,fontSize:8,color:base.secondaryColor}} render={({pageNumber,totalPages})=>`${pageNumber} / ${totalPages}`}/>}
 </Page></Document>;
}
export async function renderPdf(d:PdfData){return renderToBuffer(PdfDocument({d}))}
