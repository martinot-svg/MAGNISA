import React from "react";
import { NextResponse } from "next/server";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { requireOrganization } from "@/lib/current-org";

const s=StyleSheet.create({page:{padding:36,fontSize:10,fontFamily:"Helvetica"},title:{fontSize:20,fontWeight:700,marginBottom:18},row:{flexDirection:"row",justifyContent:"space-between",paddingVertical:8,borderBottomWidth:.5,borderBottomColor:"#ddd"},label:{color:"#667085"},value:{fontWeight:700}});

function Report({company,currency,m}:{company:string;currency:string;m:any}){
  const f=(x:any)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency,maximumFractionDigits:2}).format(Number(x||0));
  const rows=[
    ["Chiffre d’affaires facturé",f(m.revenue)],
    ["Encaissements confirmés",f(m.receipts)],
    ["Charges payées",f(m.expenses)],
    ["Créances clients",f(m.receivables)],
    ["Trésorerie disponible",f(m.cash_available)],
    ["Factures en retard",String(m.overdue_invoice_count||0)]
  ];
  return React.createElement(Document,null,
    React.createElement(Page,{size:"A4",style:s.page},
      React.createElement(Text,{style:s.title},`Rapport de gestion — ${company}`),
      React.createElement(Text,{style:{marginBottom:16,color:'#667085'}},"Généré à partir des données réelles enregistrées dans MAGNISA."),
      ...rows.map(([a,b])=>React.createElement(View,{style:s.row,key:a},
        React.createElement(Text,{style:s.label},a),
        React.createElement(Text,{style:s.value},b)
      ))
    )
  );
}

export async function GET(){
  const {supabase,organizationId}=await requireOrganization();
  const [{data:m},{data:org}]=await Promise.all([
    supabase.rpc('dashboard_metrics',{p_org:organizationId}),
    supabase.from('organizations').select('name,currency').eq('id',organizationId).single()
  ]);
  const buffer=await renderToBuffer(Report({company:org?.name||'Entreprise',currency:org?.currency||'MGA',m:m||{}}));
  return new NextResponse(buffer as BodyInit,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="rapport-magnisa.pdf"'}});
}
