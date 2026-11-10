const mixedBalanceAccountCodes = new Set(["422", "442", "443", "445", "451", "456", "458", "467"]);

export function matchesStatementAccountKind(
  code: string,
  actualKind: string,
  requestedKind: string,
): boolean {
  if (mixedBalanceAccountCodes.has(code)) return requestedKind === "clearing";
  return actualKind === requestedKind;
}

export type BalanceSheetRule = {
  account_code: string;
  section: "non_current_assets" | "current_assets" | "non_current_liabilities" | "current_liabilities" | "equity" | "clearing" | "review";
  line_key: string;
  normal_side: "debit" | "credit" | "both";
  requires_maturity: boolean;
  contra_asset: boolean;
};

export type BalanceSheetLedgerLine = {
  code: string;
  label: string;
  debit: number;
  credit: number;
  balance: number;
  comparativeBalance?: number;
  maturity?: "current" | "non_current";
};

export type AssetPresentationBucket = {
  key: string;
  label: string;
  amount: number;
  accounts: BalanceSheetLedgerLine[];
};

export type AssetPresentation = {
  nonCurrent: AssetPresentationBucket[];
  current: AssetPresentationBucket[];
  maturityPending: AssetPresentationBucket[];
  reviewRequired: AssetPresentationBucket[];
  unmapped: AssetPresentationBucket[];
  blockingIssues: string[];
  totals: {
    nonCurrentGross: number;
    nonCurrentContra: number;
    nonCurrentNet: number;
    currentGross: number;
    currentContra: number;
    currentNet: number;
    maturityPendingNet: number;
    identifiedNet: number;
  };
  ready: boolean;
};

