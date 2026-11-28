# Vesta Accounting — release tracker

Baseline: production release `8853d5e1cce91bd7d6ab1348a74cbca00ed39a76`.

## Phase one: operational workspace

- Consolidate the sidebar into ten business sections; retain previous source, opening and reconciliation views under grouped navigation.
- Dashboard: Jalali today/week/month/year/custom ranges; current completed-order gross amounts (before refunds, distinctly not accounting revenue), exact Toman conversion, actionable alerts, operational entry points, and explicit unknown ledger metrics pending approval.
- Purchasing: authenticated catalog search by name, variation and SKU; no manual WooCommerce IDs; Jalali receipt date, exact decimal row summation, and Persian digits. Existing credit purchase evidence validation and immutable storage remain intact.
- Preserve posting guard, read-only WooCommerce integration, existing credentials, production records, backup and rollback infrastructure. No production synthetic financial records.
- Local SQLite evaluation: 108 API assertions passed. PostgreSQL acceptance and production browser checks passed through the existing CI/deployment.

## Next phases / remaining limits

- Operational purchase forms for cash/mixed purchases, linked receipts, partial/recurring expenses, bank statement import and transaction matching, gateway settlement automation, inventory returns and adjustments; draft evidence is not a posted financial transaction. Basic bank/cash transfer and receipt evidence now exists (phase four).
- Collect and reconcile actual opening balance bridge evidence, physical stock and historic acquisition costs, including review of estimates. Preserve fractional evidence until the ledger supports exact amounts.
- Establish approved accounting scope/policies, opening journal, precise ledger, controlled posting, version-aware automated documents, reversals, periods, roles, attachments, and ledger-backed reports before replacing the legacy accounting system.
- Obtain actual bank statements/provider settlements, supplier payment evidence, and owner/accountant approval where unavailable. Do not invent values or infer bank receipt from Woo payment status.
- No tax/legal compliance claim; verify applicable Iranian rules with qualified accountant before final approval.

Phase one: PR #37 merged, PostgreSQL 197 HTTP assertions passed (including restore), evaluation suite passed, deployment run 46136804959 successful.

## Phase two: expense categories and counterparties

- Add 17 operational expense categories, configurable names and active/inactive status; historical evidence remains intact and its original account mapping is preserved.
- Category and payment status drive expense form fields. Existing accounting evidence without a category remains explicitly uncategorized.
- Authorized owner can create customers/suppliers using a human-readable form with automatic internal reference. This is not automatic WooCommerce identity matching or opening balance posting.
- Continue to label partial source dashboard values as incomplete when dates or source refresh are missing.

Phase one deployed and verified: release b0c106beb421e287e734b9ae51f685c13a2afb1f, run 46136804959, 51 authenticated screens passed. Phase two PR #38 deployed and verified after 206 PostgreSQL HTTP assertions passed; release e281c422d1d6a6d0ebc9266b8d8b7f6f9ed00ca0, run 46137341384, 51 screens.

## Phase three: bulk opening stock reconciliation

- Export a spreadsheet-ready CSV template for all unreconciled snapshot items; source identities are prefilled and reference quantities are explicitly informational.
- Import filled physical count, receipts and issues in exact non-negative integers with dry preview, explicit common observation time/evidence and completeness confirmation. Blank rows are skipped, not interpreted as zero.
- Each request of up to 100 rows is database-atomic and locks capture identities; replay of identical rows is harmless, conflicting existing evidence requires separate review, and a failed request cannot partly save its rows. Earlier successful batches are shown transparently and can be retried without duplicate evidence.
- No synthetic production records, store writes or journal posting.
- Prevent unverified ledger balances and accounting report totals from appearing as zero in finance views or their standard exports; raw evidence reports remain available with their existing labels.

## Phase four: bank and cash movement evidence

- Add actual-source evidence forms for bank/cash transfers (both statement references), customer receipts/deposits, owner contributions/withdrawals and loan receipts; exact Toman amounts, Jalali dates, human-readable account/customer selectors.
- Create balanced, idempotent drafts under open-period and precision controls. Existing expense, settlement and supplier payment flows share the same bank-reference lock and duplicate checks; no inference of money received from WooCommerce status.
- Account mapping is additive and fails safely if existing account codes conflict. Posting remains gated pending opening reconciliation and owner/accountant approval.

## Verified production status (2026-11-28)

| PR | Scope | PostgreSQL HTTP assertions | Production deployment run | Authenticated screens |
|---|---|---:|---|---:|
| 37 | Workspace and purchase catalog | 197 | 46136804959 | 51 |
| 38 | Expense categories and counterparties | 206 | 46137341384 | 51 |
| 39 | Bulk stock evidence and unknown-report labels | 212 | 46137953244 | 51 |
| 40 | Bank/cash evidence and draft controls | 225 | 46138701389 | 52 |

