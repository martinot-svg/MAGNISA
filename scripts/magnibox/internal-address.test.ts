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
    })).toBe("finance.team@acme-finance.magnibox");
  });

  it("accepts the maximum address length allowed by the schema", () => {
    const address = formatMagniboxInternalAddress({
      localPart: "a" + "b".repeat(63),
      namespaceSlug: "a" + "b".repeat(44),
    });
    expect(address).toHaveLength(119);
    expect(isMagniboxInternalAddress(address)).toBe(true);
  });

  it("recognizes only addresses in the private .magnibox namespace", () => {
    expect(isMagniboxInternalAddress("alice@acme.magnibox")).toBe(true);
    expect(isMagniboxInternalAddress("alice@gmail.com")).toBe(false);
    expect(isMagniboxInternalAddress("alice@acme.magnibox.evil.test")).toBe(false);
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
