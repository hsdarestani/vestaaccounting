# Vesta Accounting — evaluation foundation

**Release 0.1.0: independent accounting foundation, not production software.** This repository contains code and synthetic fixtures only. Do not use real customer data or connect live financial workflows to this release. Nothing here changes an external store or legacy accounting integration.

## Run isolated development

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt httpx==0.28.1
python -m unittest discover -s tests -v
python -m vesta init
python -m vesta user owner owner
VESTA_LOCAL_HTTP=1 uvicorn vesta.api:create_app --factory --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000, sign in with the newly created user, define a synthetic fiscal period (Gregorian inputs, Persian/Jalali display), then draft a balanced journal. Approve and post it only to the synthetic evaluation database. Trial balance and CSV reflect only posted entries. There are no default credentials. Local HTTP mode is for loopback evaluation only.

Optional container evaluation (not tested on production): `docker compose -f compose.evaluation.yml up --build -d`. Create the owner with `docker compose -f compose.evaluation.yml exec accounting-evaluation python -m vesta user owner owner`. The container binds only localhost; never expose this evaluation service externally. Docker resources are ceilings, not a host capacity measurement.

## Implemented

- Independent modular Python/FastAPI application; SQLite transactional evaluation store with integrity triggers, integer Toman, source uniqueness, balanced postings, immutable lines, approvals, reversals and period locking.
- Immutable evidence ingestion with a timestamped HMAC contract, delivery and business-level deduplication, historical cutover gating, explicit conflict/review states and deterministic draft rules.
- Separate payment clearing and customer advance handling; provisional fulfilled sales, shipping, discount and tax examples; settlement fee equations; purchase, supplier payment and expense examples.
- Stable product/variation identity, evidence-based opening quantity reference, explicitly unknown opening costs, no external stock writes.
- Persian responsive RTL interface, manual documents, journal details, approval/post/reversal, opening references, period controls, event review, configurable account codes, account/detail ledger, trial balance export and audit listing.
- GET-only WooCommerce REST v3 snapshot collector; explicit credentials are needed for real authorized reads. Commercial order snapshots do not establish payment or financial posting evidence.
- Local role-based authentication, server-side permissions, password hashing, session cookies, CSRF checks, bounded login attempts and synthetic tests.

## Deliberate release limitations

No production readiness claims: PostgreSQL and migration tooling, production deployment, MFA, independent security review, full inventory valuation and COGS, journal-integrated inventory, real purchase invoice workflows, partial refund lifecycle, bank reconciliation and provider APIs, automatic recovery/polling jobs, full statements and account hierarchy, statutory invoice/tax integration, verified backups, and accountant-approved posting policies remain gates. The existing SQLite implementation is a testable first foundation, not a final deployment choice.

Evidence contract is custom, not native WooCommerce webhook HMAC. Only signed normalized evidence is accepted; even that creates a **draft** after an authorized operator expressly processes it. No provider credentials, store origin, live financial records or actual cutover date are distributed with the repository.

See [accountant review notes](docs/ACCOUNTANT-REVIEW.md), [operations and release gates](docs/OPERATIONS.md).
