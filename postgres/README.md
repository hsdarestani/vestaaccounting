# PostgreSQL migration candidate

`001_ledger.sql` targets a **new isolated PostgreSQL database**, with versioned schema, bigint Toman values, unique source identities, concurrency-safe journal and inventory guards, fiscal-period locks, immutable audit history, and a posted trial-balance view. Apply with `psql -v ON_ERROR_STOP=1 -f postgres/001_ledger.sql` in a separately provisioned database. `acceptance.sql` runs on a disposable database and rolls back its fixtures.

This is the future database foundation; no production application binding, data migration, role provisioning, or backup/restore certification is implied. The deployed evaluation remains isolated D1. Do not connect this migration to a live WooCommerce database. A complete transactional adapter, database role grants, migration of validated openings and accountant approval are prerequisites for production.
