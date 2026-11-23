#!/usr/bin/env bash
# GET-only diagnostic: compare recent Woo identities to PostgreSQL, never print IDs.
set -Eeuo pipefail
cd /srv/vesta-accounting/release/runtime
root=/srv/vesta-accounting/private
docker compose --env-file "$root/.compose.env" -f compose.yml -f "$root/compose.source-sync.yml" --profile source-sync exec -T sync node --input-type=module <<'NODE'
import {poolFromEnv} from './pg.mjs';
const pool=poolFromEnv(),origin=new URL(process.env.WOO_ORIGIN);
const auth='Basic '+Buffer.from(process.env.WOO_KEY+':'+process.env.WOO_SECRET).toString('base64');
try{
 for(const kind of ['orders','customers']){
   const ids=[];let total=0,error='none';
   for(let page=1;page<=4;page++){
     const u=new URL('/wp-json/wc/v3/'+kind,origin);
     u.searchParams.set('page',String(page));u.searchParams.set('per_page','30');
     u.searchParams.set('orderby','id');u.searchParams.set('order','desc');u.searchParams.set('_fields','id');
     try{
       const r=await fetch(u,{method:'GET',redirect:'error',headers:{Authorization:auth,Accept:'application/json'},signal:AbortSignal.timeout(16000)});
       if(!r.ok)throw Error('woo_http_'+r.status);
       const rows=await r.json();if(!Array.isArray(rows))throw Error('invalid_response');
       if(page===1)total=Number(r.headers.get('x-wp-total'))||0;
       ids.push(...rows.map(x=>String(x.id)));
       if(rows.length<30)break;
     }catch(e){error=/^woo_http_[0-9]{3}$/.test(e.message)?e.message:'source_probe_error';break;}
   }
   const found=ids.length?(await pool.query('SELECT external_id FROM raw_current WHERE kind=$1 AND external_id=ANY($2::text[])',[kind,ids])).rows:[];
   const have=new Set(found.map(x=>x.external_id));
   console.log('tail_identity kind='+kind+' sampled='+ids.length+' source_total='+total+' missing_recent='+ids.filter(x=>!have.has(x)).length+' probe_error='+error);
 }
}finally{await pool.end();}
NODE
