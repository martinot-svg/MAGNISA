import {Report} from "@/lib/pdf/report";
import {canDocumentAction} from "@/lib/document-permissions";
import React from "react";
import {parseDocumentTheme} from "@/lib/document-theme";
import {formatDocumentAmount} from "@/lib/format-document-amount";
import { NextResponse } from "next/server";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";

export async function GET() {
  const ctx = await requireOrganization();
  if (!(await hasPermission(ctx, "reports.export")) || !(await canDocumentAction(ctx,"documents.export","report"))) {
    return new NextResponse("Accès interdit", { status: 403 });
  }

  const { supabase, organizationId } = ctx;
  const [{ data: m }, { data: org }, {data:settings},{data:template}] = await Promise.all([
    supabase.rpc("dashboard_metrics", { p_org: organizationId }),
    supabase.from("organizations").select("name,currency").eq("id", organizationId).single(),
    supabase.from("company_settings").select("trade_name,legal_name,slogan,address,phone,email,website,tax_id,stat_id,registry_id,bank_details,legal_mentions,document_theme,logo_url").eq("organization_id",organizationId).maybeSingle(),
    supabase.from("document_templates").select("configuration").eq("organization_id",organizationId).eq("document_type","report").eq("is_default",true).limit(1).maybeSingle(),
  ]);

  const buffer = await renderToBuffer(
    Report({
      company: settings?.trade_name || settings?.legal_name || org?.name || "Entreprise",
      currency: org?.currency || "MGA",
      m: m || {},themeInput:settings?.document_theme,template:template?.configuration,logoUrl:settings?.logo_url,companyDetails:settings||undefined,
    })
  );

  return new NextResponse(buffer as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="rapport-magnisa.pdf"',
    },
  });
}
