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

The catalogue and stock overview are available at /articles behind the optional inventory feature. Item creation and stock-location management use inventory.manage; read access uses inventory.view. This page displays quantities only and does not claim inventory valuation.

## Operational stock subledger increment

The next migration, `20261110140000_stock_reservations_deliveries_transfers.sql`, extends the existing ledger rather than introducing a second stock system:

- `stock_reservations` records customer-order reservations separately from physical movements. `stock_available` reports physical quantity, active reserved quantity and available quantity. Reservation RPCs serialize competing reservations using a transaction-scoped advisory lock and prevent reserving more than either available stock or the undelivered order-line balance.
- `sales_deliveries` and `sales_delivery_lines` record partial or full dispatches. The delivery RPC validates order-line identity, quantity remaining, location and optional reservation; then atomically records the negative stock movement and fulfils the reservation. Delivery does not issue an invoice.
- `stock_transfers` and `stock_transfer_lines` record inter-location transfers. Each transfer produces paired immutable `transfer_out` and `transfer_in` movements in the same transaction. Transfers cannot consume reserved stock.
- All operation RPCs use organization membership and the existing permission checks, are idempotent by request key and reject reuse of a key with a different payload.
- The customer-order page now supports adding a tracked catalogue item to an existing confirmed order, reserving it, and recording partial deliveries. The `/mouvements-stock` screen displays stock availability, active reservations, movements and transfers, and exposes the transfer workflow.
- Stock movements now carry a purpose bucket: `resale`, `company_use` or `consumption`. Goods receipt classifies the movement from the purchase-order line's destination; customer mandates still create no company movement. Sales reservations and deliveries can consume only the resale bucket, preventing company-use equipment or consumables from being sold as merchandise.
- `stock_on_hand_by_bucket` and `stock_available` expose physical, reserved and available quantities separately by purpose, item and location. The existing aggregate `stock_on_hand` view remains available for compatibility.
- Moving weighted-average cost (CUMP) is calculated per item, location and purpose bucket. Delivery and transfer costs are derived from the persistent movement history; operators no longer enter a delivery/transfer cost manually.
- PCG 2005 accounts 603 and 707 are present in the account catalogue. Versioned `accounting_posting_rules` define the resale-stock receipt and issue mappings. Resale receipts and sales issues create durable accounting outbox events. When an open accounting period and valid mappings are available, the event is posted through `magnisa_post_journal`; otherwise it remains pending with the error and can be retried from `/mouvements-stock`. Physical movement is not rolled back merely because the accounting period is not open.
- The order item-line RPC classifies sold catalogue goods as merchandise, preserves the price/tax snapshot and refuses additions after invoice or delivery activity has begun.

This increment implements CUMP, not FIFO. Company-use and consumption buckets are separated but their expense/asset accounting rules are not yet complete. Supplier returns, customer returns/credit notes, delivery cancellation/reversal, historical as-of reconstruction and the complete mixed merchandise/service invoice workflow remain release blockers. Do not infer completion of the whole purchase-to-cash cycle from the availability and delivery screens.

## Remaining release blockers

- Serial-number capture and a dedicated fixed-asset acquisition workflow linked to the fixed-asset register.
- Supplier invoice matching, supplier payments, mandate settlement and supplier credit-note reconciliation.
- Quote creation and quote-to-order conversion with mixed service and merchandise lines; the current item-add workflow attaches merchandise to an already-confirmed order.
- Customer credit-note issuance and refund settlement linked to returned quantities and original invoice lines.
- End-to-end browser tests for the new procurement, stock, delivery, return and mixed-invoice screens. The current authenticated SQL integration suite validates database workflows, not the complete browser journey.
- A genuinely concurrent two-session reservation test; current SQL tests verify oversubscription prevention sequentially and the RPC serializes competing requests with advisory locks.
- Full accounting treatment for company-use and consumption buckets, damaged-stock impairment and quarantine disposition.
- FIFO as an alternative method; the current implementation uses moving weighted average (CUMP).
- Migration promotion planning against the live production history, dry-run, verified backup and restore evidence. No production migration has been applied.

The invoice workflow supports service and merchandise lines sourced from an order, and merchandise invoicing is limited to delivered, not-yet-invoiced quantities. Returns currently create persistent stock return records and compensating stock movements; they do not yet issue a credit note or execute a customer refund. Do not treat a stock return as a credit note or refund.

## Implementation phases

1. Domain classification and evidence rules.
2. Item catalogue, supplier purchase lines, stock locations and immutable stock movements (this branch).
3. Mixed commercial document lines linked to either a service or an item, preserving historical price and tax snapshots.
4. Operation/event ledger with unique idempotency keys and source traceability.
5. Atomic RPC workflows for stock issues, deliveries, returns, customer advances, mandates and journal posting.
6. Procurement UI activation by organization feature and inventory permissions (first multi-line order and partial-receipt screen delivered in this increment).
7. Integration tests for complete workflows, reversals, tenant isolation and financial statement impact.

No production data or schema is changed by this branch. The migration remains pending review and clean-database replay.