export function classifyReceivableMaturity(
  dueDate: string | null | undefined,
  periodEnd: string,
): "current" | "non_current" | undefined {
  if (!dueDate) return undefined;
  const end = new Date(periodEnd + "T00:00:00.000Z");
  const year = end.getUTCFullYear() + 1;
  const month = end.getUTCMonth();
  const day = end.getUTCDate();
  const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cutoff = Date.UTC(year, month, Math.min(day, maxDay));
  return new Date(dueDate + "T00:00:00.000Z").getTime() <= cutoff ? "current" : "non_current";
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const nonZero = (line: BalanceSheetLedgerLine) =>
  Math.abs(line.debit) >= 0.005 || Math.abs(line.credit) >= 0.005 || Math.abs(line.balance) >= 0.005;

const labels: Record<string, string> = {
  intangible_assets_gross: "Immobilisations incorporelles",
  tangible_assets_gross: "Immobilisations corporelles",
  concession_assets_gross: "Immobilisations mises en concession",
  assets_in_progress: "Immobilisations en cours et avances",
  financial_participations: "Participations et créances rattachées",
  unpaid_participations: "Versements restant à effectuer sur participations",
  other_financial_assets: "Autres immobilisations financières",
  unpaid_other_financial_assets: "Versements restant à effectuer sur titres immobilisés",
  accumulated_depreciation: "Amortissements cumulés",
  non_current_impairment: "Dépréciations des actifs non courants",
  deferred_tax_asset: "Impôts différés actif",
  inventories_gross: "Stocks et en-cours",
  inventory_impairment: "Dépréciations des stocks",
  trade_receivables: "Clients et comptes rattachés",
  advances_and_deposits: "Avances et acomptes versés",
  tax_and_public_authority_balances: "Créances fiscales et organismes publics",
  other_receivables_and_payables: "Autres créances et comptes rattachés",
  accruals_and_deferred_income: "Charges constatées d'avance",
  receivables_impairment: "Dépréciations des créances",
  short_term_investments: "Valeurs mobilières de placement",
  unpaid_short_term_investments: "Versements restant à effectuer sur valeurs mobilières de placement",
  bank_and_financial_institutions: "Banques et organismes financiers",
  treasury_instruments: "Instruments de trésorerie",
  cash_on_hand: "Caisse",
  cash_advances: "Régies d'avances et accréditifs",
  cash_impairment: "Dépréciations des comptes financiers",
};

function bucketKey(rule: BalanceSheetRule): string {
  return rule.line_key;
}

function addToBucket(
  target: Map<string, AssetPresentationBucket>,
  key: string,
  line: BalanceSheetLedgerLine,
  amount: number,
) {
  const current = target.get(key) ?? {
    key,
    label: labels[key] ?? key,
    amount: 0,
    accounts: [],
  };
  current.amount = round(current.amount + amount);
  current.accounts.push(line);
  target.set(key, current);
}

/**
 * Builds the asset side from PCG-mapped ledger balances.
 * Maturity-dependent receivables are kept outside current/non-current totals
 * until their contractual due dates are supplied. Suspense and mixed accounts
 * are excluded from the statement total and block readiness.
 */
export function buildAssetPresentation(
  lines: BalanceSheetLedgerLine[],
  rules: BalanceSheetRule[],
  blockingIssues: string[] = [],
): AssetPresentation {
  const ruleMap = new Map(rules.map((rule) => [rule.account_code, rule]));
  const nonCurrent = new Map<string, AssetPresentationBucket>();
  const current = new Map<string, AssetPresentationBucket>();
  const maturityPending = new Map<string, AssetPresentationBucket>();
  const reviewRequired = new Map<string, AssetPresentationBucket>();
  const unmapped = new Map<string, AssetPresentationBucket>();

  let nonCurrentGross = 0;
  let nonCurrentContra = 0;
  let currentGross = 0;
  let currentContra = 0;
  let maturityPendingNet = 0;

  for (const line of lines) {
    if (!nonZero(line)) continue;
    const rule = ruleMap.get(line.code);
    if (!rule) {
      addToBucket(unmapped, "unmapped_account", line, line.balance);
      continue;
    }

    if (rule.section === "clearing" || rule.section === "review") {
      addToBucket(reviewRequired, rule.line_key, line, line.balance);
      continue;
    }

    if (rule.section !== "non_current_assets" && rule.section !== "current_assets") {
      continue;
    }

    const amount = round(line.balance);
    const unexpectedSide =
      (rule.normal_side === "debit" && amount < -0.005)
      || (rule.normal_side === "credit" && amount > 0.005);
    if (unexpectedSide) {
      addToBucket(reviewRequired, "unexpected_balance_side_" + rule.line_key, line, amount);
      continue;
    }
    if (rule.requires_maturity && line.maturity === "current") {
      addToBucket(current, rule.line_key, line, rule.contra_asset ? Math.abs(amount) : amount);
      if (rule.contra_asset) currentContra = round(currentContra + Math.abs(amount));
      else currentGross = round(currentGross + amount);
      continue;
    }
    if (rule.requires_maturity && line.maturity === "non_current") {
      addToBucket(nonCurrent, rule.line_key, line, rule.contra_asset ? Math.abs(amount) : amount);
      if (rule.contra_asset) nonCurrentContra = round(nonCurrentContra + Math.abs(amount));
      else nonCurrentGross = round(nonCurrentGross + amount);
      continue;
    }
    if (rule.requires_maturity) {
      addToBucket(maturityPending, bucketKey(rule), line, amount);
      maturityPendingNet = round(maturityPendingNet + amount);
      continue;
    }

    if (rule.section === "non_current_assets") {
      addToBucket(nonCurrent, rule.line_key, line, rule.contra_asset ? Math.abs(amount) : amount);
      if (rule.contra_asset) nonCurrentContra = round(nonCurrentContra + Math.abs(amount));
      else nonCurrentGross = round(nonCurrentGross + amount);
      continue;
    }

    addToBucket(current, rule.line_key, line, rule.contra_asset ? Math.abs(amount) : amount);
    if (rule.contra_asset) currentContra = round(currentContra + Math.abs(amount));
    else currentGross = round(currentGross + amount);
  }

  const nonCurrentNet = round(nonCurrentGross - nonCurrentContra);
  const currentNet = round(currentGross - currentContra);
  const identifiedNet = round(nonCurrentNet + currentNet + maturityPendingNet);
  return {
    nonCurrent: [...nonCurrent.values()].sort((a, b) => a.key.localeCompare(b.key)),
    current: [...current.values()].sort((a, b) => a.key.localeCompare(b.key)),
    maturityPending: [...maturityPending.values()].sort((a, b) => a.key.localeCompare(b.key)),
    reviewRequired: [...reviewRequired.values()].sort((a, b) => a.key.localeCompare(b.key)),
    unmapped: [...unmapped.values()].sort((a, b) => a.key.localeCompare(b.key)),
    blockingIssues,
    totals: {
      nonCurrentGross,
      nonCurrentContra,
      nonCurrentNet,
      currentGross,
      currentContra,
      currentNet,
      maturityPendingNet,
      identifiedNet,
    },
    ready: reviewRequired.size === 0 && unmapped.size === 0 && maturityPending.size === 0 && blockingIssues.length === 0,
  };
}
