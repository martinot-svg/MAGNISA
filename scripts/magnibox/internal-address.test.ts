import { describe, expect, it } from "vitest";
import { MagniboxSyncError } from "./imap-sync-core";
import {
  formatMagniboxInternalAddress,
  isMagniboxInternalAddress,
} from "./internal-address";

describe("MAGNIBOX internal address convention", () => {
  it("builds a private address from the canonical mailbox local part and org namespace", () => {
    expect(formatMagniboxInternalAddress({
      localPart: "finance.team",
      namespaceSlug: "acme-finance",
    })).toBe("finance.team@acme-finance.mgmail");
  });

  it("recognizes only addresses in the private .mgmail namespace", () => {
    expect(isMagniboxInternalAddress("alice@acme.mgmail")).toBe(true);
    expect(isMagniboxInternalAddress("alice@gmail.com")).toBe(false);
    expect(isMagniboxInternalAddress("alice@acme.mgmail.evil.test")).toBe(false);
    expect(isMagniboxInternalAddress("Alice@acme.mgmail")).toBe(false);
  });

  it("rejects invalid local parts and namespace slugs", () => {
    for (const input of [
      { localPart: "Alice", namespaceSlug: "acme" },
      { localPart: "alice\r\nBcc:evil@example.com", namespaceSlug: "acme" },
      { localPart: "alice", namespaceSlug: "Acme" },
      { localPart: "alice", namespaceSlug: "a" },
    ]) {
      expect(() => formatMagniboxInternalAddress(input)).toThrow(MagniboxSyncError);
    }
  });
});
