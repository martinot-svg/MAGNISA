import { describe, expect, it } from "vitest";
import { windowsOverlap } from "../src/lib/magnisa-upgrade/reservations";

describe("windowsOverlap", () => {
  it("detects overlapping intervals", () => {
    expect(windowsOverlap(
      { startsAt: new Date("2026-01-01T10:00:00Z"), endsAt: new Date("2026-01-01T11:00:00Z") },
      { startsAt: new Date("2026-01-01T10:30:00Z"), endsAt: new Date("2026-01-01T11:30:00Z") },
    )).toBe(true);
  });
  it("allows adjacent intervals", () => {
    expect(windowsOverlap(
      { startsAt: new Date("2026-01-01T10:00:00Z"), endsAt: new Date("2026-01-01T11:00:00Z") },
      { startsAt: new Date("2026-01-01T11:00:00Z"), endsAt: new Date("2026-01-01T12:00:00Z") },
    )).toBe(false);
  });
});
