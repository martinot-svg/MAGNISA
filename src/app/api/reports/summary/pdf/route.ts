import {canDocumentAction} from "@/lib/document-permissions";
import React from "react";
import {parseDocumentTheme} from "@/lib/document-theme";
import {formatDocumentAmount} from "@/lib/format-document-amount";
import { NextResponse } from "next/server";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";

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

export function Report({ company, currency, m, themeInput, template }: { company: string; currency: string; m: any; themeInput?:unknown; template?:{primaryColor?:string;fontFamily?:string;footerText?:string} }) {
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
      React.createElement(Text, { style: [s.title,{color:accent}] }, `Rapport de gestion — ${company}`),
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

export async function GET() {
  const ctx = await requireOrganization();
  if (!(await hasPermission(ctx, "reports.export")) || !(await canDocumentAction(ctx,"documents.export","report"))) {
    return new NextResponse("Accès interdit", { status: 403 });
  }

  const { supabase, organizationId } = ctx;
  const [{ data: m }, { data: org }, {data:settings},{data:template}] = await Promise.all([
    supabase.rpc("dashboard_metrics", { p_org: organizationId }),
    supabase.from("organizations").select("name,currency").eq("id", organizationId).single(),
    supabase.from("company_settings").select("document_theme").eq("organization_id",organizationId).maybeSingle(),
    supabase.from("document_templates").select("configuration").eq("organization_id",organizationId).eq("document_type","report").eq("is_default",true).limit(1).maybeSingle(),
  ]);

  const buffer = await renderToBuffer(
    Report({
      company: org?.name || "Entreprise",
      currency: org?.currency || "MGA",
      m: m || {},themeInput:settings?.document_theme,template:template?.configuration,
    })
  );

  return new NextResponse(buffer as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="rapport-magnisa.pdf"',
    },
  });
}
