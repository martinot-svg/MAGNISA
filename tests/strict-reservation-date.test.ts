import { describe, expect, it } from "vitest";
import { parseReservationDateWithOffset } from "../src/lib/magnisa-upgrade/strict-reservation-date";

describe("parseReservationDateWithOffset", () => {
  it("normalizes valid timestamps with an explicit timezone", () => {
    expect(parseReservationDateWithOffset("2026-12-01T09:00:00+03:00"))
      .toBe("2026-12-01T06:00:00.000Z");
    expect(parseReservationDateWithOffset("2026-12-01T09:00Z"))
      .toBe("2026-12-01T09:00:00.000Z");
  });

  it.each([
    "2026-02-30T09:00:00+03:00",
    "2026-13-01T09:00:00+03:00",
    "2026-12-01T25:00:00+03:00",
    "2026-12-01T09:61:00+03:00",
    "2026-12-01T09:00:00+14:30",
    "2026-12-01T09:00:00",
    "December 1, 2026 09:00",
  ])("rejects invalid or ambiguous timestamp %s", (value) => {
    expect(() => parseReservationDateWithOffset(value)).toThrow();
  });
});
