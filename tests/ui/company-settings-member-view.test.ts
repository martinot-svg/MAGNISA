import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const memberReadFiles = [
  "src/app/(app)/factures/page.tsx",
  "src/app/(app)/factures/nouvelle/page.tsx",
  "src/lib/payroll/payslip-document.ts",
  "src/lib/accounting/fiscal-statements.ts",
  "src/app/api/reports/summary/pdf/route.ts",
  "src/app/api/documents/style-preview/route.ts",
  "src/app/api/documents/[type]/[id]/pdf/route.ts",
  "src/app/api/documents/[type]/[id]/email/route.ts",
  "src/app/(app)/modeles-documents/page.tsx",
  "src/app/(app)/identite-documents/page.tsx",
  "src/app/(app)/parametres/page.tsx",
  "src/server/actions/company-onboarding.ts",
];

describe("company settings member read model", () => {
  it("routes application reads through the permission-aware view", () => {
    for (const path of memberReadFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain('from("company_settings_member_view")');
    }
  });

  it("keeps mutations on the protected base table", () => {
    const onboarding = readFileSync("src/server/actions/company-onboarding.ts", "utf8");
    const settings = readFileSync("src/app/(app)/parametres/page.tsx", "utf8");
    const identity = readFileSync("src/app/(app)/identite-documents/page.tsx", "utf8");

    expect(onboarding).toContain('from("company_settings").update');
    expect(settings).toContain('from("company_settings").upsert');
    expect(identity).toContain('from("company_settings").upsert');
  });
});
