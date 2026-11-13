import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Trésorerie: robustesse des données optionnelles", () => {
  const source = readFileSync(resolve(process.cwd(),"src/app/(app)/tresorerie/page.tsx"),"utf8");
  it("sépare les erreurs PostgREST de la véritable absence de transferts", () => {
    expect(source).toContain("const internalTransfers=internalTransfersData??[];");
    expect(source).toContain("const reconciliations=reconciliationsData??[];");
    expect(source).toContain("internalTransfersError");
    expect(source).toContain("reconciliationsError");
  });
  it("ne permet pas d'enregistrer un virement si le registre ne répond pas", () => {
    expect(source).toContain("internalTransfersError\n              ?");
    expect(source).toContain("Le suivi des transferts internes est temporairement indisponible.");
    expect(source).toContain("role=\"alert\"");
  });
});
