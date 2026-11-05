import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  role: "viewer",
  organizationId: "org-a",
  calls: [] as string[],
}));

vi.mock("@/lib/current-org", () => ({
  requireOrganization: async () => ({
    organizationId: fixture.organizationId,
    role: fixture.role,
    user: { id: "member-a" },
    supabase: {
      from: (table: string) => {
        fixture.calls.push(table);
        const query: any = {
          select: () => query,
          eq: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { name: "QA", currency: "MGA" }, error: null }),
        };
        return query;
      },
    },
  }),
}));

vi.mock("@/lib/permissions", () => ({
  hasPermission: async () => true,
  requirePermission: async () => undefined,
}));

vi.mock("@/lib/payroll/payslip-document", () => ({
  loadPayslip: async () => ({
    ctx: {
      organizationId: fixture.organizationId,
      role: fixture.role,
      user: { id: "member-a" },
      supabase: { from: () => { throw new Error("query not expected for viewer"); } },
    },
    slip: { status: "validated" },
    data: { number: "QA-BPA" },
    email: "employee@example.test",
  }),
}));

import { GET as commercialPdf } from "./[type]/[id]/pdf/route";
import { POST as commercialEmail } from "./[type]/[id]/email/route";
import { GET as payslipPdf } from "../payroll/payslips/[id]/pdf/route";
import { GET as reportPdf } from "../reports/summary/pdf/route";

describe("Protection des exports documentaires", () => {
  beforeEach(() => {
    fixture.role = "viewer";
    fixture.calls = [];
  });

  it("refuse le PDF commercial pour un rôle lecteur", async () => {
    const response = await commercialPdf(new Request("https://magnisa.test"), {
      params: Promise.resolve({ type: "invoice", id: "invoice-a" }),
    });
    expect(response.status).toBe(403);
    expect(fixture.calls).toEqual([]);
  });

  it("refuse l'envoi e-mail commercial pour un rôle lecteur", async () => {
    const request = new Request("https://magnisa.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "client@example.test", subject: "Facture", body: "Bonjour" }),
    });
    const response = await commercialEmail(request as any, {
      params: Promise.resolve({ type: "invoice", id: "invoice-a" }),
    });
    expect(response.status).toBe(403);
    expect(fixture.calls).toEqual([]);
  });

  it("refuse le PDF de paie pour un rôle lecteur", async () => {
    const response = await payslipPdf(new Request("https://magnisa.test"), {
      params: Promise.resolve({ id: "payslip-a" }),
    });
    expect(response.status).toBe(403);
  });

  it("refuse le PDF de rapport pour un rôle lecteur", async () => {
    const response = await reportPdf();
    expect(response.status).toBe(403);
    expect(fixture.calls).toEqual([]);
  });

  it("ne révèle pas une facture appartenant à une autre organisation", async () => {
    fixture.role = "accountant";
    const response = await commercialPdf(new Request("https://magnisa.test"), {
      params: Promise.resolve({ type: "invoice", id: "foreign-invoice" }),
    });
    expect(response.status).toBe(404);
    expect(fixture.calls).toContain("invoices");
  });

  it("rejette un type de document commercial inconnu avant tout accès aux données", async () => {
    const response = await commercialPdf(new Request("https://magnisa.test"), {
      params: Promise.resolve({ type: "payslip", id: "document-a" }),
    });
    expect(response.status).toBe(400);
    expect(fixture.calls).toEqual([]);
  });
});
