#!/usr/bin/env bash
# Bounded read-only diagnostic: returns only counts/booleans, never any customer fields or IDs.
set -Eeuo pipefail
cd /srv/vesta-accounting/release/runtime
root=/srv/vesta-accounting/private
docker compose --env-file "$root/.compose.env" -f compose.yml -f "$root/compose.source-sync.yml" --profile source-sync exec -T sync node --input-type=module <<'NODE'
import {WooSource} from './source.mjs';
const source=new WooSource({origin:process.env.WOO_ORIGIN,key:process.env.WOO_KEY,secret:process.env.WOO_SECRET,pageSize:30});
const global=[];
for(const [start,end] of [[1,8],[30,37],[65,72],[100,107]]){
  const ids=[];const totals=[];
  let failed=false;
  for(let page=start;page<=end;page++){
    try{
      const r=await source.page('customers',page);
      totals.push(r.total);
      ids.push(...r.rows.map(x=>x.id));
      await new Promise(resolve=>setTimeout(resolve,250));
    }catch(e){
      console.log('customer_window='+start+'-'+end+' error='+(/^woo_http_[0-9]{3}$/.test(e.message)?e.message:'probe_failure'));
      failed=true;break;
    }
  }
  if(failed)continue;
  global.push(...ids);
  const unique=new Set(ids).size;
  const increasing=ids.every((v,i)=>i===0||v>ids[i-1]);
  console.log('customer_window='+start+'-'+end+
    ' fetched='+ids.length+' unique='+unique+
    ' monotonic='+increasing+
    ' consistent_total='+(new Set(totals).size===1)+
    ' source_total='+totals.at(-1));
}
console.log('customer_sample_union_fetched='+global.length+' unique='+new Set(global).size+
  ' monotonic_across_windows='+global.every((v,i)=>i===0||v>global[i-1]));
NODE
