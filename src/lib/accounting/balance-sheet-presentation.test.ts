import { describe, expect, it } from "vitest";
import { buildAssetPresentation, type BalanceSheetLedgerLine, type BalanceSheetRule } from "./balance-sheet-presentation";

const line = (code: string, debit: number, credit = 0): BalanceSheetLedgerLine => ({
  code, label: code, debit, credit, balance: debit - credit,
});
const rule = (
  account_code: string,
  section: BalanceSheetRule["section"],
  line_key: string,
  options: Partial<BalanceSheetRule> = {},
): BalanceSheetRule => ({
  account_code, section, line_key, normal_side: "debit",
  requires_maturity: false, contra_asset: false, ...options,
});

describe("buildAssetPresentation", () => {
  it("separates fixed assets and subtracts accumulated depreciation and impairment", () => {
    const result = buildAssetPresentation(
      [line("213", 1_000_000), line("281", 0, 250_000), line("291", 0, 50_000)],
      [
        rule("213", "non_current_assets", "tangible_assets_gross"),
        rule("281", "non_current_assets", "accumulated_depreciation", { normal_side: "credit", contra_asset: true }),
        rule("291", "non_current_assets", "non_current_impairment", { normal_side: "credit", contra_asset: true }),
      ],
    );
    expect(result.totals.nonCurrentGross).toBe(1_000_000);
    expect(result.totals.nonCurrentContra).toBe(300_000);
    expect(result.totals.nonCurrentNet).toBe(700_000);
    expect(result.ready).toBe(true);
  });

  it("nets stock impairment against inventories", () => {
    const result = buildAssetPresentation(
      [line("37", 500_000), line("397", 40_000)],
      [
        rule("37", "current_assets", "inventories_gross"),
        rule("397", "current_assets", "inventory_impairment", { normal_side: "credit", contra_asset: true }),
      ],
    );
    expect(result.totals.currentGross).toBe(500_000);
    expect(result.totals.currentContra).toBe(40_000);
    expect(result.totals.currentNet).toBe(460_000);
  });

  it("does not guess current versus non-current maturity for receivables", () => {
    const result = buildAssetPresentation(
      [line("411", 120_000)],
      [rule("411", "current_assets", "trade_receivables", { requires_maturity: true })],
    );
    expect(result.maturityPending).toHaveLength(1);
    expect(result.totals.maturityPendingNet).toBe(120_000);
    expect(result.ready).toBe(false);
  });

  it("blocks suspense and mixed third-party accounts rather than hiding them", () => {
    const result = buildAssetPresentation(
      [line("471", 75_000)],
      [rule("471", "clearing", "suspense_and_transitory", { normal_side: "both" })],
    );
    expect(result.reviewRequired).toHaveLength(1);
    expect(result.ready).toBe(false);
    expect(result.totals.identifiedNet).toBe(0);
  });

  it("blocks non-zero PCG accounts without an explicit presentation rule", () => {
    const result = buildAssetPresentation([line("999", 25_000)], []);
    expect(result.unmapped).toHaveLength(1);
    expect(result.ready).toBe(false);
  });

  it("ignores zero-balance accounts without inventing amounts", () => {
    const result = buildAssetPresentation([line("411", 0)], []);
    expect(result.unmapped).toHaveLength(0);
    expect(result.ready).toBe(true);
  });

  it("does not include liability and equity accounts in the asset total", () => {
    const result = buildAssetPresentation(
      [line("401", 0, 90_000), line("101", 0, 1_000_000)],
      [
        rule("401", "current_liabilities", "suppliers", { normal_side: "credit" }),
        rule("101", "equity", "capital", { normal_side: "credit" }),
      ],
    );
    expect(result.totals.identifiedNet).toBe(0);
    expect(result.ready).toBe(true);
  });
});
