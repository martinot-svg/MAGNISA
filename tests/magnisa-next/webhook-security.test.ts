import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHmacWebhook } from "../../src/lib/magnisa-next/webhook-security";

const secret = "test-webhook-secret";
const timestamp = "1800000000";
const nowMs = Number(timestamp) * 1000;
const body = '{"type":"payment.succeeded","id":"evt_1"}';

function signature(rawBody = body, ts = timestamp) {
  return createHmac("sha256", secret).update(ts + "." + rawBody, "utf8").digest("hex");
}

describe("verifyHmacWebhook", () => {
  it("valide une signature correcte sur le corps brut", () => {
    expect(verifyHmacWebhook(body, "t=" + timestamp + ",v1=" + signature(), secret, nowMs))
      .toEqual({ valid: true, timestamp: Number(timestamp) });
  });

  it("rejette un corps modifié après la signature", () => {
    expect(verifyHmacWebhook(body + " ", "t=" + timestamp + ",v1=" + signature(), secret, nowMs))
      .toEqual({ valid: false, reason: "invalid_signature" });
  });

  it("rejette les signatures expirées", () => {
    const oldTimestamp = "1799999000";
    expect(verifyHmacWebhook(body, "t=" + oldTimestamp + ",v1=" + signature(body, oldTimestamp), secret, nowMs))
      .toEqual({ valid: false, reason: "stale_timestamp" });
  });

  it("rejette un header manquant ou mal formé", () => {
    expect(verifyHmacWebhook(body, null, secret, nowMs))
      .toEqual({ valid: false, reason: "missing_header" });
    expect(verifyHmacWebhook(body, "v1=bad", secret, nowMs))
      .toEqual({ valid: false, reason: "invalid_header" });
  });

  it("rejette un secret vide et un timestamp invalide", () => {
    expect(verifyHmacWebhook(body, "t=" + timestamp + ",v1=" + signature(), "", nowMs))
      .toEqual({ valid: false, reason: "invalid_secret" });
    expect(verifyHmacWebhook(body, "t=not-a-time,v1=" + signature(), secret, nowMs))
      .toEqual({ valid: false, reason: "invalid_timestamp" });
  });
});
