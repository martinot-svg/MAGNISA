import { describe, expect, it, vi } from "vitest";
import { executeFormDialogAction, formatFormDialogError } from "./form-dialog-action";

function callbacks() {
  return {
    setPending: vi.fn(),
    setError: vi.fn(),
    onSuccess: vi.fn(),
  };
}

describe("FormDialog server action lifecycle", () => {
  it("closes only after the server action resolves successfully", async () => {
    const pending = { current: false };
    const events = callbacks();
    let release!: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const submission = executeFormDialogAction(action, new FormData(), pending, events);

    expect(pending.current).toBe(true);
    expect(events.onSuccess).not.toHaveBeenCalled();
    release();
    await submission;

    expect(events.onSuccess).toHaveBeenCalledOnce();
    expect(events.setPending).toHaveBeenNthCalledWith(1, true);
    expect(events.setPending).toHaveBeenLastCalledWith(false);
    expect(pending.current).toBe(false);
  });

  it("prevents a second submission while the first request is pending", async () => {
    const pending = { current: false };
    const events = callbacks();
    let release!: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = executeFormDialogAction(action, new FormData(), pending, events);
    await executeFormDialogAction(action, new FormData(), pending, events);

    expect(action).toHaveBeenCalledOnce();
    release();
    await first;
  });

  it("keeps the dialog open and exposes a readable error after failure", async () => {
    const events = callbacks();
    await executeFormDialogAction(async () => { throw new Error("Période invalide"); }, new FormData(), { current: false }, events);

    expect(events.onSuccess).not.toHaveBeenCalled();
    expect(events.setError).toHaveBeenCalledWith("Période invalide");
    expect(events.setPending).toHaveBeenLastCalledWith(false);
  });

  it("can propagate errors to client-owned submit handlers without losing the pending lifecycle", async () => {
    const events = callbacks();
    const pending = { current: false };
    await expect(executeFormDialogAction(async () => { throw new Error("Commande refusée"); }, new FormData(), pending, events, true))
      .rejects.toThrow("Commande refusée");
    expect(events.setError).toHaveBeenCalledOnce();
    expect(events.setError).toHaveBeenCalledWith(null);
    expect(events.onSuccess).not.toHaveBeenCalled();
    expect(events.setPending).toHaveBeenLastCalledWith(false);
    expect(pending.current).toBe(false);
  });

  it("treats returned server errors as failures", async () => {
    const events = callbacks();
    const action = async () => ({ error: "Conflit métier" }) as unknown as void;
    await executeFormDialogAction(action, new FormData(), { current: false }, events);

    expect(events.onSuccess).not.toHaveBeenCalled();
    expect(events.setError).toHaveBeenCalledWith("Conflit métier");
  });

  it("propagates Next.js redirects while releasing the pending lock", async () => {
    const events = callbacks();
    const pending = { current: false };
    await expect(executeFormDialogAction(async () => { throw new Error("NEXT_REDIRECT"); }, new FormData(), pending, events))
      .rejects.toThrow("NEXT_REDIRECT");
    expect(pending.current).toBe(false);
    expect(events.setPending).toHaveBeenLastCalledWith(false);
  });

  it("normalizes permission, duplicate and network errors", () => {
    expect(formatFormDialogError(new Error("permission denied"))).toContain("autorisations");
    expect(formatFormDialogError(new Error("duplicate key"))).toContain("existe déjà");
    expect(formatFormDialogError(new Error("Failed to fetch"))).toContain("connexion");
  });
});
