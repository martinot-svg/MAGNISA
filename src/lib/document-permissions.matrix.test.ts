import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PERMISSIONS,
  canDocumentAction,
  roleDocumentPermission,
  roleDocumentScope,
} from "./document-permissions";

const roles = [
  "owner", "admin", "director", "finance_manager", "accountant",
  "sales", "cashier", "hr", "auditor", "employee", "viewer",
] as const;
const scopes = ["quote", "invoice", "payslip", "report"] as const;

function createSupabase(roleAllowed: boolean | null = null, userAllowed: boolean | null = null) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const allowed = table === "role_permissions" ? roleAllowed : userAllowed;
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: allowed === null ? null : { allowed },
          error: null,
        }),
      };
      return query;
    },
  };
}

describe("Matrice documentaire exhaustive", () => {
  it("couvre chaque combinaison rôle, périmètre et permission", async () => {
    for (const role of roles) {
      for (const scope of scopes) {
        for (const permission of DOCUMENT_PERMISSIONS) {
          const supabase = createSupabase();
          const allowed = await canDocumentAction(
            { organizationId: "org_A", role, user: { id: "user_A" }, supabase },
            permission,
            scope,
          );
          expect(allowed).toBe(
            roleDocumentScope(role, scope) && roleDocumentPermission(role, permission),
          );
          if (!roleDocumentScope(role, scope)) {
            expect(supabase.calls).toEqual([]);
          }
        }
      }
    }
  });

  it("une exception positive ne contourne pas une interdiction du rôle", async () => {
    const supabase = createSupabase(null, true);
    const allowed = await canDocumentAction(
      { organizationId: "org_A", role: "viewer", user: { id: "user_A" }, supabase },
      "documents.export",
      "invoice",
    );
    expect(allowed).toBe(false);
  });

  it("un refus individuel prévaut sur les droits du propriétaire", async () => {
    const supabase = createSupabase(null, false);
    const allowed = await canDocumentAction(
      { organizationId: "org_A", role: "owner", user: { id: "user_A" }, supabase },
      "documents.export",
      "invoice",
    );
    expect(allowed).toBe(false);
    expect(supabase.calls).toEqual(["role_permissions", "user_document_permissions"]);
  });

  it("un refus de rôle prévaut sur un éventuel droit individuel", async () => {
    const supabase = createSupabase(false, true);
    const allowed = await canDocumentAction(
      { organizationId: "org_A", role: "owner", user: { id: "user_A" }, supabase },
      "documents.export",
      "invoice",
    );
    expect(allowed).toBe(false);
    expect(supabase.calls).toEqual(["role_permissions"]);
  });
});
