# Operational and release controls

## Isolation

The evaluation process has its own database and never accesses an external database. Use synthetic test fixtures, loopback ports and no production credentials. The GET-only reader in `vesta/woocommerce.py` is intentionally separate from the API, is never scheduled automatically, requires HTTPS, rejects redirects and has bounded pagination and response sizes. See the official [WooCommerce REST API](https://woocommerce.github.io/woocommerce-rest-api-docs/). Its catalog collection is not an atomic physical count;
record both collection timestamps and reconcile changes against a second snapshot before using opening quantities.

## Safe hosting decision

Take an authorized read-only audit of the intended host before choosing shared or isolated hosting. Measure actual load, available RAM and swap, disk space and I/O, database and container memory, workers, recent peak indicators and backup headroom. `scripts/capacity-audit.sh` provides a bounded host-side starting point without secrets. It does not perform load tests, trigger restarts or change configuration. A single sample is not enough: examine peak-period telemetry and test isolated workloads on synthetic data. Until verified, prefer an isolated staging host; no live deployment is authorized by these manifests.

## Release gates

1. Review accounting policy and source ownership; approve opening and cutoff evidence separately. Historical records are references only.
2. Build PostgreSQL migrations and run the same invariants under production concurrency, role grants and database-level constraints; verify backups by restoring to isolated infrastructure.
3. Complete verified order/receipt/settlement/bank and product/quantity/cost reconciliation, with durable workers, retries and exception queue recovery. Test WooCommerce read-only connectivity and exact currency mapping.
4. Validate the configured password-only authentication, session controls, authorization, encrypted backups, resource limits and monitoring. Collect accountant sign-off and independent security/operations acceptance before financial cutover.
5. Perform safe shadow comparisons and obtain explicit owner cutover approval. Do not enable live writes or disable a legacy integration as part of build or tests.

Rollback: disable new ingestion and recurring workers, preserve all posted documents and audit trails, restore a tested application version against a compatible database, and keep the previous operational system available until acceptance. Never delete posted records to roll back software. No production cutover tooling is included in this evaluation release.
