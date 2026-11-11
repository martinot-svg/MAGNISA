import { describe, expect, it } from "vitest";
import { formatDateDisplay, formatDateTimeDisplay } from "./date-format";

describe("MAGNISA date display", () => {
  it("formats ISO calendar dates as JJ/MM/AA without timezone drift", () => {
    expect(formatDateDisplay("2026-11-10")).toBe("10/11/26");
  });

  it("does not reinterpret invalid calendar dates", () => {
    expect(formatDateDisplay("2026-02-30")).toBe("2026-02-30");
  });

  it("keeps empty date values explicit", () => {
    expect(formatDateDisplay(null)).toBe("—");
  });

  it("formats timestamps as JJ/MM/AA HH:mm in Antananarivo time", () => {
    expect(formatDateTimeDisplay("2026-11-10T12:30:00.000Z")).toBe("10/11/26 15:30");
  });

  it("returns an unparseable timestamp unchanged", () => {
    expect(formatDateTimeDisplay("not-a-date")).toBe("not-a-date");
  });
});
