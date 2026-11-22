#!/usr/bin/env bash
# READ-ONLY: aggregate expected Woo variations from their parent products.
# Emits only counts, never identifiers, order/customer data, or credentials.
set -Eeuo pipefail
cd /srv/vesta-accounting/release/runtime
root=/srv/vesta-accounting/private
test -s "$root/.compose.env"
docker compose --env-file "$root/.compose.env" -f compose.yml -f "$root/compose.source-sync.yml" \
  --profile source-sync exec -T postgres psql -X -U accounting -d vesta_accounting -At -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout='20000ms';
WITH parents AS (
  SELECT c.external_id AS parent_id,
         r.payload->'variations' AS variations
  FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
  WHERE c.kind='products' AND r.payload->>'type'='variable'
),
manifest AS (
  SELECT p.parent_id,j.value AS variation_id
  FROM parents p
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(p.variations)='array' THEN p.variations ELSE '[]'::jsonb END
  ) j(value)
),
source_variations AS (
  SELECT parent_id,external_id AS variation_id FROM raw_current WHERE kind='variations'
)
SELECT 'variation_manifest='||
  'variable_parent_products='||(SELECT COUNT(*) FROM parents)||
  ' product_variation_references='||(SELECT COUNT(*) FROM manifest)||
  ' unique_variations='||(SELECT COUNT(*) FROM (SELECT DISTINCT parent_id,variation_id FROM manifest) u)||
  ' imported_variations='||(SELECT COUNT(*) FROM source_variations)||
  ' missing_from_postgres='||(SELECT COUNT(*) FROM (SELECT DISTINCT parent_id,variation_id FROM manifest) m WHERE NOT EXISTS (
    SELECT 1 FROM source_variations v WHERE v.parent_id=m.parent_id AND v.variation_id=m.variation_id
  ))||
  ' unexpected_stored_variations='||(SELECT COUNT(*) FROM source_variations v WHERE NOT EXISTS (
    SELECT 1 FROM manifest m WHERE m.parent_id=v.parent_id AND m.variation_id=v.variation_id
  ))||
  ' incomplete_parent_manifests='||(SELECT COUNT(*) FROM parents WHERE jsonb_typeof(variations) IS DISTINCT FROM 'array');
SELECT 'variation_sync='||status||' processed='||processed_count||
       ' expected='||COALESCE(expected_count::text,'pending')||
       ' last_error='||COALESCE(last_error,'none')
FROM sync_state WHERE kind='variations';
SELECT 'all_seven_complete='||
 CASE WHEN COUNT(*)=7 AND COUNT(*) FILTER(WHERE status='complete')=7 THEN 'true' ELSE 'false' END
FROM sync_state WHERE kind IN('products','variations','orders','customers','refunds','coupons','categories');
COMMIT;
SQL
