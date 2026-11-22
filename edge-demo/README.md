# HTTPS synthetic evaluation

This independent evaluation uses Cloudflare Workers and D1, intentionally not the live storefront or its database. Production financial use is prohibited. The original Python/FastAPI accounting foundation is retained; the edge evaluation uses the same chart and double-entry controls with D1 transactional batches and SQLite integrity triggers. PostgreSQL migration, professional review and verified production integrations remain release gates.

## Deployment contract

- Worker module: `worker.mjs`; dependency module: `ui.mjs`.
- `DB`: a **new, dedicated synthetic-only** D1 database. Apply `001_schema.sql` once via the D1 API; it contains only generic chart-of-accounts definitions.
- `RELEASE`: identifying Git commit; `DEMO_PASSWORD`, `REVIEWER_PASSWORD`, `IP_SALT`: secrets generated outside source control. Never deploy defaults. The reviewer password is optional and the role is read-only.
- `seed.mjs` creates fully artificial contacts, variations, purchases, sales, journals and examples by invoking the authenticated operation API. It must only be applied on an empty evaluation database, not on production.
- Bind only `hesab.vesta-cosmetics.ir` as the custom domain after verifying ownership, the Worker, and DNS conflicts. No modifications to any other record. Worker has no access to production databases or WooCommerce credentials.
- Verify `/health`, authentication, every API module and actual accounting balances, then open external HTTPS in a browser. If an import fails, inspect existing reference before retrying. No destructive reset of posted financial records.

## Tests

`node edge-demo/test.mjs` runs through the Worker request handler with a local transactional SQLite binding double, including seeded financial scenarios, journal and stock reconciliation, financial statements, duplicate protection, period locking, and viewer authorization. Deployed D1 needs its own acceptance tests. Python foundation suite: `python -m unittest discover -s tests -q`.

## Provisional accounting policies

Purchases increase inventory at the evidenced purchase plus shipping less discount cost; sales recognize revenue and an independent receivable with shipping and tax separated. Weighted-average costing uses integer rounding with residual inventory value assigned on the final unit. Full returns reverse the original journal and reinstate original consumed inventory cost. Payment and settlement are separate; settlements require an explicit bank reference and gross = net + fee, never a gateway callback alone. Unverified opening quantity is a reference and exception, not an invented value. Only explicit synthetic operations post, and direct manual journal reversal may not reverse an inventory-linked source document.

Known limits: only synthetic records, one item per document, no native production events, partial returns and purchase returns not implemented, no independent bank/provider API or live reconciliation, no uploaded attachments, no statutory invoice certification, no PDF/XLSX native export, no real production user directory/MFA, no validated production backups or PostgreSQL deployment. Gregorian form dates are labeled, displayed dates use Jalali. All financial values are evaluation-only and may not be relied upon for real accounting. Review `docs/ACCOUNTANT-REVIEW.md` before any migration or cutover.
