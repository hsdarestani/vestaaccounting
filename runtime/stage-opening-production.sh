#!/usr/bin/env bash
# Receive the reviewed SQL over SSH and stage evidence in the installed accounting database.
set -Eeuo pipefail
umask 077
root=/srv/vesta-accounting
cd "$root"
test -f private/installed
exec 9>"$root/.install.lock"
flock -n 9
sql=$(mktemp "$root/private/opening-inputs.XXXXXXXX")
trap 'rm -f -- "$sql"' EXIT
cat > "$sql"
test -s "$sql"
cd release/runtime
compose() { docker compose --env-file "$root/private/.compose.env" -f compose.yml "$@"; }
snapshot=$(mktemp -d "$root/backups/opening-inputs.XXXXXXXX")
compose exec -T postgres pg_dump -U accounting -d vesta_accounting -Fc > "$snapshot/accounting.dump"
test -s "$snapshot/accounting.dump"
compose exec -T postgres pg_restore --exit-on-error --file=/dev/null < "$snapshot/accounting.dump"
(cd "$snapshot" && sha256sum accounting.dump > SHA256SUMS && sha256sum -c SHA256SUMS)
echo "opening_backup_verified=$(basename "$snapshot")"
# Suppress SQL error detail because the Actions logs are public.
if ! compose exec -T postgres psql -X -q -U accounting -d vesta_accounting -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -o /dev/null < "$sql" 2>"$snapshot/stage-errors.log"; then
  sed -nE 's/^psql:<stdin>:([0-9]+): ERROR:  ([0-9A-Z]{5}):.*/opening_sql_error_line=\1 sqlstate=\2/p' "$snapshot/stage-errors.log"
  echo 'Opening input transaction or its SQL checks failed. Inspect the protected server log.'
  exit 1
fi
compose exec -T postgres psql -X -A -t -U accounting -d vesta_accounting -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout='45s';
SELECT 'price_rows='||count(*)||' unique_ids='||count(DISTINCT external_id)||
 ' references='||count(*) FILTER(WHERE cost_status='reference')||
 ' manual='||count(*) FILTER(WHERE cost_status='owner_entered')||
 ' estimates='||count(*) FILTER(WHERE cost_status='estimate')||
 ' priority_review='||count(*) FILTER(WHERE priority_review)
 FROM opening_input_costs_v1;
SELECT 'balance_rows='||count(*) FROM opening_input_balances_v1 WHERE evidence_date='2026-11-26';
SELECT 'financial_result balances '||account_kind||'='||sum(amount_toman)
 FROM opening_input_balances_v1 WHERE evidence_date='2026-11-26' GROUP BY account_kind ORDER BY account_kind;
SELECT 'capture='||coalesce((SELECT observed_at::text FROM opening_capture WHERE id=1),'missing');
WITH stock AS (
 SELECT i.*,count(*) OVER(PARTITION BY source_kind,external_id) AS occurrences FROM opening_capture_items i
), valued AS (
 SELECT s.*,c.unit_cost_toman,c.cost_status,
  (s.stock_status='instock' AND s.stock_quantity>0 AND s.occurrences=1
    AND (s.source_kind='products' OR s.parent_id ~ '^[1-9][0-9]*$')) AS eligible
 FROM stock s LEFT JOIN opening_input_costs_v1 c ON c.external_id::text=s.external_id AND c.source_kind=s.source_kind
)
SELECT 'snapshot_rows='||count(*)||
 ' unknown_quantity='||count(*) FILTER(WHERE stock_status<>'outofstock' AND stock_quantity IS NULL)||
 ' negative_quantity='||count(*) FILTER(WHERE stock_quantity<0)||
 ' out_of_stock='||count(*) FILTER(WHERE stock_status='outofstock')||
 ' duplicate_identity_rows='||count(*) FILTER(WHERE occurrences>1)||
 ' eligible_missing_price='||count(*) FILTER(WHERE eligible AND unit_cost_toman IS NULL)||
 ' eligible_priced='||count(*) FILTER(WHERE eligible AND unit_cost_toman IS NOT NULL)||
 ' estimated_items='||count(*) FILTER(WHERE eligible AND cost_status='estimate')
 FROM valued;
WITH eligible AS (
 SELECT i.*, count(*) OVER(PARTITION BY source_kind,external_id) AS occurrences FROM opening_capture_items i
)
SELECT 'financial_result inventory '||c.cost_status||'='||sum(i.stock_quantity::numeric*c.unit_cost_toman)
 FROM eligible i JOIN opening_input_costs_v1 c ON c.external_id::text=i.external_id AND c.source_kind=i.source_kind
 WHERE i.stock_status='instock' AND i.stock_quantity>0 AND i.occurrences=1
 AND (i.source_kind='products' OR i.parent_id ~ '^[1-9][0-9]*$')
 GROUP BY c.cost_status ORDER BY c.cost_status;
SELECT 'unmatched_price_identities='||count(*) FROM opening_input_costs_v1 c
 WHERE NOT EXISTS(SELECT 1 FROM opening_live_review i WHERE i.external_id=c.external_id::text AND i.source_kind=c.source_kind);
SELECT 'cutover_activity source='||c.kind||' day='||left(r.payload->>'date_created',10)||' count='||count(*)
 FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id AND r.kind=c.kind
 WHERE c.kind IN('orders','refunds') AND left(r.payload->>'date_created',10) BETWEEN '2026-11-24' AND '2026-11-26'
 GROUP BY c.kind,left(r.payload->>'date_created',10) ORDER BY 1;
SELECT 'financial_documents='||count(*) FROM documents;
SELECT 'journal_status '||status||'='||count(*) FROM journals GROUP BY status ORDER BY status;
SELECT 'trial_difference='||coalesce(sum(l.debit::numeric-l.credit),0)
 FROM lines l JOIN journals j ON j.id=l.journal WHERE j.status='posted';
COMMIT;
SQL
