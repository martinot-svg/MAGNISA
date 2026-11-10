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

export type BalanceSheetSourceEntry = { entryId: string; reference: string | null; sourceType: string | null; lineId: string };

export type BalanceSheetLedgerLine = {
  code: string;
  label: string;
  debit: number;
  credit: number;
  balance: number;
  comparativeBalance?: number;
  maturity?: "current" | "non_current";
  sourceEntries?: { entryId: string; reference: string | null; sourceType: string | null; lineId: string }[];
  sourceEntryCount?: number;
  sourceEntries?: BalanceSheetSourceEntry[];
  sourceEntryCount?: number;
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
  equity_capital: "Capital émis",
  equity_premiums_and_reserves: "Primes et réserves",
  equity_revaluation: "Écarts d’évaluation",
  equity_equivalence: "Écart d’équivalence",
  equity_retained_earnings: "Report à nouveau",
  equity_current_result: "Résultat net de l’exercice",
  investment_grants: "Subventions d’investissement différées",
  deferred_tax_liability: "Impôts différés passif",
  concession_obligations: "Obligations liées aux concessions",
  non_current_provisions: "Provisions non courantes",
  non_current_borrowings: "Emprunts et dettes financières non courants",
  participation_debts: "Dettes rattachées aux participations",
  suppliers_and_attached: "Fournisseurs et comptes rattachés",
  customer_advances_received: "Avances et acomptes reçus des clients",
  employee_payables: "Dettes envers le personnel",
  social_payables: "Dettes envers les organismes sociaux",
  tax_payables: "Dettes fiscales",
  other_current_payables: "Autres dettes courantes",
  provisions_and_deferred_income: "Provisions et produits constatés d’avance courants",
  other_debts: "Autres dettes",
  current_portion_of_long_term_debt: "Part à court terme des dettes à long terme",
  bank_overdrafts: "Découverts bancaires",
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


export type PassifRule = {
  account_code: string;
  section: "equity" | "non_current_liabilities" | "current_liabilities" | "review";
  line_key: string;
  normal_side: "debit" | "credit" | "both";
  requires_maturity: boolean;
  contra_equity: boolean;
};

export type PassifPresentation = {
  equity: AssetPresentationBucket[];
  nonCurrentLiabilities: AssetPresentationBucket[];
  currentLiabilities: AssetPresentationBucket[];
  maturityPending: AssetPresentationBucket[];
  reviewRequired: AssetPresentationBucket[];
  unmapped: AssetPresentationBucket[];
  blockingIssues: string[];
  totals: {
    equity: number;
    nonCurrentLiabilities: number;
    currentLiabilities: number;
    maturityPending: number;
    liabilities: number;
    passif: number;
  };
  ready: boolean;
};

/** Builds the equity and liability side using the PCG 2005 passif rules. */
export function buildPassifPresentation(
  lines: BalanceSheetLedgerLine[],
  rules: PassifRule[],
  blockingIssues: string[] = [],
): PassifPresentation {
  const ruleMap = new Map(rules.map((rule) => [rule.account_code, rule]));
  const equity = new Map<string, AssetPresentationBucket>();
  const nonCurrentLiabilities = new Map<string, AssetPresentationBucket>();
  const currentLiabilities = new Map<string, AssetPresentationBucket>();
  const maturityPending = new Map<string, AssetPresentationBucket>();
  const reviewRequired = new Map<string, AssetPresentationBucket>();
  const unmapped = new Map<string, AssetPresentationBucket>();

  let equityTotal = 0;
  let nonCurrentTotal = 0;
  let currentTotal = 0;
  let maturityPendingTotal = 0;

  for (const line of lines) {
    if (!nonZero(line)) continue;
    const rule = ruleMap.get(line.code);
    if (!rule) {
      addToBucket(unmapped, "unmapped_passif_account", line, line.balance);
      continue;
    }
    if (rule.section === "review") {
      addToBucket(reviewRequired, rule.line_key, line, line.balance);
      continue;
    }

    const amount = round(line.balance);
    const unexpectedSide =
      (rule.normal_side === "credit" && amount < -0.005)
      || (rule.normal_side === "debit" && amount > 0.005);
    if (unexpectedSide) {
      addToBucket(reviewRequired, "unexpected_passif_balance_" + rule.line_key, line, amount);
      continue;
    }

    if (rule.requires_maturity && line.maturity !== "current" && line.maturity !== "non_current") {
      addToBucket(maturityPending, rule.line_key, line, amount);
      maturityPendingTotal = round(maturityPendingTotal + amount);
      continue;
    }

    if (rule.section === "equity") {
      addToBucket(equity, rule.line_key, line, amount);
      equityTotal = round(equityTotal + amount);
      continue;
    }

    const targetSection = rule.requires_maturity
      ? line.maturity === "current" ? "current_liabilities" : "non_current_liabilities"
      : rule.section;
    if (targetSection === "current_liabilities") {
      addToBucket(currentLiabilities, rule.line_key, line, amount);
      currentTotal = round(currentTotal + amount);
    } else {
      addToBucket(nonCurrentLiabilities, rule.line_key, line, amount);
      nonCurrentTotal = round(nonCurrentTotal + amount);
    }
  }

  const liabilities = round(nonCurrentTotal + currentTotal + maturityPendingTotal);
  return {
    equity: [...equity.values()].sort((a, b) => a.key.localeCompare(b.key)),
    nonCurrentLiabilities: [...nonCurrentLiabilities.values()].sort((a, b) => a.key.localeCompare(b.key)),
    currentLiabilities: [...currentLiabilities.values()].sort((a, b) => a.key.localeCompare(b.key)),
    maturityPending: [...maturityPending.values()].sort((a, b) => a.key.localeCompare(b.key)),
    reviewRequired: [...reviewRequired.values()].sort((a, b) => a.key.localeCompare(b.key)),
    unmapped: [...unmapped.values()].sort((a, b) => a.key.localeCompare(b.key)),
    blockingIssues,
    totals: {
      equity: equityTotal,
      nonCurrentLiabilities: nonCurrentTotal,
      currentLiabilities: currentTotal,
      maturityPending: maturityPendingTotal,
      liabilities,
      passif: round(equityTotal + liabilities),
    },
    ready: reviewRequired.size === 0 && unmapped.size === 0 && maturityPending.size === 0 && blockingIssues.length === 0,
  };
}
