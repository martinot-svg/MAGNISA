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
  const h=React.createElement;
  const text=(value:string,style?:Record<string,unknown>)=>h(Text,{style},value);
  const pdf=await renderToBuffer(h(Document,null,h(Page,{size:"A4",style:{padding:theme.pageMargin,fontFamily:theme.fontFamily,fontSize:11,color:theme.textColor,backgroundColor:theme.backgroundColor}},
   text(company,{fontSize:20,fontWeight:700,color:theme.headingColor,marginBottom:12}),
   h(View,{style:{height:3,backgroundColor:theme.primaryColor,marginBottom:28}}),
   text("APERÇU DE STYLE - SANS DONNÉES MÉTIER",{fontSize:18,fontWeight:700,color:theme.headingColor}),
   text("Ce document est un aperçu des réglages non enregistrés. Il ne constitue ni une facture, ni un bulletin, ni un justificatif.",{marginTop:12,marginBottom:22}),
   h(View,{style:{backgroundColor:theme.tableHeaderColor,borderColor:theme.borderColor,borderWidth:1,padding:12}},text("EN-TÊTE DE TABLEAU")),
   h(View,{style:{borderBottomColor:theme.borderColor,borderBottomWidth:1,padding:12}},text("Aucune ligne métier chargée")),
   text("Police : "+theme.fontFamily+" - Style : "+theme.style,{marginTop:22,color:theme.secondaryColor}),
   ...(theme.showPageNumbers?[h(Text,{fixed:true,style:{position:"absolute",bottom:16,right:theme.pageMargin,fontSize:9},render:({pageNumber,totalPages}:{pageNumber:number;totalPages:number})=>pageNumber+" / "+totalPages})]:[])
  )));
  return new NextResponse(pdf as BodyInit,{headers:{"Content-Type":"application/pdf","Content-Disposition":"inline; filename=apercu-style-magnisa.pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch(e){return new NextResponse(e instanceof Error?e.message:"Aperçu indisponible",{status:400});}
}