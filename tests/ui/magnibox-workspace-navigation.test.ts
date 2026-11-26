import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("MAGNIBOX workspace information architecture", () => {
  it("provides a dedicated secondary navigation for the six workspaces", () => {
    const navigation = read("src/components/magnibox-navigation.tsx");
    for (const route of ["", "/messagerie", "/boites", "/courrier", "/agenda", "/administration"]) {
      expect(navigation).toContain("/orbit/magnibox" + route);
    }
    expect(navigation).toContain("aria-current");
  });

  it("uses live tenant-scoped counts and never substitutes sample metrics", () => {
    const dashboard = read("src/app/(app)/orbit/magnibox/page.tsx");
    expect(dashboard).toContain('.eq("organization_id",ctx.organizationId)');
    expect(dashboard).toContain('count:"exact"');
    expect(dashboard).toContain('events.error?"—"');
    expect(dashboard).not.toMatch(/\b(fake|mock|demo|sample)\b/i);
  });

  it("keeps administration behind the existing users.manage permission", () => {
    const administration = read("src/app/(app)/orbit/magnibox/administration/page.tsx");
    expect(administration).toContain('hasPermission(ctx,"users.manage")');
    expect(administration).toContain("Accès réservé");
  });

  it("preserves existing internal and Internet messaging services", () => {
    const messaging = read("src/app/(app)/orbit/magnibox/messagerie/page.tsx");
    expect(messaging).toContain("MagniboxInternalContent");
    expect(messaging).toContain("MagniboxInternetWorkspace");
    expect(read("src/app/(app)/orbit/inbox/page.tsx")).toContain("../magnibox/page");
  });
});
