# Accountant review — synthetic rules v1

Status: proposed and testable, **not accountant-approved**. Account codes and labels are in `vesta/ledger.py`. Every entry is integer Toman. The separate normalization helper records original value, explicit source unit, divisor and normalized amount. Fractional Toman is rejected rather than rounded. Source-provided currency units must be verified independently before using the helper.

| Event (synthetic) | Debit | Credit | Evidence and caveat |
| --- | --- | --- | --- |
| Confirmed payment, 100,000 | gateway clearing 100,000 | customer advance 100,000 | independent payment identifier, not order status |
| Fulfilled sale, subtotal 100,000, discount 10,000, shipping 15,000, tax 0 | receivable 105,000; discount 10,000 | merchandise sales 100,000; shipping revenue 15,000 | fulfillment and exact totals; tax is supplied, never inferred |
| Advance allocation, 100,000 | customer advance | receivable | independently match original payment and sale; no automatic allocation in this build |
| Settlement gross 100,000, net 97,000 | bank 97,000; fees 3,000 | clearing 100,000 | batch and actual bank record, separate from callback |
| Purchase invoice 100,000 | inventory 100,000 | supplier payable 100,000 | verified receipt; inventory subledger coupling is a later gate |
| Expense 10,000 | mapped expense 10,000 | bank/cash 10,000 | receipt and approved classification |
| Refund before fulfillment, 20,000 | customer advance 20,000 | mapped clearing 20,000 | original payment and refund evidence |

No COGS or profit verification is possible while opening costs, inventory movements, reconciliation and financial opening balances are unverified. The dashboard explicitly labels posted ledger values as incomplete. The legal treatment of taxes, timing of sales recognition, discounts, shipping, receivables, advances and refunds must be reviewed before production use. Partial and post-fulfillment refunds require a complete policy and source-link implementation; unsupported types enter review instead of being guessed.

Opening procedure to be completed: timestamp stock snapshots, validate sellable versus physical quantity, collect purchase-cost evidence, reconcile bank/cash, receivables, payables and clearing balances, preview balanced opening entries, require accountant and owner approval, record effective cutover. Current functionality records an opening quantity reference and a cutover date but does not create an automatic opening financial document.

Fiscal locks prevent posting and require owner action with a reason to reopen. Corrections use exact inverse reversal drafts and require approval/post transitions. Closing rules and financial statements need further review.

Tax readiness remains unverified: obtain current official taxpayer-system, electronic invoice, VAT, exemptions and taxpayer registration requirements applicable to the entity. Do not infer rates, invoice schema or remittance duties from this sample chart. Review with an Iranian professional accountant and preserve official versioned policy evidence.
