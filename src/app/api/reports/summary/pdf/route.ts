import React from "react";
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

function Report({ company, currency, m }: { company: string; currency: string; m: any }) {
  const format = (value: any) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));

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
      { size: "A4", style: s.page },
      React.createElement(Text, { style: s.title }, `Rapport de gestion — ${company}`),
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
      )
    )
  );
}

export async function GET() {
  const ctx = await requireOrganization();
  if (!(await hasPermission(ctx, "reports.export"))) {
    return new NextResponse("Accès interdit", { status: 403 });
  }

  const { supabase, organizationId } = ctx;
  const [{ data: m }, { data: org }] = await Promise.all([
    supabase.rpc("dashboard_metrics", { p_org: organizationId }),
    supabase.from("organizations").select("name,currency").eq("id", organizationId).single(),
  ]);

  const buffer = await renderToBuffer(
    Report({
      company: org?.name || "Entreprise",
      currency: org?.currency || "MGA",
      m: m || {},
    })
  );

  return new NextResponse(buffer as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="rapport-magnisa.pdf"',
    },
  });
}
