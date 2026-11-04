import { describe, expect, it } from "vitest";
import { getCronAuthorizationError } from "./cron-auth";

describe("getCronAuthorizationError", () => {
  it("fails closed when CRON_SECRET is missing", () => {
    expect(getCronAuthorizationError(undefined, null)).toBe(503);
  });

  it("rejects a missing authorization header", () => {
    expect(getCronAuthorizationError("configured-secret", null)).toBe(401);
  });

  it("rejects an incorrect bearer token", () => {
    expect(getCronAuthorizationError("configured-secret", "Bearer wrong-secret")).toBe(401);
  });

  it("accepts the exact configured bearer token", () => {
    expect(getCronAuthorizationError("configured-secret", "Bearer configured-secret")).toBeNull();
  });
});
