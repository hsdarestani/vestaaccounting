#!/usr/bin/env bash
# Read-only financial/source readiness snapshot. Never emit customers, order IDs, secrets or payloads.
set -Eeuo pipefail
cd /srv/vesta-accounting/release/runtime
root=/srv/vesta-accounting/private
test -f "$root/installed" && test -s "$root/.compose.env"
compose() {
  docker compose --env-file "$root/.compose.env" -f compose.yml -f "$root/compose.source-sync.yml" --profile source-sync "$@"
}
echo "accounting_source_audit=begin"
curl -fsS --max-time 10 http://127.0.0.1:18089/health |
  python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("database")=="postgresql" and x.get("posting_authorized") is False;print("financial_posting=disabled");print("runtime_postgres=healthy")'
compose exec -T postgres psql -X -U accounting -d vesta_accounting -At -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout='15000ms';
WITH counts AS (SELECT kind,COUNT(*) n FROM raw_current GROUP BY kind)
SELECT 'collection='||s.kind||
       ' status='||s.status||
       ' stored='||COALESCE(c.n,0)||
       ' processed='||s.processed_count||
       ' expected='||COALESCE(s.expected_count::text,'pending')||
       ' last_success='||COALESCE(to_char(s.last_success AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'never')||
       ' error='||CASE WHEN s.last_error IN
       ('sync_failed','read_only_credentials_missing','catalog_empty','count_changed',
        'source_timeout','pagination_headers_missing','invalid_source_page','invalid_source_identity')
       OR s.last_error ~ '^woo_http_[0-9]{3}$' THEN s.last_error ELSE 'none' END
FROM sync_state s LEFT JOIN counts c USING(kind)
WHERE s.kind IN('products','variations','orders','customers','refunds','coupons','categories')
ORDER BY s.kind;
SELECT 'full_cycle_completed='||
       CASE WHEN COUNT(*)=7 AND COUNT(*) FILTER(WHERE status='complete')=7 THEN 'true' ELSE 'false' END
FROM sync_state WHERE kind IN('products','variations','orders','customers','refunds','coupons','categories');
SELECT 'last_full_sync='||COALESCE(to_char(last_success AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'never')||
       ' global_error='||CASE WHEN last_error IN
       ('sync_failed','read_only_credentials_missing','catalog_empty','count_changed',
        'source_timeout','pagination_headers_missing','invalid_source_page','invalid_source_identity')
       OR last_error ~ '^woo_http_[0-9]{3}$' THEN last_error ELSE 'none' END
FROM sync_control WHERE id=1;
SELECT 'posted_financial_journals='||COUNT(*) FROM journals WHERE status='posted';
SELECT 'posted_journal_imbalance='||COALESCE(SUM(l.debit::numeric-l.credit::numeric),0)
FROM lines l JOIN journals j ON j.id=l.journal WHERE j.status='posted';
SELECT 'orphan_variation_sources='||COUNT(*) FROM raw_current v
WHERE v.kind='variations' AND NOT EXISTS(
  SELECT 1 FROM raw_current p WHERE p.kind='products' AND p.external_id=v.parent_id AND p.parent_id=''
);
SELECT 'orphan_refund_sources='||COUNT(*) FROM raw_current r
WHERE r.kind='refunds' AND NOT EXISTS(
  SELECT 1 FROM raw_current o WHERE o.kind='orders' AND o.external_id=r.parent_id AND o.parent_id=''
);
SELECT 'recent_run='||status||' at='||to_char(started AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM sync_runs ORDER BY started DESC LIMIT 1;
COMMIT;
SQL
echo "accounting_source_audit=end"
