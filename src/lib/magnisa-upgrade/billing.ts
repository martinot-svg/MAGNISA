export interface InvoiceCandidate {
  contractId: string;
  dueDate: string;
  idempotencyKey: string;
}

/** Stable key used by the billing job to prevent duplicate invoice creation. */
export function invoiceIdempotencyKey(candidate: InvoiceCandidate): string {
  if (!candidate.contractId || !candidate.dueDate) throw new Error("Missing billing identity");
  return `recurring:${candidate.contractId}:${candidate.dueDate}`;
}
