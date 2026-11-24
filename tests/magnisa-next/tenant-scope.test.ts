import { describe, expect, it } from "vitest";
import { assertSameOrganization } from "../../src/lib/magnisa-next/tenant-scope";

describe("tenant scope", () => {
  it("accepte une ressource du tenant actif", () => {
    expect(() => assertSameOrganization("org-a", "org-a")).not.toThrow();
  });

  it("refuse une ressource d'un autre tenant", () => {
    expect(() => assertSameOrganization("org-a", "org-b")).toThrow();
  });
});
