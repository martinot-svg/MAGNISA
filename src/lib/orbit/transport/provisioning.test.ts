import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isMagniboxProvisioningSnapshot,
  signMagniboxProvisioningResponse,
  verifyMagniboxProvisioningRequest,
} from "./provisioning";

const secret = "magnibox-provisioning-test-secret-at-least-thirty-two";
describe("Magnibox signed recipient provisioning contract", () => {
  it("authenticates only fresh exact request bytes", () => {
    const body = "{}";
    const timestamp = "1800000000";
    const signature = "sha256=" + createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
    expect(verifyMagniboxProvisioningRequest(body, timestamp, signature, secret, 1800000000000)).toBe(true);
    expect(verifyMagniboxProvisioningRequest(body + " ", timestamp, signature, secret, 1800000000000)).toBe(false);
    expect(verifyMagniboxProvisioningRequest(body, timestamp, signature, secret, 1800000400000)).toBe(false);
    expect(verifyMagniboxProvisioningRequest(body, timestamp, signature, "short", 1800000000000)).toBe(false);
  });

  it("signs the exact response body with the same timestamped HMAC contract", () => {
    const body = '{"domains":["example.net"],"recipients":["info@example.net"]}';
    const timestamp = "1800000000";
    const expected = "sha256=" + createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
    expect(signMagniboxProvisioningResponse(body, timestamp, secret)).toBe(expected);
  });

  it("accepts only a bounded-shape signed snapshot payload", () => {
    const valid = {
      generatedAt: "2026-11-15T00:00:00.000Z",
      domains: ["example.net"],
      recipients: ["info@example.net"],
      revision: "a".repeat(64),
    };
    expect(isMagniboxProvisioningSnapshot(valid)).toBe(true);
    expect(isMagniboxProvisioningSnapshot({ ...valid, revision: "bad" })).toBe(false);
    expect(isMagniboxProvisioningSnapshot({ ...valid, recipients: [4] })).toBe(false);
  });
});
