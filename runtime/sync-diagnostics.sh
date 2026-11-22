#!/usr/bin/env bash
# Reads only operational state, never selects or returns source data or counts.
set -Eeuo pipefail
cd /srv/vesta-accounting/release/runtime
compose() { docker compose --env-file /srv/vesta-accounting/private/.compose.env -f compose.yml -f /srv/vesta-accounting/private/compose.source-sync.yml --profile source-sync "$@"; }
compose exec -T postgres psql -X -U accounting -d vesta_accounting -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'sync_state='||kind||':'||status||':'||CASE WHEN last_error IN ('sync_failed','read_only_credentials_missing','catalog_empty','count_changed','source_timeout','pagination_headers_missing','invalid_source_page','invalid_source_identity') OR last_error ~ '^woo_http_[0-9]{3}$' THEN last_error ELSE 'none' END
FROM sync_state WHERE kind IN ('products','orders','customers','categories','coupons','variations','refunds') AND status IN ('pending','running','complete','failed') ORDER BY kind;
SQL
compose exec -T sync node --input-type=module <<'NODE'
import {WooSource} from './source.mjs';
const source = new WooSource({origin:process.env.WOO_ORIGIN,key:process.env.WOO_KEY,secret:process.env.WOO_SECRET,pageSize:1});
const safe = e=>/^woo_http_\d{3}$/.test(e.message)?e.message:e.message==='pagination headers missing'?'pagination_headers_missing':e.name==='TimeoutError'?'timeout':'source_response_error';
for(const [name,kind,opts] of [['catalog','products',{}],['catalog_date_bound','products',{before:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}],['customers','customers',{}],['coupons','coupons',{}]]) {
  try{const result=await source.page(kind,1,opts);console.log('source_probe='+name+':'+(result.rows.length?'response_has_records':'response_empty'));}
  catch(e){console.log('source_probe='+name+':'+safe(e));}
}
for(const [label,query] of [
  ['catalog_default',''],['catalog_published','status=publish'],
  ['catalog_any','status=any'],['catalog_sort_desc','orderby=id&order=desc'],
  ['catalog_variable','type=variable'],['catalog_public','public']
]){
  const path=query==='public'?'/wp-json/wc/store/v1/products':'/wp-json/wc/v3/products';
  const url=new URL(path,source.origin);url.search='per_page=1&_fields=id'+(query&&query!=='public'?'&'+query:'');
  try{
    const r=await fetch(url,{method:'GET',headers:{Accept:'application/json',...(query==='public'?{}:{Authorization:source.auth})},redirect:'error',signal:AbortSignal.timeout(18000)});
    const marker=!r.ok?'woo_http_'+r.status:(Array.isArray(await r.clone().json())&&(await r.json()).length?'response_has_records':'response_empty');
    console.log('source_probe='+label+':'+marker);
  }catch(e){console.log('source_probe='+label+':'+safe(e));}
}
try {
  const p=new URL('/wp-json/wc/store/v1/products?per_page=1&_fields=id',source.origin);
  const publicResult=await (await fetch(p,{redirect:'error',signal:AbortSignal.timeout(10000)})).json();
  const id=publicResult[0]?.id;
  if(Number.isSafeInteger(id)&&id>0){
    for(const [label,path] of [
       ['catalog_exact','/wp-json/wc/v3/products/'+id+'?_fields=id,type'],
       ['catalog_explicit_include','/wp-json/wc/v3/products?include='+id+'&per_page=1&_fields=id'],
       ['catalog_plain_permalink','/?rest_route=%2Fwc%2Fv3%2Fproducts&per_page=1&_fields=id']
    ]){
       const r=await fetch(new URL(path,source.origin),{headers:{Authorization:source.auth,Accept:'application/json','User-Agent':'VestaAccounting-readonly/0.4'},redirect:'error',signal:AbortSignal.timeout(12000)});
       const data=r.ok?await r.json():null;
       console.log('source_probe='+label+':'+(!r.ok?'woo_http_'+r.status:(Array.isArray(data)?data.length>0:!!data?.id)?'response_has_records':'response_empty'));
    }
  }
}catch(e){console.log('source_probe=catalog_exact:'+safe(e));}
NODE
