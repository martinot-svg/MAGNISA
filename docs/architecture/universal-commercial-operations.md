# MAGNISA — Universal commercial and operational model

## Architectural rule

Commercial documents, operational execution and accounting events are separate layers.

- Commercial: quote, contract, order, invoice, credit note and customer relationship.
- Operational: procurement, receipt, reservation, delivery, service execution, consumption, subcontracting, return and warranty.
- Accounting: dated economic events, evidence, tax treatment, versioned PCG posting rules, journal entries and settlements.

A commercial label alone must never select a PCG account.

## Reuse found in the current application

The application already has organization-scoped customers, suppliers, services, quotes, orders, invoices, payments, supplier invoices, recurring service contracts, expenses, financial transactions, journal entries, versioned accounting posting rules and organization feature flags.

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

## Procurement and stock foundation in this branch

The additive migration 20261110092048_commercial_items_procurement_stock_ledger.sql introduces:

- catalog_items: organization-scoped SKU catalogue, item kind, base unit, tracking mode and default commercial prices.
- stock_locations: organization-scoped stores, warehouses and transit locations.
- purchase_orders and purchase_order_lines: supplier orders with explicit purchase purpose and beneficiary.
- goods_receipts and goods_receipt_lines: partial deliveries against a submitted purchase order.
- stock_movements: append-only quantity ledger with unique event keys.
- stock_on_hand: tenant-protected quantity view derived from stock movements.

Purchase purposes are deliberately limited to physical goods:
- resale: goods acquired and owned by the company for resale; a tracked receipt increases company stock.
- customer_mandate: goods procured for a named customer; receipt is recorded but never increases company-owned stock.
- company_use / consumption: goods for the company's own use; quantity tracking follows the item configuration.

Subcontracted services remain in the existing supplier/expense workflow and are not mixed into physical goods purchase orders.

A customer-mandate receipt is blocked unless the purchase line records a confirmed mandate, supplier document in the customer's name, no company-borne goods risk, exact-cost support and a supplier-document reference. The company must still reconcile the customer funds, supplier payment and exact supplier cost before closing the mandate.

The post_goods_receipt workflow is atomic and retry-safe. It checks organization membership, purchase-order state, partial quantities and over-receipt; creates an immutable stock movement only for stock-tracked company goods; and updates received quantities and order status. Direct insert/update/delete access to the stock ledger is restricted. Corrections must be represented by compensating movements.

The receipt workflow intentionally does not create a journal. The supplier invoice and versioned PCG posting engine remain responsible for accounting recognition. A purchase order or physical receipt must not be mistaken for a supplier invoice, expense or inventory journal without the organization's configured inventory method and tax evidence.

## Deliberately not included in this slice

- Serial-number capture.
- Stock issues, customer deliveries, returns, transfers and adjustments.
- Inventory valuation (CUMP/FIFO) and accounting integration.
- Supplier invoice matching and customer mandate settlement.
- Mixed service/product quote, order and invoice lines.
- User interface, role permissions and organization feature activation.

Sales document lines are deliberately not changed in this slice. Merchandise and mandate lines must be integrated with order-to-invoice conversion and the accounting posting engine together; otherwise a product line could be invoiced as ordinary service revenue.

## Implementation phases

1. Domain classification and evidence rules.
2. Item catalogue, supplier purchase lines, stock locations and immutable stock movements (this branch).
3. Mixed commercial document lines linked to either a service or an item, preserving historical price and tax snapshots.
4. Operation/event ledger with unique idempotency keys and source traceability.
5. Atomic RPC workflows for stock issues, deliveries, returns, customer advances, mandates and journal posting.
6. UI activation by organization feature and permission.
7. Integration tests for complete workflows, reversals, tenant isolation and financial statement impact.

No production data or schema is changed by this branch. The migration remains pending review and clean-database replay.
