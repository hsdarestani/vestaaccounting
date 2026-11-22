#!/usr/bin/env bash
# Reads only operational state, never selects or returns source data or counts.
set -Eeuo pipefail
cd /srv/vesta-accounting/release/runtime
compose() { docker compose --env-file /srv/vesta-accounting/private/.compose.env -f compose.yml -f /srv/vesta-accounting/private/compose.source-sync.yml --profile source-sync "$@"; }
compose exec -T postgres psql -X -U accounting -d vesta_accounting -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'sync_state='||kind||':'||status||':'||CASE WHEN last_error IN ('sync_failed','read_only_credentials_missing') OR last_error ~ '^woo_http_[0-9]{3}$' THEN last_error ELSE 'none' END
FROM sync_state WHERE kind IN ('products','orders','customers','categories','coupons','variations','refunds') AND status IN ('pending','running','complete','failed') ORDER BY kind;
SQL
compose exec -T sync node --input-type=module <<'NODE'
import {WooSource} from './source.mjs';
const source = new WooSource({origin:process.env.WOO_ORIGIN,key:process.env.WOO_KEY,secret:process.env.WOO_SECRET,pageSize:1});
const safe = e=>/^woo_http_\d{3}$/.test(e.message)?e.message:e.message==='pagination headers missing'?'pagination_headers_missing':e.name==='TimeoutError'?'timeout':'source_response_error';
for(const [name,kind,opts] of [['catalog','products',{}],['catalog_date_bound','products',{before:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}],['customers','customers',{}],['coupons','coupons',{}]]) {
  try{await source.page(kind,1,opts); console.log('source_probe='+name+':response_valid');}
  catch(e){console.log('source_probe='+name+':'+safe(e));}
}
NODE
