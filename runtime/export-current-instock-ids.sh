#!/usr/bin/env bash
set -Eeuo pipefail
cd /srv/vesta-accounting/release/runtime
root=/srv/vesta-accounting/private
docker compose --env-file "$root/.compose.env" -f compose.yml -f "$root/compose.source-sync.yml" --profile source-sync exec -T postgres psql -X -q -U accounting -d vesta_accounting -At -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout='30000ms';
COPY (
 SELECT c.kind,c.external_id,c.parent_id,
        coalesce(r.payload->>'stock_status','unknown') stock_status,
        coalesce(r.payload->>'manage_stock','unknown') manage_stock,
        coalesce(r.payload->>'stock_quantity','') stock_quantity,
        c.checked_at AT TIME ZONE 'UTC' checked_at_utc,
        coalesce(r.payload->>'name','') item_name
 FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
 WHERE ((c.kind='products' AND r.payload->>'type'='simple') OR c.kind='variations')
 AND r.payload->>'stock_status'='instock'
 ORDER BY c.kind,c.external_id::bigint
) TO STDOUT WITH (FORMAT csv,HEADER TRUE);
COMMIT;
SQL
