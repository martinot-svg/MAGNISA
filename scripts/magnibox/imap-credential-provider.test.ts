import { describe, expect, it } from "vitest";
import {
  MagniboxCredentialError,
  validateMagniboxCredentialScope,
  validateMagniboxImapCredentials,
  type MagniboxImapConnectionCredentials,
} from "./imap-credential-provider";

const valid: MagniboxImapConnectionCredentials = {
  host: "imap.internal",
  port: 993,
  secure: true,
  username: "mailbox-123",
  password: "test-secret",
};

describe("MAGNIBOX IMAP credential boundary", () => {
  it("accepts a valid TLS connection configuration", () => {
    expect(() => validateMagniboxImapCredentials(valid)).not.toThrow();
  });

  it("rejects unsafe or malformed connection settings without echoing secrets", () => {
    for (const candidate of [
      { ...valid, host: "imap.internal/path" },
      { ...valid, port: 70000 },
      { ...valid, secure: "yes" },
      { ...valid, username: " " },
      { ...valid, password: "" },
    ]) {
      try {
        validateMagniboxImapCredentials(candidate as MagniboxImapConnectionCredentials);
        throw new Error("Expected validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(MagniboxCredentialError);
        expect((error as Error).message).not.toContain("test-secret");
      }
    }
  });

  it("requires both tenant and mailbox scope", () => {
    expect(() => validateMagniboxCredentialScope({
      organizationId: "org-1",
      mailboxId: "mailbox-1",
    })).not.toThrow();
    expect(() => validateMagniboxCredentialScope({
      organizationId: "org-1",
      mailboxId: " ",
    })).toThrow(MagniboxCredentialError);
  });
});
