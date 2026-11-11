# MAGNISA — Universal commercial and operational model

## Architecture

Commercial documents, operational execution and accounting events are separate layers.

- **Commercial:** quotes, contracts, orders, invoices, credit notes and customer relationships.
- **Operational:** procurement, receipts, reservations, deliveries, transfers, consumption, subcontracting, returns, quarantine and warranty.
- **Accounting:** dated economic events, supporting evidence, tax treatment, versioned PCG posting rules, journal entries and settlements.

A commercial label alone never selects a PCG account. Posting is determined by the underlying economic event, supporting documents, organization-specific configuration and the versioned accounting engine.

## Operation and ownership classification

The operation registry distinguishes service delivery, merchandise resale, third-party mandates, customer-supplied goods, mixed supply, procurement, inventory, subcontracting, rental, recurring contracts, advances, guarantees, returns, reimbursable expenses, foreign currency and internal transfers.

The classification is not a chart of accounts. One order or invoice can contain lines with different operational and accounting treatment.

Key controls:

- Merchandise resale requires evidence that the organization acts as principal and owns goods acquired for resale.
- A customer mandate requires a documented mandate, supplier evidence in the customer's name, no substantive goods risk borne by the organization and exact-cost reconciliation.
- Customer-owned goods do not become company inventory.
- Customer advances, refundable deposits, guarantees, third-party reimbursements and service fees remain distinct events.
- Physical receipts and stock movements do not automatically create supplier expense or inventory journals. Supplier invoices and the configured inventory method determine accounting recognition.

## Procurement and supplier accounting

The organization-scoped catalogue, supplier purchase orders and goods-receipt workflow support partial receipts and immutable receipt traceability.

- Purchase purposes distinguish resale, customer mandate, company use and consumption.
- Goods receipts validate organization access, purchase-order state, remaining quantities and over-receipt.
- Customer-mandate receipts are excluded from company-owned stock.
- Supplier invoices can be matched to receipts and purchase-order lines, with quantity and value variance controls and explicit variance reasons.
- One supplier invoice can reconcile against several purchase orders. HT, VAT and TTC amounts are retained for the matching and settlement process.
- Customer-mandate settlement reconciles the named customer, supplier document, exact supplier cost and related payment flows.
- The catalogue supports a configurable PCG expense account by item. Fixed-asset reclassification remains explicit and evidence-based; an ordinary supplier invoice is not automatically treated as an asset acquisition.

## Stock subledger

The stock ledger is append-only. Corrections use compensating movements rather than editing or deleting historical movements.

- Reservations and deliveries are separate from invoices. Reservations are serialized with transaction-scoped advisory locks and checked against both available stock and undelivered order quantities.
- Partial and full deliveries create stock movements and fulfil the related reservations atomically.
- Transfers create paired outgoing and incoming movements and cannot consume reserved stock.
- Stock quantities are separated into resale, company-use, consumption and quarantine buckets. Customer-mandate receipts do not increase company-owned stock.
- Moving weighted-average cost (CUMP) is calculated by item, location and purpose bucket. This implementation does not claim FIFO valuation.
- Internal issues for company use or consumption use the expense account configured on the catalogue item and create accounting events.
- Quarantine disposition is controlled. A release records inspection/reclassification evidence and transfers quantity to resale, company use or consumption without rewriting the original movement.
- Customer and supplier returns are linked to the originating delivery or receipt, enforce quantity limits, create compensating stock movements and post the corresponding accounting events.
- Stock adjustments and delivery/transfer cancellations are represented by traceable compensating movements.
- Historical stock balances can be reconstructed as of a timestamp from the movement ledger.

## Customer credits, refunds and mixed invoices

Customer credit notes and full or partial refunds are controlled against the source invoice and outstanding refundable balance. The workflow is idempotent and posts accounting entries through the accounting engine.

The commercial model supports service and merchandise lines with source-order traceability and price/tax snapshots. Merchandise invoicing is limited to eligible delivered, not-yet-invoiced quantities. A stock return, by itself, is not a credit note or a cash refund: the credit and settlement steps remain separate accounting events.

## Accounting and security

- Stock accounting events use a durable outbox and idempotent processing. Physical operations are not silently discarded because an accounting period or mapping is unavailable; unresolved posting events remain visible for correction and retry.
- PCG postings use the existing versioned accounting posting rules and journal engine. No generic commercial category is allowed to choose accounts by itself.
- Organization isolation, authenticated RPC checks, RLS, restricted anonymous grants, idempotency keys and immutable movement traceability apply to the new workflows.
- Treasury, supplier payments, journals and stock valuation retain separate reconciliation controls.

## Database migration history

The production Supabase ledger was inspected read-only and contained **197 migration records**, with head `20261110100000`.

- All 197 production versions have exact local version/name counterparts.
- The local SQL files for those versions were reconstructed from the production migration ledger, preserving the production SQL statements.
- The migration preflight compares version, name and SQL statement SHA-256 when connected to the production ledger. It rejects unverified history, duplicate versions, out-of-order migrations and unreviewed pending files.
- Eleven new forward migrations follow the production head and are the only versions in `production-pending-allowlist.txt`.
- One local-only compatibility bootstrap, `20261031123421`, is listed in `production-local-replay-only.txt`. It is included in clean replay only and is rejected by the production migration path.
- Previously reconstructed development SQL is retained outside the top-level migration directory as non-executable archive evidence.

## Verification status

The current branch head is `14dadaf302535dba921d90058963ffcd14deb33c`.

- **MAGNISA CI run 2618: success.** Migration-script syntax, migration-history guard fixtures, dependency audit, production build, Vitest and inspection of all 33 PDF files passed.
- **Supabase migration replay run 1194: success.** All migrations replayed from a clean PostgreSQL 17 database.
- **Database invariants: success.** Supplier invoice matching, VAT, multi-order matching, mandate settlement, RPC grants, stock reservations, deliveries, transfers, anonymous-access restrictions, payroll, fiscal-year controls, fixed assets, PCG 581 and collaborative CRM checks passed.
- **Authenticated integration tests: success.** Stock and tenant-isolation workflows, two-session concurrent reservation, fixed-asset accounting and RLS, CRM commission splits and payroll payment lifecycle passed.
- **Authenticated browser smoke tests: success.** Payroll/fixed-asset actions, CRM actions, and stock reservation/delivery actions passed.

## Remaining release gates

The feature implementation and current automated verification are green. That does not itself authorize production deployment.

1. Rehearse a restorable, isolated production snapshot and verify backup restoration before a production release.
2. Run a dedicated end-to-end browser journey across procurement, supplier receipt, supplier invoice matching, quote/order, mixed invoicing, payment, returns, credit notes and refunds. The current browser suite is authenticated smoke coverage, not yet one continuous purchase-to-cash journey.
3. Review the final production dry-run and backup artifact for the exact release commit. Production apply is a separate, explicit approval step.
4. Merge the pull request only after the release gates and required review are accepted.

No production migration, production data, Vercel deployment or pull-request merge was performed as part of this verification.
