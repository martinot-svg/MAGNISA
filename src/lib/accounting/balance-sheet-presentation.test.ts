import { describe, expect, it } from "vitest";
import { buildAssetPresentation, buildPassifPresentation, classifyReceivableMaturity, matchesStatementAccountKind, type BalanceSheetLedgerLine, type BalanceSheetRule, type PassifRule } from "./balance-sheet-presentation";

const line = (code: string, debit: number, credit = 0): BalanceSheetLedgerLine => ({
  code, label: code, debit, credit, balance: debit - credit,
});
const passifLine = (code: string, debit: number, credit = 0, maturity?: "current" | "non_current"): BalanceSheetLedgerLine => ({
  code, label: code, debit, credit, balance: credit - debit, ...(maturity?{maturity}:{}),
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

describe("classifyReceivableMaturity", () => {
  it("treats overdue and due within twelve months as current", () => {
    expect(classifyReceivableMaturity("2026-06-30", "2026-12-31")).toBe("current");
    expect(classifyReceivableMaturity("2027-12-31", "2026-12-31")).toBe("current");
  });

  it("treats amounts due after twelve months as non-current", () => {
    expect(classifyReceivableMaturity("2028-01-01", "2026-12-31")).toBe("non_current");
  });

  it("does not guess maturity when the due date is absent", () => {
    expect(classifyReceivableMaturity(null, "2026-12-31")).toBeUndefined();
  });
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

  it("nets unpaid investment subscriptions against their asset classes", () => {
    const result = buildAssetPresentation(
      [line("261", 100_000), line("269", 0, 10_000), line("50", 50_000), line("509", 0, 5_000)],
      [
        rule("261", "non_current_assets", "financial_participations"),
        rule("269", "non_current_assets", "unpaid_participations", { normal_side: "credit", contra_asset: true }),
        rule("50", "current_assets", "short_term_investments"),
        rule("509", "current_assets", "unpaid_short_term_investments", { normal_side: "credit", contra_asset: true }),
      ],
    );
    expect(result.totals.nonCurrentNet).toBe(90_000);
    expect(result.totals.currentNet).toBe(45_000);
  });

  it("nets stock impairment against inventories", () => {
    const result = buildAssetPresentation(
      [line("37", 500_000), line("397", 0, 40_000)],
      [
        rule("37", "current_assets", "inventories_gross"),
        rule("397", "current_assets", "inventory_impairment", { normal_side: "credit", contra_asset: true }),
      ],
    );
    expect(result.totals.currentGross).toBe(500_000);
    expect(result.totals.currentContra).toBe(40_000);
    expect(result.totals.currentNet).toBe(460_000);
  });

  it("splits receivables into current and non-current using documented maturity", () => {
    const result = buildAssetPresentation(
      [
        { ...line("411", 100_000), label: "Invoice current", maturity: "current" },
        { ...line("411", 250_000), label: "Invoice long-term", maturity: "non_current" },
      ],
      [rule("411", "current_assets", "trade_receivables", { requires_maturity: true })],
    );
    expect(result.totals.currentGross).toBe(100_000);
    expect(result.totals.nonCurrentGross).toBe(250_000);
    expect(result.maturityPending).toHaveLength(0);
    expect(result.ready).toBe(true);
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

  it("flags abnormal credit balances on debit-normal asset accounts", () => {
    const result = buildAssetPresentation(
      [line("411", 0, 90_000)],
      [rule("411", "current_assets", "trade_receivables", { requires_maturity: true, normal_side: "debit" })],
    );
    expect(result.reviewRequired).toHaveLength(1);
    expect(result.ready).toBe(false);
    expect(result.totals.identifiedNet).toBe(0);
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

  it("does not let offsetting unmapped accounts cancel the readiness blocker", () => {
    const result = buildAssetPresentation(
      [line("998", 100_000), line("999", 0, 100_000)],
      [],
    );
    expect(result.unmapped[0].amount).toBe(0);
    expect(result.ready).toBe(false);
  });

  it("does not let offsetting suspense balances cancel the readiness blocker", () => {
    const result = buildAssetPresentation(
      [line("471", 100_000), line("472", 0, 100_000)],
      [
        rule("471", "clearing", "suspense_and_transitory", { normal_side: "both" }),
        rule("472", "clearing", "suspense_and_transitory", { normal_side: "both" }),
      ],
    );
    expect(result.reviewRequired[0].amount).toBe(0);
    expect(result.ready).toBe(false);
  });

  it("blocks readiness when an auxiliary subledger is unavailable", () => {
    const result = buildAssetPresentation([], [], ["Inventaire physique approuvé absent."]);
    expect(result.blockingIssues).toEqual(["Inventaire physique approuvé absent."]);
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

describe("matchesStatementAccountKind", () => {
  it.each(["422", "442", "443", "445", "451", "456", "458", "467"])(
    "splits debit and credit balance account %s through the clearing bucket",
    (code) => {
      expect(matchesStatementAccountKind(code, "asset", "clearing")).toBe(true);
      expect(matchesStatementAccountKind(code, "liability", "clearing")).toBe(true);
      expect(matchesStatementAccountKind(code, "asset", "asset")).toBe(false);
      expect(matchesStatementAccountKind(code, "liability", "liability")).toBe(false);
    },
  );
  it("keeps ordinary account kinds unchanged", () => {
    expect(matchesStatementAccountKind("411", "asset", "asset")).toBe(true);
    expect(matchesStatementAccountKind("401", "liability", "liability")).toBe(true);
  });
});


describe("buildPassifPresentation", () => {
  const passifRule = (
    account_code: string,
    section: PassifRule["section"],
    line_key: string,
    options: Partial<PassifRule> = {},
  ): PassifRule => ({
    account_code, section, line_key, normal_side: "credit",
    requires_maturity: false, contra_equity: false, ...options,
  });

  it("builds equity, non-current and current liabilities independently", () => {
    const result = buildPassifPresentation(
      [passifLine("101", 0, 1000), passifLine("164", 0, 700), passifLine("401", 0, 300)],
      [
        passifRule("101", "equity", "equity_capital"),
        passifRule("164", "non_current_liabilities", "non_current_borrowings"),
        passifRule("401", "current_liabilities", "suppliers_and_attached"),
      ],
    );
    expect(result.totals).toMatchObject({
      equity: 1000, nonCurrentLiabilities: 700, currentLiabilities: 300,
      maturityPending: 0, liabilities: 1000, passif: 2000,
    });
    expect(result.ready).toBe(true);
  });

  it("treats debit-side equity deductions as negative equity", () => {
    const result = buildPassifPresentation(
      [passifLine("109", 250, 0)],
      [passifRule("109", "equity", "equity_capital", {normal_side:"debit",contra_equity:true})],
    );
    expect(result.totals.equity).toBe(-250);
    expect(result.ready).toBe(true);
  });

  it("blocks liabilities without required contractual maturity", () => {
    const result = buildPassifPresentation(
      [passifLine("164", 0, 900)],
      [passifRule("164", "non_current_liabilities", "non_current_borrowings", {requires_maturity:true})],
    );
    expect(result.totals.maturityPending).toBe(900);
    expect(result.ready).toBe(false);
  });

  it("splits loan principal by current and non-current maturity", () => {
    const result = buildPassifPresentation(
      [
        passifLine("164", 0, 400, "current"),
        passifLine("164", 0, 600, "non_current"),
      ],
      [passifRule("164", "non_current_liabilities", "non_current_borrowings", {requires_maturity:true})],
    );
    expect(result.totals.currentLiabilities).toBe(400);
    expect(result.totals.nonCurrentLiabilities).toBe(600);
    expect(result.ready).toBe(true);
  });


  it("presents the credit side of mixed tax accounts as current liabilities", () => {
    const result = buildPassifPresentation(
      [
        {...line("442", 0, 125_000), balance:125_000},
        {...line("443", 0, 30_000), balance:30_000},
        {...line("445", 0, 75_000), balance:75_000},
      ],
      [
        passifRule("442", "current_liabilities", "tax_payables"),
        passifRule("443", "current_liabilities", "tax_payables"),
        passifRule("445", "current_liabilities", "tax_payables"),
      ],
    );
    expect(result.totals.currentLiabilities).toBe(230_000);
    expect(result.ready).toBe(true);
  });

  it("does not hide unmapped passif accounts or review balances", () => {
    const result = buildPassifPresentation(
      [passifLine("471", 0, 50), passifLine("999", 0, 20)],
      [passifRule("471", "review", "suspense_and_transitory")],
    );
    expect(result.reviewRequired).toHaveLength(1);
    expect(result.unmapped).toHaveLength(1);
    expect(result.ready).toBe(false);
  });
});
