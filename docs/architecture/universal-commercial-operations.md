# MAGNISA — Universal commercial and operational model

## Architectural rule

Commercial documents, operational execution and accounting events are separate layers.

- Commercial: quote, contract, order, invoice, credit note and customer relationship.
- Operational: procurement, receipt, reservation, delivery, service execution, consumption, subcontracting, return and warranty.
- Accounting: dated economic events, evidence, tax treatment, versioned PCG posting rules, journal entries and settlements.

A commercial label alone must never select a PCG account.

## Reuse found in the current application

The current application already has organization-scoped customers, suppliers, services, quotes, orders, invoices, payments, supplier invoices, recurring service contracts, expenses, financial transactions, journal entries, versioned accounting posting rules and organization feature flags.

Commercial document lines currently reference the service catalogue. The production schema has no general product/item catalogue or operational stock movement ledger. The inventory_counts and inventory_count_lines tables are year-end physical count and valuation records, not a day-to-day stock subledger.

Therefore, the existing quote/order/invoice flow is reusable for services, but does not yet prove that merchandise sales, mixed product/service documents, purchase-order receipt and perpetual stock are operationally supported.

## Operation families

The domain registry covers service delivery, merchandise trade, third-party mandates, customer-supplied goods, mixed supply, procurement, inventory, subcontracting, rental, recurring contracts, customer and supplier advances, guarantees, returns/after-sales, reimbursable expenses, foreign currency and internal transfers.

These are operational classifications, not a chart of accounts. A single operation may contain multiple lines with different treatments.

## Accounting classification guardrails

- Merchandise resale requires evidence that the company acts as principal and owns the goods for resale.
- A third-party purchase is treated as clearing only when a real mandate is evidenced, the supplier document is in the customer's name, the company does not bear substantive goods risk, and the exact amount is reconcilable.
- If the supplier document is issued in the company's name or the company bears the goods risk, the operation must be reviewed rather than automatically netted as a mandate.
- Customer-supplied goods are not company inventory when ownership remains with the customer.
- A customer advance, refundable deposit, guarantee, exact third-party reimbursement and service fee are distinct events.
- The accounting posting engine and organization-specific, versioned PCG rules remain the only place that selects debit and credit accounts.

## Implementation phases

1. Domain classification and evidence rules (initial code slice).
2. General item catalogue, supplier purchase lines, stock locations and immutable stock movements.
3. Mixed commercial document lines linked to either a service or an item, preserving historical price and tax snapshots.
4. Operation/event ledger with unique idempotency keys and source traceability.
5. Atomic RPC workflows for partial receipts, deliveries, returns, customer advances, mandates and journal posting.
6. UI activation by organization feature and permission.
7. Integration tests for complete workflows, reversals, tenant isolation and financial statement impact.

No production data or schema is changed by this document or the TypeScript classification layer.
