export type InvoiceMetricRow = {
  status: string;
  total: number | string | null;
  /** Remaining amount from the invoice ledger, when available. */
  balanceDue?: number | string | null;
  dueDate?: string | null;
};

export type PaymentMetricRow = {
  amount: number | string | null;
};

export type ReceivablesSummary = {
  invoiceCount: number;
  invoicedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  overdueCount: number;
  overdueTotal: number;
};

function amount(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    throw new Error("Montant analytique invalide.");
  }
  return parsed;
}

/**
 * Agrégateur pur : les lignes doivent déjà être chargées côté serveur et
 * filtrées par organization_id. Cette fonction ne constitue pas un contrôle
 * d'accès et ne doit jamais recevoir des données du navigateur sans validation.
 */
export function summarizeReceivables(
  invoices: readonly InvoiceMetricRow[],
  payments: readonly PaymentMetricRow[],
  asOfDate: string,
): ReceivablesSummary {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error("La date de référence doit être au format YYYY-MM-DD.");
  }

  const issued = invoices.filter((row) =>
    ["issued", "sent", "partially_paid", "paid", "overdue"].includes(row.status),
  );
  const openInvoices = issued.filter((row) =>
    !["paid", "cancelled", "void"].includes(row.status),
  );

  const invoicedTotal = issued.reduce((sum, row) => sum + amount(row.total), 0);
  const paidTotal = payments.reduce((sum, row) => sum + amount(row.amount), 0);
  // Prefer authoritative invoice balances when the caller supplies them for
  // every issued invoice; retain compatibility with older aggregate callers.
  const hasCompleteBalances = issued.every((row) => row.balanceDue !== undefined);
  const outstandingTotal = hasCompleteBalances
    ? openInvoices.reduce((sum, row) => sum + Math.max(0, amount(row.balanceDue)), 0)
    : Math.max(0, invoicedTotal - paidTotal);

  const overdue = openInvoices.filter((row) =>
    row.dueDate != null && row.dueDate < asOfDate,
  );

  return {
    invoiceCount: issued.length,
    invoicedTotal: money(invoicedTotal),
    paidTotal: money(paidTotal),
    outstandingTotal: money(outstandingTotal),
    overdueCount: overdue.length,
    // A partially paid overdue invoice contributes only its remaining balance.
    overdueTotal: money(overdue.reduce(
      (sum, row) => sum + Math.max(0, amount(row.balanceDue ?? row.total)),
      0,
    )),
  };
}

/** Somme les soldes réellement dus des factures échues, dans une devise unique. */
export function sumOverdueBalance(
  invoices: readonly InvoiceMetricRow[],
  asOfDate: string,
): number {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(asOfDate) ||
      new Date(asOfDate + "T00:00:00.000Z").toISOString().slice(0, 10) !== asOfDate) {
    throw new Error("La date de référence doit être une date ISO valide.");
  }
  return money(invoices
    .filter((row) =>
      !["paid", "cancelled", "void", "draft"].includes(row.status) &&
      row.dueDate != null && row.dueDate < asOfDate,
    )
    .reduce((sum, row) => sum + Math.max(0, amount(row.balanceDue ?? row.total)), 0));
}

export type PeriodTotals = {
  revenue: number | string | null;
  receipts: number | string | null;
  expenses: number | string | null;
};

export type PeriodComparison = {
  current: { revenue: number; receipts: number; expenses: number };
  previous: { revenue: number; receipts: number; expenses: number };
  changePercent: { revenue: number | null; receipts: number | null; expenses: number | null };
};

/** Compare deux périodes de même durée, sans mélanger leurs devises. */
export function comparePeriods(
  current: PeriodTotals,
  previous: PeriodTotals,
): PeriodComparison {
  const currentValues = {
    revenue: amount(current.revenue),
    receipts: amount(current.receipts),
    expenses: amount(current.expenses),
  };
  const previousValues = {
    revenue: amount(previous.revenue),
    receipts: amount(previous.receipts),
    expenses: amount(previous.expenses),
  };

  const change = (now: number, before: number): number | null =>
    before === 0 ? (now === 0 ? 0 : null) : money(((now - before) / Math.abs(before)) * 100);

  return {
    current: {
      revenue: money(currentValues.revenue),
      receipts: money(currentValues.receipts),
      expenses: money(currentValues.expenses),
    },
    previous: {
      revenue: money(previousValues.revenue),
      receipts: money(previousValues.receipts),
      expenses: money(previousValues.expenses),
    },
    changePercent: {
      revenue: change(currentValues.revenue, previousValues.revenue),
      receipts: change(currentValues.receipts, previousValues.receipts),
      expenses: change(currentValues.expenses, previousValues.expenses),
    },
  };
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
