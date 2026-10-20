import React from "react";
import {Document,Page,Text,View,Image,StyleSheet} from "@react-pdf/renderer";
import {parseDocumentTheme} from "@/lib/document-theme";
import {formatDocumentAmount} from "@/lib/format-document-amount";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 18 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  label: { color: "#667085" },
  value: { fontWeight: 700 },
});

export function Report({ company, currency, m, themeInput, template, logoUrl }: { company: string; currency: string; m: any; logoUrl?:string|null; themeInput?:unknown; template?:{showLogo?:boolean;primaryColor?:string;fontFamily?:string;footerText?:string}; companyDetails?:{address?:string|null;phone?:string|null;email?:string|null;website?:string|null;tax_id?:string|null;stat_id?:string|null;registry_id?:string|null} }) {
  const theme=parseDocumentTheme(themeInput);
  const accent=template?.primaryColor&&/^#[0-9a-fA-F]{6}$/.test(template.primaryColor)?template.primaryColor:theme.primaryColor;
  const font=template?.fontFamily&&["Helvetica","Courier","Times-Roman"].includes(template.fontFamily)?template.fontFamily:theme.fontFamily;
  const format = (value: any) => formatDocumentAmount(Number(value || 0),{currency});

  const rows = [
    ["Chiffre d’affaires facturé", format(m.revenue)],
    ["Encaissements confirmés", format(m.receipts)],
    ["Charges payées", format(m.expenses)],
    ["Créances clients", format(m.receivables)],
    ["Trésorerie disponible", format(m.cash_available)],
    ["Factures en retard", String(m.overdue_invoice_count || 0)],
  ];

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: [s.page,{padding:theme.pageMargin,color:theme.textColor,backgroundColor:theme.backgroundColor,fontFamily:font}] },
      ...(logoUrl&&template?.showLogo!==false?[React.createElement(Image,{key:"company-logo",src:logoUrl,style:{width:theme.logoWidth,height:48,objectFit:"contain",alignSelf:theme.logoPosition==="center"?"center":theme.logoPosition==="right"?"flex-end":"flex-start",marginBottom:10}})]:[]),
      React.createElement(Text, { style: [s.title,{color:accent}] }, `Rapport de gestion — ${company}`),
      ...(companyDetails?.address?[React.createElement(Text,{key:"company-address",style:{fontSize:8,marginBottom:3,color:theme.secondaryColor}},companyDetails.address)]:[]),
      ...([companyDetails?.phone,companyDetails?.email,companyDetails?.website].filter(Boolean).length?[React.createElement(Text,{key:"company-contact",style:{fontSize:8,marginBottom:3,color:theme.secondaryColor}},[companyDetails?.phone,companyDetails?.email,companyDetails?.website].filter(Boolean).join(" | "))]:[]),
      ...([companyDetails?.tax_id,companyDetails?.stat_id,companyDetails?.registry_id].filter(Boolean).length?[React.createElement(Text,{key:"company-identifiers",style:{fontSize:8,marginBottom:8,color:theme.secondaryColor}},[companyDetails?.tax_id?`NIF : ${companyDetails.tax_id}`:"",companyDetails?.stat_id?`STAT : ${companyDetails.stat_id}`:"",companyDetails?.registry_id?`RCS : ${companyDetails.registry_id}`:""].filter(Boolean).join(" | "))]:[]),
      React.createElement(
        Text,
        { style: { marginBottom: 16, color: "#667085" } },
        "Généré à partir des données réelles enregistrées dans MAGNISA."
      ),
      ...rows.map(([label, value]) =>
        React.createElement(
          View,
          { style: s.row, key: label },
          React.createElement(Text, { style: s.label }, label),
          React.createElement(Text, { style: s.value }, value)
        )
      ),
      ...(template?.footerText?[React.createElement(Text,{key:"footer",style:{fontSize:8,marginTop:22,color:theme.secondaryColor}},template.footerText)]:[]),
      ...(theme.showPageNumbers?[React.createElement(Text,{key:"paging",fixed:true,style:{position:"absolute",bottom:16,right:theme.pageMargin,fontSize:8},render:({pageNumber,totalPages}:{pageNumber:number;totalPages:number})=>`${pageNumber} / ${totalPages}`})]:[])
    )
  );
}

