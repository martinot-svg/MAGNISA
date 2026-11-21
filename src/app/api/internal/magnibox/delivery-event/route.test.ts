import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: fixture.rpc }),
}));

import { POST } from "./route";

const SECRET = "delivery-event-test-secret-with-at-least-32-characters";
const NOW = Math.floor(Date.now() / 1000);

function signedRequest(payload: unknown, options: { signature?: string; timestamp?: string; contentLength?: string } = {}) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const timestamp = options.timestamp ?? String(NOW);
  const signature = options.signature ?? "sha256=" + createHmac("sha256", SECRET)
    .update(timestamp + "." + raw).digest("hex");
  const headers = new Headers({
    "content-type": "application/json",
    "x-magnibox-timestamp": timestamp,
    "x-magnibox-signature": signature,
  });
  if (options.contentLength) headers.set("content-length", options.contentLength);
  return new Request("https://magnisa.test/api/internal/magnibox/delivery-event", {
    method: "POST", headers, body: raw,
  });
}

describe("MAGNIBOX signed delivery-event route", () => {
  beforeEach(() => {
    vi.stubEnv("MAGNIBOX_EXTERNAL_MAIL_ENABLED", "true");
    vi.stubEnv("MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET", SECRET);
    fixture.rpc.mockReset().mockResolvedValue({ data: "updated", error: null });
  });

  it("fails closed while external mail is disabled or the secret is absent", async () => {
    vi.stubEnv("MAGNIBOX_EXTERNAL_MAIL_ENABLED", "false");
    const disabled = await POST(signedRequest({ queueId: "ABC123DEF", event: "accepted" }) as never);
    expect(disabled.status).toBe(503);
    vi.stubEnv("MAGNIBOX_EXTERNAL_MAIL_ENABLED", "true");
    vi.stubEnv("MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET", "");
    const noSecret = await POST(signedRequest({ queueId: "ABC123DEF", event: "accepted" }) as never);
    expect(noSecret.status).toBe(503);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures and expired timestamps before database access", async () => {
    const invalid = await POST(signedRequest(
      { queueId: "ABC123DEF", event: "accepted" }, { signature: "sha256=" + "0".repeat(64) },
    ) as never);
    expect(invalid.status).toBe(401);
    const expired = await POST(signedRequest(
      { queueId: "ABC123DEF", event: "accepted" }, { timestamp: String(NOW - 301) },
    ) as never);
    expect(expired.status).toBe(401);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, queue IDs and event names", async () => {
    expect((await POST(signedRequest("{") as never)).status).toBe(400);
    expect((await POST(signedRequest({ queueId: "not a queue id", event: "accepted" }) as never)).status).toBe(400);
    expect((await POST(signedRequest({ queueId: "ABC123DEF", event: "unknown" }) as never)).status).toBe(400);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["accepted", "delivered"],
    ["bounced", "bounced"],
    ["failed", "failed"],
    ["deferred", "uncertain"],
  ])("maps %s into the database delivery state", async (event, expectedState) => {
    const response = await POST(signedRequest({ queueId: "ABC123DEF", event }) as never);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, applied: true });
    expect(fixture.rpc).toHaveBeenCalledWith("orbit_apply_magnibox_delivery_event", {
      p_queue_id: "ABC123DEF",
      p_event_state: expectedState,
    });
  });

  it("does not claim an update when the queue ID is unknown", async () => {
    fixture.rpc.mockResolvedValue({ data: "not_found", error: null });
    const response = await POST(signedRequest({ queueId: "ABC123DEF", event: "accepted" }) as never);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  it("rejects ambiguous queue IDs without modifying a message", async () => {
    fixture.rpc.mockResolvedValue({ data: "ambiguous", error: null });
    const response = await POST(signedRequest({ queueId: "ABC123DEF", event: "bounced" }) as never);
    expect(response.status).toBe(409);
  });

  it("returns service unavailable when the database RPC fails", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    const response = await POST(signedRequest({ queueId: "ABC123DEF", event: "accepted" }) as never);
    expect(response.status).toBe(503);
  });

  it("rejects oversized webhook bodies before calling the database", async () => {
    const response = await POST(signedRequest("x".repeat(10001)) as never);
    expect(response.status).toBe(413);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
