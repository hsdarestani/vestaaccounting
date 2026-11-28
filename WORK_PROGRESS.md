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

Release state: implementation in branch; production deployment not yet verified at time of writing.
