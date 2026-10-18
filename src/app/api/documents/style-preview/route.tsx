import React from "react";
import {NextResponse} from "next/server";
import {Document,Page,Text,View,renderToBuffer} from "@react-pdf/renderer";
import {requireOrganization} from "@/lib/current-org";
import {requirePermission} from "@/lib/permissions";
import {readDocumentThemeForm} from "@/lib/document-theme";

export async function POST(request:Request){
 try{
  const ctx=await requireOrganization();
  await requirePermission(ctx,"settings.manage");
  const form=await request.formData();
  const theme=readDocumentThemeForm(form);
  const {data:org}=await ctx.supabase.from("organizations").select("name").eq("id",ctx.organizationId).single();
  const {data:settings}=await ctx.supabase.from("company_settings").select("trade_name,legal_name").eq("organization_id",ctx.organizationId).maybeSingle();
  const company=settings?.trade_name||settings?.legal_name||org?.name||"Entreprise non renseignée";
  const pdf=await renderToBuffer(<Document><Page size="A4" style={{padding:theme.pageMargin,fontFamily:theme.fontFamily,fontSize:11,color:theme.textColor,backgroundColor:theme.backgroundColor}}>
   <Text style={{fontSize:20,fontWeight:700,color:theme.headingColor,marginBottom:12}}>{company}</Text>
   <View style={{height:3,backgroundColor:theme.primaryColor,marginBottom:28}}/>
   <Text style={{fontSize:18,fontWeight:700,color:theme.headingColor}}>APERÇU DE STYLE - SANS DONNÉES MÉTIER</Text>
   <Text style={{marginTop:12,marginBottom:22}}>Ce document est un aperçu des réglages non enregistrés. Il ne constitue ni une facture, ni un bulletin, ni un justificatif.</Text>
   <View style={{backgroundColor:theme.tableHeaderColor,borderColor:theme.borderColor,borderWidth:1,padding:12}}><Text>EN-TÊTE DE TABLEAU</Text></View>
   <View style={{borderBottomColor:theme.borderColor,borderBottomWidth:1,padding:12}}><Text>Aucune ligne métier chargée</Text></View>
   <Text style={{marginTop:22,color:theme.secondaryColor}}>Police : {theme.fontFamily} - Style : {theme.style}</Text>
   {theme.showPageNumbers&&<Text fixed style={{position:"absolute",bottom:16,right:theme.pageMargin,fontSize:9}} render={({pageNumber,totalPages})=>`${pageNumber} / ${totalPages}`}/>}
   </Page></Document>);
  return new NextResponse(pdf as BodyInit,{headers:{"Content-Type":"application/pdf","Content-Disposition":"inline; filename=apercu-style-magnisa.pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch(e){return new NextResponse(e instanceof Error?e.message:"Aperçu indisponible",{status:400});}
}