// Read-only full customer ID coverage verification.
// All PII stays inside the origin process: stdout contains ONLY aggregate counts.
import {WooSource} from './source.mjs';
import {poolFromEnv} from './pg.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pool=poolFromEnv();
const source=new WooSource({
  origin:process.env.WOO_ORIGIN,key:process.env.WOO_KEY,
  secret:process.env.WOO_SECRET,pageSize:50,
  catalogAdapter:process.env.WOO_CATALOG_ADAPTER==='1'
});
try {
  const kind='customers';
  const first=await source.page(kind,1);
  const totalPages=first.pages;
  if(totalPages<1||totalPages>250)throw Error('unexpected_customer_source_pages');
  let duplicates=0;
  const seen=new Set();
  const segmentDuplicates=[];
  let last=0;
  let sampled=0;
  let differentTotals=0;
  for(let page=1;page<=totalPages;page++) {
    const res=page===1?first:await source.page(kind,page);
    if(res.total!==first.total)differentTotals++;
    let pageDuplicates=0;
    for(const row of res.rows) {
      sampled++;
      if(seen.has(row.id)){duplicates++;pageDuplicates++;}
      seen.add(row.id);
      if(row.id<=last)segmentDuplicates.push(page);
      last=row.id;
    }
    if(pageDuplicates)segmentDuplicates.push(page);
    if(page%20===0)console.log('customer_scan_checkpoint_pages='+page+' of='+totalPages);
    await sleep(350);
  }
  const db=(await pool.query("SELECT external_id FROM raw_current WHERE kind='customers' AND parent_id=''")).rows;
  const persisted=new Set(db.map(x=>Number(x.external_id)));
  let missing=0;
  for(const id of seen)if(!persisted.has(id))missing++;
  let extra=0;
  for(const id of persisted)if(!seen.has(id))extra++;
  const allState=(await pool.query("SELECT status,expected_count,processed_count FROM sync_state WHERE kind=$1",[kind])).rows[0];
  console.log('customer_identity_audit='+JSON.stringify({
    source_declared:first.total, source_pages:totalPages,
    rows_received:sampled,source_unique:seen.size,
    duplicate_rows:duplicates,out_of_order_pages:[...new Set(segmentDuplicates)].length,
    total_header_changes:differentTotals,db_unique:persisted.size,
    in_source_not_db:missing,in_db_not_source:extra,
    sync_status:allState.status,processed_count:Number(allState.processed_count),
    expected_count:Number(allState.expected_count||0)
  }));
}finally{await pool.end();}
