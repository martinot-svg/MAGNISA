import { describe, expect, it } from "vitest";
import { comparePeriods, summarizeReceivables, sumOverdueBalance } from "../../src/lib/magnisa-next/analytics";

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

  it("calcule le retard sur le solde restant et non sur le total d'origine", () => {
    const summary = summarizeReceivables(
      [
        { status: "partially_paid", total: 1000, balanceDue: 250, dueDate: "2026-11-01" },
        { status: "issued", total: 300, balanceDue: 300, dueDate: "2026-11-30" },
      ],
      [{ amount: 750 }],
      "2026-11-24",
    );
    expect(summary.outstandingTotal).toBe(550);
    expect(summary.overdueTotal).toBe(250);
    expect(summary.overdueCount).toBe(1);
  });

  it("rejette les dates de référence non ISO ou impossibles", () => {
    expect(() => summarizeReceivables([], [], "24/11/2026")).toThrow();
    expect(() => summarizeReceivables([], [], "2026-02-30")).toThrow();
  });
});

describe("comparePeriods", () => {
  it("compare les totaux et calcule les variations en pourcentage", () => {
    expect(comparePeriods(
      { revenue: 150, receipts: 90, expenses: 40 },
      { revenue: 100, receipts: 60, expenses: 50 },
    )).toEqual({
      current: { revenue: 150, receipts: 90, expenses: 40 },
      previous: { revenue: 100, receipts: 60, expenses: 50 },
      changePercent: { revenue: 50, receipts: 50, expenses: -20 },
    });
  });

  it("retourne null lorsque la période précédente est nulle et la période courante non nulle", () => {
    expect(comparePeriods(
      { revenue: 12, receipts: 0, expenses: 0 },
      { revenue: 0, receipts: 0, expenses: 0 },
    ).changePercent.revenue).toBeNull();
  });

  it("rejette les montants non numériques", () => {
    expect(() => comparePeriods(
      { revenue: "NaN", receipts: 0, expenses: 0 },
      { revenue: 0, receipts: 0, expenses: 0 },
    )).toThrow();
  });
});

describe("sumOverdueBalance", () => {
  it("somme uniquement les soldes des factures échues encore ouvertes", () => {
    expect(sumOverdueBalance([
      { status: "partially_paid", total: 1000, balanceDue: 250, dueDate: "2026-11-01" },
      { status: "issued", total: 300, balanceDue: 300, dueDate: "2026-11-30" },
      { status: "paid", total: 500, balanceDue: 0, dueDate: "2026-11-01" },
      { status: "draft", total: 900, dueDate: "2026-11-01" },
    ], "2026-11-24")).toBe(250);
  });

  it("rejette une date calendaire invalide", () => {
    expect(() => sumOverdueBalance([], "2026-02-30")).toThrow();
  });
});
