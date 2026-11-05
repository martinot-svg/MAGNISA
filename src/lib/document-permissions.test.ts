import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PERMISSIONS,
  assertDocumentAction,
  canDocumentAction,
  roleDocumentPermission,
  roleDocumentScope,
} from "./document-permissions";

describe("Règles documentaires : refus par défaut", () => {
  it("déclare exactement 17 permissions distinctes", () => {
    expect(new Set(DOCUMENT_PERMISSIONS).size).toBe(17);
  });

  it("sépare la paie des rôles financiers et commerciaux", () => {
    for (const role of [
      "finance_manager", "accountant", "director", "sales",
      "cashier", "auditor", "viewer", "employee",
    ]) {
      expect(roleDocumentScope(role, "payslip")).toBe(false);
    }
  });

  it("réserve le périmètre des bulletins à la RH, au propriétaire et à l'administrateur", () => {
    expect(roleDocumentScope("hr", "payslip")).toBe(true);
    expect(roleDocumentScope("owner", "payslip")).toBe(true);
    expect(roleDocumentScope("admin", "payslip")).toBe(true);
    expect(roleDocumentScope("hr", "invoice")).toBe(false);
  });

  it("n'accorde pas la publication aux employés, auditeurs ou lecteurs", () => {
    for (const role of ["employee", "auditor", "viewer", "sales"]) {
      expect(roleDocumentPermission(role, "templates.publish")).toBe(false);
    }
  });

  it("refuse les rôles inconnus", () => {
    expect(roleDocumentScope("superadmin", "invoice")).toBe(false);
    expect(roleDocumentPermission("unknown", "documents.export")).toBe(false);
  });

  it("refuse un périmètre interdit sans requête réseau", async () => {
    const ctx = {
      organizationId: "org_A",
      role: "accountant",
      supabase: { from: () => { throw new Error("query not expected"); } },
    };
    await expect(canDocumentAction(ctx, "documents.export", "payslip")).resolves.toBe(false);
  });

  it("respecte les refus explicitement enregistrés", async () => {
    const query: any = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: { allowed: false }, error: null }),
    };
    const ctx = {
      organizationId: "org_A",
      role: "owner",
      user: { id: "user_A" },
      supabase: { from: () => query },
    };
    await expect(canDocumentAction(ctx, "documents.export", "invoice")).resolves.toBe(false);
  });

  it("signale une erreur de lecture des permissions de rôle", async () => {
    const query: any = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: null, error: new Error("database unavailable") }),
    };
    const ctx = { organizationId: "org_A", role: "owner", supabase: { from: () => query } };
    await expect(canDocumentAction(ctx, "documents.export", "invoice"))
      .rejects.toThrow("Échec de contrôle des droits documentaires.");
  });

  it("assertDocumentAction refuse explicitement une action interdite", async () => {
    const ctx = {
      organizationId: "org_A",
      role: "viewer",
      supabase: { from: () => { throw new Error("query not expected"); } },
    };
    await expect(assertDocumentAction(ctx, "documents.export", "invoice"))
      .rejects.toThrow("Accès documentaire refusé.");
  });
});
