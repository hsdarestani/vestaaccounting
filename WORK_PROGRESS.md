# Vesta Accounting — release tracker

Baseline: production release `8853d5e1cce91bd7d6ab1348a74cbca00ed39a76`.

## Current phase: operational workspace

- Consolidate the sidebar into ten business sections; retain previous source, opening and reconciliation views under grouped navigation.
- Dashboard: Jalali today/week/month/year/custom ranges; current completed-order gross amounts (before refunds, distinctly not accounting revenue), exact Toman conversion, actionable alerts, operational entry points, and explicit unknown ledger metrics pending approval.
- Purchasing: authenticated catalog search by name, variation and SKU; no manual WooCommerce IDs; Jalali receipt date, exact decimal row summation, and Persian digits. Existing credit purchase evidence validation and immutable storage remain intact.
- Preserve posting guard, read-only WooCommerce integration, existing credentials, production records, backup and rollback infrastructure. No production synthetic financial records.
- Local SQLite evaluation: 108 API assertions passed. PostgreSQL acceptance and production browser checks must pass through the existing CI/deployment before release verification is claimed.

## Next phases / remaining limits

- Operational purchase forms for cash/mixed purchases, linked receipts, expenses, bank imports and transfers, gateway settlement matching, inventory returns and adjustments; draft evidence is not a posted financial transaction.
- Collect and reconcile actual opening balance bridge evidence, physical stock and historic acquisition costs, including review of estimates. Preserve fractional evidence until the ledger supports exact amounts.
- Establish approved accounting scope/policies, opening journal, precise ledger, controlled posting, version-aware automated documents, reversals, periods, roles, attachments, and ledger-backed reports before replacing the legacy accounting system.
- Obtain actual bank statements/provider settlements, supplier payment evidence, and owner/accountant approval where unavailable. Do not invent values or infer bank receipt from Woo payment status.
- No tax/legal compliance claim; verify applicable Iranian rules with qualified accountant before final approval.

Phase one: PR #37 merged, PostgreSQL 197 HTTP assertions passed (including restore), evaluation suite passed. Deployment run 46136804959; production browser verification must be confirmed.

## Phase two: expense categories and counterparties

- Add 17 operational expense categories, configurable names and active/inactive status; historical evidence remains intact and its original account mapping is preserved.
- Category and payment status drive expense form fields. Existing accounting evidence without a category remains explicitly uncategorized.
- Authorized owner can create customers/suppliers using a human-readable form with automatic internal reference. This is not automatic WooCommerce identity matching or opening balance posting.
- Continue to label partial source dashboard values as incomplete when dates or source refresh are missing.

Phase one deployed and verified: release b0c106beb421e287e734b9ae51f685c13a2afb1f, run 46136804959, 51 authenticated screens passed. Readiness at verification: 12 missing balance bridge rows, 5,686 missing stock reconciliation rows, 147 unknown captured quantities, 1,072 cost estimates (91 priority), 3 unresolved exceptions. Phase two PR #38 merged after 206 PostgreSQL HTTP assertions passed; production run must be verified.

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
