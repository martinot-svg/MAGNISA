import { describe, expect, it } from "vitest";
import { computeConfiguredDueDate, isCalendarRuleEffective } from "./configurable-calendar";

describe("computeConfiguredDueDate", () => {
  it("clamps a next-month deadline to the last day of February", () => {
    expect(computeConfiguredDueDate("2027-01-01", "2027-01-31", { type: "day_of_next_month", day: 31 }))
      .toBe("2027-02-28");
  });

  it("computes a next-month deadline across year boundary", () => {
    expect(computeConfiguredDueDate("2026-12-01", "2026-12-31", { type: "day_of_next_month", day: 15 }))
      .toBe("2027-01-15");
  });

  it("computes the configured day after a quarter", () => {
    expect(computeConfiguredDueDate("2026-10-01", "2026-12-31", { type: "day_of_month_after_quarter", day: 15 }))
      .toBe("2027-01-15");
  });

  it("adds an explicit number of days after the period end", () => {
    expect(computeConfiguredDueDate("2026-10-01", "2026-10-31", { type: "days_after_period_end", days: 10 }))
      .toBe("2026-11-10");
  });

  it("rejects invalid dates and rule values", () => {
    expect(() => computeConfiguredDueDate("2026-02-30", "2026-03-01", { type: "day_of_next_month", day: 15 })).toThrow();
    expect(() => computeConfiguredDueDate("2026-01-01", "2026-01-31", { type: "day_of_next_month", day: 32 })).toThrow();
    expect(() => computeConfiguredDueDate("2026-02-01", "2026-01-31", { type: "days_after_period_end", days: 2 })).toThrow();
  });
});

describe("isCalendarRuleEffective", () => {
  const base = {
    organismCode: "CNAPS",
    periodicity: "monthly" as const,
    dueRule: { type: "day_of_next_month" as const, day: 15 },
    effectiveFrom: "2026-01-01",
    sourceLabel: "Source officielle contrôlée",
    sourceUrl: "https://example.mg/regles",
    status: "validated" as const,
  };

  it("accepts a validated, sourced rule inside its effective range", () => {
    expect(isCalendarRuleEffective(base, "2026-10-29")).toBe(true);
  });

  it("does not accept drafts, missing sources, or dates outside the range", () => {
    expect(isCalendarRuleEffective({ ...base, status: "draft" }, "2026-10-29")).toBe(false);
    expect(isCalendarRuleEffective({ ...base, sourceLabel: "" }, "2026-10-29")).toBe(false);
    expect(isCalendarRuleEffective({ ...base, effectiveTo: "2026-06-30" }, "2026-10-29")).toBe(false);
  });
});
