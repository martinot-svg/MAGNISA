import { describe, expect, it, vi } from "vitest";
import { ensureRealtimeAuth } from "../src/lib/notifications/realtime-auth";

describe("ensureRealtimeAuth", () => {
  it("sets the realtime JWT before a private subscription is created", async () => {
    const setAuth = vi.fn();
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "jwt-authenticated" } }, error: null }) },
      realtime: { setAuth },
    };
    await expect(ensureRealtimeAuth(supabase)).resolves.toBe(true);
    expect(setAuth).toHaveBeenCalledWith("jwt-authenticated");
  });

  it("does not subscribe anonymously when no session is available", async () => {
    const setAuth = vi.fn();
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
      realtime: { setAuth },
    };
    await expect(ensureRealtimeAuth(supabase)).resolves.toBe(false);
    expect(setAuth).not.toHaveBeenCalled();
  });

  it("fails closed when session retrieval fails", async () => {
    const setAuth = vi.fn();
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "stale" } }, error: new Error("session unavailable") }) },
      realtime: { setAuth },
    };
    await expect(ensureRealtimeAuth(supabase)).resolves.toBe(false);
    expect(setAuth).not.toHaveBeenCalled();
  });
});
