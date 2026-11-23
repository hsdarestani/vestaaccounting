// Bounded, GET-only missing-identity repair for the newest Woo records.
// Keep raw evidence separate from invoices, ledger, and live shop stock.
import {persistPage} from './source.mjs';

export async function repairRecentTail(pool,source,{pages=4}={}){
 if(!Number.isSafeInteger(pages)||pages<1||pages>4)throw Error('invalid tail page budget');
 const results=[];
 for(const kind of ['orders','customers']){
  let checked=0,inserted=0,sourceTotal=0;
  for(let page=1;page<=pages;page++){
   const result=await source.page(kind,page,{descending:true});
   if(page===1)sourceTotal=result.total;
   const rows=result.rows;
   if(!rows.length)break;
   const ids=rows.map(r=>String(r.id));
   const existing=(await pool.query('SELECT external_id FROM raw_current WHERE kind=$1 AND external_id=ANY($2::text[])',[kind,ids])).rows;
   const present=new Set(existing.map(r=>r.external_id));
   const missing=rows.filter(r=>!present.has(String(r.id)));
   if(missing.length)await persistPage(pool,kind,missing);
   checked+=rows.length;inserted+=missing.length;
   if(page>=result.pages)break;
  }
  results.push({kind,checked,inserted,sourceTotal});
 }
 return results;
}
