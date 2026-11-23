#!/usr/bin/env bash
# Read-only, aggregate-only opening readiness audit; no customer/financial payload exports.
set -Eeuo pipefail
cd /srv/vesta-accounting/release/runtime
root=/srv/vesta-accounting/private
compose() { docker compose --env-file "$root/.compose.env" -f compose.yml -f "$root/compose.source-sync.yml" --profile source-sync "$@"; }
test -s "$root/.compose.env"
echo opening_readiness_audit=begin
compose exec -T postgres psql -X -U accounting -d vesta_accounting -At -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout='20000ms';
WITH stock_catalog AS (
 SELECT c.kind,r.payload,COALESCE(r.payload->>'stock_quantity','') AS raw_quantity
 FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
 WHERE c.kind IN ('products','variations')
)
SELECT 'catalog_readiness kind='||kind||
 ' rows='||COUNT(*)||
 ' sku_missing='||COUNT(*) FILTER(WHERE NULLIF(TRIM(payload->>'sku'),'') IS NULL)||
 ' quantity_numeric='||COUNT(*) FILTER(WHERE raw_quantity ~ '^-?[0-9]+$')||
 ' quantity_unknown='||COUNT(*) FILTER(WHERE raw_quantity !~ '^-?[0-9]+$')||
 ' quantity_negative='||COUNT(*) FILTER(WHERE raw_quantity ~ '^-[0-9]+$')||
 ' stock_status_instock='||COUNT(*) FILTER(WHERE payload->>'stock_status'='instock')||
 ' stock_status_outofstock='||COUNT(*) FILTER(WHERE payload->>'stock_status'='outofstock')||
 ' price_missing='||COUNT(*) FILTER(WHERE NULLIF(TRIM(payload->>'price'),'') IS NULL)||
 ' currency_missing='||COUNT(*) FILTER(WHERE NULLIF(TRIM(payload->>'currency'),'') IS NULL)
FROM stock_catalog GROUP BY kind ORDER BY kind;
SELECT 'product_type type='||COALESCE(r.payload->>'type','unknown')||' rows='||COUNT(*)
FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
WHERE c.kind='products'
GROUP BY COALESCE(r.payload->>'type','unknown') ORDER BY 1;
SELECT 'simple_stock total='||COUNT(*)||
 ' quantity_unknown='||COUNT(*) FILTER(WHERE COALESCE(r.payload->>'stock_quantity','') !~ '^-?[0-9]+||COALESCE(NULLIF(r.payload->>'currency',''),'unknown')||' rows='||COUNT(*)
FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
WHERE c.kind='orders'
GROUP BY COALESCE(NULLIF(r.payload->>'currency',''),'unknown') ORDER BY 1;
SELECT 'ledger_readiness financial_products='||(SELECT COUNT(*) FROM products)||
 ' opening_reference_rows='||(SELECT COUNT(*) FROM opening_refs)||
 ' posted_journals='||(SELECT COUNT(*) FROM journals WHERE status='posted')||
 ' financial_periods='||(SELECT COUNT(*) FROM periods);
SELECT 'initial_import_completed='||(SELECT CASE WHEN last_success IS NULL THEN 'false' ELSE 'true' END FROM sync_control WHERE id=1);
COMMIT;
SQL
compose exec -T sync node --input-type=module <<'NODE'
import {WooSource} from './source.mjs';
const source=new WooSource({
 origin:process.env.WOO_ORIGIN,
 key:process.env.WOO_KEY,
 secret:process.env.WOO_SECRET,
 pageSize:1,catalogAdapter:process.env.WOO_CATALOG_ADAPTER==='1'
});
for(const kind of ['products','orders','customers','categories','coupons']){
 try{
  const r=await source.page(kind,1,{});
  console.log('live_woo_total kind='+kind+' total='+r.total);
 }catch(e){
  console.log('live_woo_total kind='+kind+' error='+(/^woo_http_[0-9]{3}$/.test(e.message)?e.message:'source_probe_error'));
 }
}
NODE
echo opening_readiness_audit=end
)||
 ' quantity_negative='||COUNT(*) FILTER(WHERE COALESCE(r.payload->>'stock_quantity','') ~ '^-[0-9]+||COALESCE(NULLIF(r.payload->>'currency',''),'unknown')||' rows='||COUNT(*)
FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
WHERE c.kind='orders'
GROUP BY COALESCE(NULLIF(r.payload->>'currency',''),'unknown') ORDER BY 1;
SELECT 'ledger_readiness financial_products='||(SELECT COUNT(*) FROM products)||
 ' opening_reference_rows='||(SELECT COUNT(*) FROM opening_refs)||
 ' posted_journals='||(SELECT COUNT(*) FROM journals WHERE status='posted')||
 ' financial_periods='||(SELECT COUNT(*) FROM periods);
SELECT 'initial_import_completed='||(SELECT CASE WHEN last_success IS NULL THEN 'false' ELSE 'true' END FROM sync_control WHERE id=1);
COMMIT;
SQL
compose exec -T sync node --input-type=module <<'NODE'
import {WooSource} from './source.mjs';
const source=new WooSource({
 origin:process.env.WOO_ORIGIN,
 key:process.env.WOO_KEY,
 secret:process.env.WOO_SECRET,
 pageSize:1,catalogAdapter:process.env.WOO_CATALOG_ADAPTER==='1'
});
for(const kind of ['products','orders','customers','categories','coupons']){
 try{
  const r=await source.page(kind,1,{});
  console.log('live_woo_total kind='+kind+' total='+r.total);
 }catch(e){
  console.log('live_woo_total kind='+kind+' error='+(/^woo_http_[0-9]{3}$/.test(e.message)?e.message:'source_probe_error'));
 }
}
NODE
echo opening_readiness_audit=end
)||
 ' outofstock='||COUNT(*) FILTER(WHERE r.payload->>'stock_status'='outofstock')
FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
WHERE c.kind='products' AND r.payload->>'type'='simple';
SELECT 'catalog_currency kind='||c.kind||
 ' currency='||COALESCE(NULLIF(r.payload->>'currency',''),'unknown')||
 ' rows='||COUNT(*)
FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
WHERE c.kind IN ('products','variations')
GROUP BY c.kind,COALESCE(NULLIF(r.payload->>'currency',''),'unknown')
ORDER BY c.kind;
SELECT 'order_currency currency='||COALESCE(NULLIF(r.payload->>'currency',''),'unknown')||' rows='||COUNT(*)
FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
WHERE c.kind='orders'
GROUP BY COALESCE(NULLIF(r.payload->>'currency',''),'unknown') ORDER BY 1;
SELECT 'ledger_readiness financial_products='||(SELECT COUNT(*) FROM products)||
 ' opening_reference_rows='||(SELECT COUNT(*) FROM opening_refs)||
 ' posted_journals='||(SELECT COUNT(*) FROM journals WHERE status='posted')||
 ' financial_periods='||(SELECT COUNT(*) FROM periods);
SELECT 'initial_import_completed='||(SELECT CASE WHEN last_success IS NULL THEN 'false' ELSE 'true' END FROM sync_control WHERE id=1);
COMMIT;
SQL
compose exec -T sync node --input-type=module <<'NODE'
import {WooSource} from './source.mjs';
const source=new WooSource({
 origin:process.env.WOO_ORIGIN,
 key:process.env.WOO_KEY,
 secret:process.env.WOO_SECRET,
 pageSize:1,catalogAdapter:process.env.WOO_CATALOG_ADAPTER==='1'
});
for(const kind of ['products','orders','customers','categories','coupons']){
 try{
  const r=await source.page(kind,1,{});
  console.log('live_woo_total kind='+kind+' total='+r.total);
 }catch(e){
  console.log('live_woo_total kind='+kind+' error='+(/^woo_http_[0-9]{3}$/.test(e.message)?e.message:'source_probe_error'));
 }
}
NODE
echo opening_readiness_audit=end
