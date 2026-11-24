export type InvoiceMetricRow = {
  status: string;
  total: number | string | null;
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

function amount(value: number | string | null): number {
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

  const invoicedTotal = issued.reduce((sum, row) => sum + amount(row.total), 0);
  const paidTotal = payments.reduce((sum, row) => sum + amount(row.amount), 0);
  const outstandingTotal = Math.max(0, invoicedTotal - paidTotal);

  const overdue = issued.filter((row) =>
    row.dueDate != null &&
    row.dueDate < asOfDate &&
    !["paid", "cancelled", "void"].includes(row.status),
  );

  return {
    invoiceCount: issued.length,
    invoicedTotal: money(invoicedTotal),
    paidTotal: money(paidTotal),
    outstandingTotal: money(outstandingTotal),
    overdueCount: overdue.length,
    overdueTotal: money(overdue.reduce((sum, row) => sum + amount(row.total), 0)),
  };
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
