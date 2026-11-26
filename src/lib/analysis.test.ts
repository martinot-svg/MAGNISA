import { describe, expect, it } from "vitest";
import { analyze } from "./analysis";

describe("MAGNISA economic analysis", () => {
  it("shows completed services awaiting invoicing even when other metrics are zero", () => {
    const alerts = analyze({
      revenue: 0,
      expenses: 0,
      receivables: 0,
      overdueReceivables: 0,
      cashAvailable: 0,
      expectedReceipts30d: 0,
      obligations30d: 0,
      unbilledCompletedServices: 125000,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].code).toBe("unbilled");
    expect(alerts[0].amount).toBe(125000);
  });
});
