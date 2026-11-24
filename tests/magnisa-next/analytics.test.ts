import { describe, expect, it } from "vitest";
import { summarizeReceivables } from "../../src/lib/magnisa-next/analytics";

describe("summarizeReceivables", () => {
  it("agrège les factures émises, paiements et retards", () => {
    expect(
      summarizeReceivables(
        [
          { status: "issued", total: 100, dueDate: "2026-11-01" },
          { status: "paid", total: 50, dueDate: "2026-11-20" },
          { status: "draft", total: 500, dueDate: "2026-11-01" },
        ],
        [{ amount: 30 }],
        "2026-11-24",
      ),
    ).toEqual({
      invoiceCount: 2,
      invoicedTotal: 150,
      paidTotal: 30,
      outstandingTotal: 120,
      overdueCount: 1,
      overdueTotal: 100,
    });
  });
});