Latest verified application release: `de42ac4c481b03ddc1c9403918ecdedcbd460429`; `/health` confirmed PostgreSQL, source mode, healthy, store writes false, posting authorized false. Backup, synthetic PostgreSQL acceptance, production authenticated HTTPS browser tests and rollback protection completed through the authorized upgrade workflow. No synthetic production ledger records were created.

Readiness at the latest production verification: 12/12 missing opening balance bridge evidence rows; 5,686/5,686 stock reconciliation rows lack evidence; 147 captured quantities missing; 2,434 purchase costs imported, of which the estimated-cost review identifies 1,072 estimates and 91 priority items; 3 open exceptions; no settlement evidence recorded. WooCommerce first sync completed, current refresh in progress, no source error reported; no refund rows imported at verification. These are counts, not certified balances. The ledger is not yet authoritative; Vesta is not yet a complete replacement for the legacy system.

## Phase five: bank statement import and reconciliation

- CSV/TSV UTF-8 import from Excel with header mapping, selected bank/currency/calendar, split credit/debit or single amount/direction, local preview and explicit confirmation. Original currency/amount and exact converted Toman preserved; no fabricated bank transaction or automatic journal.
- Immutable row identity per bank/reference; atomic batch validation, conflict detection, idempotent replay and exact reference/date/direction/amount matching to settlement, paid expense, supplier payment and bank movement evidence.
- Owner-confirmed alternatives require equal account/date/direction/amount and documentary note; prohibit reused/conflicting evidence. Unmatched/conflicting rows remain reviewable and filterable; no WooCommerce payment status treated as banking evidence.
- PR #41 deployed successfully: release `16e131adfe588efd3b04bca6b23cdfd4b7e1cdb3`, run 46141070184, 235 PostgreSQL HTTP assertions, 53 authenticated screens.

## Phase six: exact Toman ledger, opening approval and controlled posting

- Add non-rounding exact decimal ledger lines, immutable posting authorizations, workbook/report exact totals, source-specific posted-ledger dashboard and reports. No migration changes raw source amounts or opening balances.
- Complete software opening approval: snapshot digest over reconciled balances and inventory revisions; full scope/valuation confirmation, atomic opening journal and inventory seed, protected opening evidence after approval. Incomplete evidence and stale previews are rejected. Production remains closed until real evidence and owner approval.
- Controlled two-step approval/posting for documented bank, expense, supplier-payment and settlement drafts with matched bank statement references and sufficient balances; manual exact drafts and reversals for non-control accounts; period close/reopen with audit. Inventory-linked posting remains held for the next dedicated stock engine.
- Toman is the accounting unit globally. Raw Woo records are retained with original currency; views convert IRR once, never convert IRT, unknown currencies remain unknown. Source detail and catalog display amounts in Toman, including fractional precision. Exact Persian formatting and Toman-labeled exports. Bank source amount/currency retained, audit reports conversion mismatches and imported opening counts without changing existing Toman values.
- Synthetic isolated schema acceptance verified the actual positive opening/approval/posting lifecycle, statement evidence, balance sheet, ledger, reversal and period controls without production synthetic data. PR #42 deployed successfully: release `45b8908613d51fc3a16309db0c20d51a77509e0e`, run 46142502878, 239 PostgreSQL HTTP assertions, 53 authenticated screens. Actual production posting remains closed pending complete opening evidence and approval.

## Phase seven: continuous inventory and automatic WooCommerce draft queue

- Persistent source order/revision queue, bounded automatic generation and explicit retry; opening/period and source validation, no duplicate draft or autonomous financial posting.
- Atomic purchase and completed-sale posting: source-revision and draft-line verification, exact Toman movement ledger, weighted-average COGS with fractional remainder retained in residual inventory, chronological validation, immutable identity/version, no negative stock and no writes to WooCommerce. For inventory docs approval and posting are one explicit reviewed atomic operation to avoid stale valuation between stages.
- Physical saleable return evidence restores proportional original sale cost; financial receivable reversal is separate and checks current refund revision and remaining posted receivable. Documented damage, loss, expiry, stock deficit and value-backed increases; backdated events rejected for review rather than silently changing historical COGS.
- Posted sales, purchases, expenses, payments, settlements, inventory movements and product margin reports use exact source ledger/events, not live Woo stock or raw revenue. Isolated synthetic tests cover purchase, paid/unpaid-independent sale, partial financial return plus physical return, damage, negative/backdated/replay checks and exact valuation tie.
