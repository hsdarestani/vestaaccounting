#!/usr/bin/env bash
# Read-only sample of WooCommerce product metadata names; never log values/IDs/secrets.
set -Eeuo pipefail
cd /srv/vesta-accounting/release/runtime
root=/srv/vesta-accounting/private
docker compose --env-file "$root/.compose.env" -f compose.yml -f "$root/compose.source-sync.yml" --profile source-sync exec -T sync node --input-type=module <<'NODE'
const origin=new URL(process.env.WOO_ORIGIN);
const key=process.env.WOO_KEY,secret=process.env.WOO_SECRET;
if(origin.hostname!=='vesta-cosmetics.ir'||!key||!secret)throw Error('read_only_source_not_configured');
const auth='Basic '+Buffer.from(key+':'+secret).toString('base64');
const pages=[1,72,144];
let sampled=0,withAny=0,withCandidate=0,failed=0;
const counts=new Map();
for(const page of pages){
 try{
   const u=new URL('/wp-json/wc/v3/products',origin);
   u.searchParams.set('per_page','12');
   u.searchParams.set('page',String(page));
   u.searchParams.set('_fields','id,meta_data');
   const r=await fetch(u,{method:'GET',redirect:'error',headers:{Authorization:auth,Accept:'application/json','User-Agent':'VestaAccounting-cost-audit-readonly'},signal:AbortSignal.timeout(16000)});
   if(!r.ok){console.log('product_meta_probe page='+page+' error=woo_http_'+r.status);failed++;continue;}
   const rows=await r.json();
   if(!Array.isArray(rows))throw Error('invalid_woo_response');
   for(const row of rows){
     sampled++;
     const meta=Array.isArray(row.meta_data)?row.meta_data:[];
     if(meta.length)withAny++;
     const ks=new Set(meta.map(m=>typeof m.key==='string'?m.key:'').filter(k=>/cost|purchase|wholesale|cogs|buy_price|قیمت.*خرید/i.test(k)));
     if(ks.size)withCandidate++;
     for(const k of ks)counts.set(k,(counts.get(k)||0)+1);
   }
 }catch(e){failed++;console.log('product_meta_probe page='+page+' error=source_probe_error');}
}
console.log('cost_metadata_audit sample_products='+sampled+' with_any_metadata='+withAny+' products_with_costlike_keys='+withCandidate+' probe_failures='+failed);
for(const [key,count] of [...counts].sort((a,b)=>b[1]-a[1]).slice(0,20))console.log('costlike_meta_key='+key+' sample_products='+count);
NODE
