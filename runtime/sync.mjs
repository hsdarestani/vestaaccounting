import {randomUUID} from 'node:crypto';
import {poolFromEnv} from './pg.mjs';
import {WooSource,persistPage} from './source.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const kinds=['products','orders','customers','categories','coupons','variations','refunds'];
const stamp=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const safeReason=e=>/^woo_http_\d{3}$/.test(e.message)?e.message:
 ({count_changed:'count_changed',catalog_empty:'catalog_empty','pagination headers missing':'pagination_headers_missing','invalid woo page':'invalid_source_page','invalid source identity':'invalid_source_identity'}[e.message]||
 (e.name==='TimeoutError'?'source_timeout':'sync_failed'));
const select=async(pool,kind)=>(await pool.query('SELECT * FROM sync_state WHERE kind=$1',[kind])).rows[0];
async function parent(pool,kind,after){const origin=kind==='variations'?'products':'orders',condition=kind==='variations'?"r.payload->>'type'='variable'":"CASE WHEN jsonb_typeof(r.payload->'refunds')='array' THEN jsonb_array_length(r.payload->'refunds')>0 ELSE false END";return (await pool.query(`SELECT c.external_id FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id WHERE c.kind=$1 AND c.external_id::bigint>$2 AND ${condition} ORDER BY c.external_id::bigint LIMIT 1`,[origin,after||'0'])).rows[0]?.external_id;}
async function checkpoint(pool,kind,cursor,status,processed,expected,watermark=null){await pool.query('UPDATE sync_state SET cursor=$2::jsonb,status=$3,processed_count=$4,expected_count=$5,watermark=COALESCE($6,watermark),last_success=CASE WHEN $3=\'complete\' THEN now() ELSE last_success END,last_error=NULL WHERE kind=$1',[kind,JSON.stringify(cursor),status,processed,expected,watermark]);}
export async function runCycle(pool,source,{budget=6,delay=1200}={}){
 const lock=await pool.connect();let runId=null;try{
  const acquired=(await lock.query('SELECT pg_try_advisory_lock(67226611) got')).rows[0].got;if(!acquired)return {busy:true};
  const control=(await pool.query('SELECT * FROM sync_control WHERE id=1')).rows[0];
  for(const kind of kinds)await pool.query('INSERT INTO sync_state(kind) VALUES($1) ON CONFLICT DO NOTHING',[kind]);
  // A verified store never treats a silently empty catalog as a completed import.
  if(source.origin==='https://vesta-cosmetics.ir')await pool.query("UPDATE sync_state SET status='pending',cursor=NULL,watermark=NULL WHERE kind='products' AND status='complete' AND NOT EXISTS(SELECT 1 FROM raw_current WHERE kind='products')");
  const complete=(await pool.query("SELECT count(*) n FROM sync_state WHERE status='complete'")).rows[0].n;
  if(Number(complete)===kinds.length){const due=!control.last_success||Date.now()-new Date(control.last_success).getTime()>300000;const weekly=!control.last_scan||Date.now()-new Date(control.last_scan).getTime()>7*86400000;if(!due&&!control.requested&&!weekly)return {idle:true};if(weekly){await pool.query("UPDATE sync_state SET status='pending',cursor=NULL,processed_count=0,expected_count=NULL,watermark=NULL");}else {await pool.query("UPDATE sync_state SET status='pending',cursor=NULL,processed_count=0,expected_count=NULL WHERE kind IN('products','orders','variations','refunds')");}}
  runId=randomUUID();await pool.query("INSERT INTO sync_runs(id,status) VALUES($1,'running')",[runId]);let done=0;
  const failures=[];
  for(const kind of kinds){
   // Never let a long-running or failing object type starve the rest.
   for(let attempts=0;attempts<Math.max(1,Math.ceil(budget/4))&&done<budget;attempts++){
    const state=await select(pool,kind);if(state.status==='complete')break;
    const child=kind==='variations'||kind==='refunds';
    if(child&&(await select(pool,kind==='variations'?'products':'orders')).status!=='complete')break;
    if(Number(state.cursor?.retry_at||0)>Date.now())break;
    let cursor=state.cursor||{page:1,parent:'',last_parent:'0',before:stamp(),parent_count:0};
    let processed=Number(state.processed_count)||0;
    if(child&&!cursor.parent){
      cursor.parent=await parent(pool,kind,cursor.last_parent);cursor.page=1;cursor.parent_count=0;
      if(!cursor.parent){await checkpoint(pool,kind,cursor,'complete',processed,processed,cursor.before);break;}
    }
    const attemptCursor={...cursor};delete attemptCursor.retry_at;done++;
    try{
      const after=!child&&['orders','products'].includes(kind)&&state.watermark?new Date(new Date(state.watermark).getTime()-120000).toISOString():'';
      const r=await source.page(kind,cursor.page,{parent:cursor.parent||'',after,before:cursor.before});
      if(kind==='products'&&!after&&cursor.page===1&&r.total===0&&source.origin==='https://vesta-cosmetics.ir')throw Error('catalog_empty');
      const last=cursor.page>=Math.max(1,r.pages);
      if(last&&(child?cursor.parent_count:processed)+r.rows.length!==r.total)throw Error('count_changed');
      await persistPage(pool,kind,r.rows,cursor.parent||'');processed+=r.rows.length;
      delete cursor.retry_at;
      if(child){
        cursor.parent_count+=r.rows.length;
        if(last){cursor.last_parent=cursor.parent;cursor.parent='';cursor.page=1;cursor.parent_count=0;}else cursor.page++;
        await checkpoint(pool,kind,cursor,'running',processed,null);
      }else{
        if(last){await checkpoint(pool,kind,cursor,'complete',processed,r.total,cursor.before);}
        else{cursor.page++;await checkpoint(pool,kind,cursor,'running',processed,r.total);}
      }
      await sleep(delay);
      if(last&&!child)break;
    }catch(e){
      const reason=safeReason(e);failures.push(reason);
      const restart=reason==='count_changed'||(reason==='woo_http_400'&&attemptCursor.page>1);
      const retry={...(restart?{page:1,parent:'',last_parent:'0',before:stamp(),parent_count:0}:attemptCursor),retry_at:Date.now()+90000};
      await pool.query("UPDATE sync_state SET status='failed',last_error=$2,cursor=$3::jsonb,processed_count=CASE WHEN $4 THEN 0 ELSE processed_count END,expected_count=CASE WHEN $4 THEN NULL ELSE expected_count END WHERE kind=$1",[kind,reason,JSON.stringify(retry),restart]);
      await sleep(delay);break;
    }
   }
   if(done>=budget)break;
  }
  await pool.query("UPDATE sync_control SET last_error=(SELECT last_error FROM sync_state WHERE status='failed' AND last_error IS NOT NULL ORDER BY kind LIMIT 1) WHERE id=1");
  const remaining=Number((await pool.query("SELECT count(*) n FROM sync_state WHERE status<>'complete'")).rows[0].n);if(remaining===0){await pool.query("UPDATE sync_control SET requested=false,last_success=now(),last_scan=CASE WHEN last_scan IS NULL OR last_scan<now()-interval '7 days' THEN now() ELSE last_scan END,last_error=NULL WHERE id=1");await pool.query("UPDATE sync_events SET status='review' WHERE status='pending' AND topic LIKE '%.deleted'");await pool.query("UPDATE sync_events e SET status='processed' WHERE e.status='pending' AND EXISTS(SELECT 1 FROM raw_current c WHERE c.external_id=e.source_id AND c.checked_at>=e.received_at AND ((e.topic LIKE 'product.%' AND c.kind IN('products','variations')) OR (e.topic LIKE 'order.%' AND c.kind='orders') OR (e.topic LIKE 'customer.%' AND c.kind='customers') OR (e.topic LIKE 'coupon.%' AND c.kind='coupons')))");}await pool.query("UPDATE sync_runs SET status=$2,finished=now(),reason=$3 WHERE id=$1",[runId,remaining?'checkpointed':'complete',failures[0]||'']);return {pages:done,remaining,...(failures.length?{retrying:true,reason:failures[0]}:{})};
 }catch(e){if(runId)await pool.query("UPDATE sync_runs SET status='failed',finished=now(),reason=$2 WHERE id=$1",[runId,safeReason(e)]);return {failed:true,reason:safeReason(e)};}finally{try{await lock.query('SELECT pg_advisory_unlock(67226611)');}finally{lock.release();}}
}
if(process.argv[1]&&import.meta.url===new URL('file:'+process.argv[1]).href){const pool=poolFromEnv();let source;try{source=new WooSource({origin:process.env.WOO_ORIGIN,key:process.env.WOO_KEY,secret:process.env.WOO_SECRET,pageSize:30,catalogAdapter:process.env.WOO_CATALOG_ADAPTER==='1'});}catch{await pool.query("UPDATE sync_control SET last_error='read_only_credentials_missing' WHERE id=1");await pool.end();process.exit(2);}for(;;){const result=await runCycle(pool,source,{budget:9,delay:1800});console.log(JSON.stringify({event:'source_sync',...result}));await sleep(result.failed?90000:result.idle?60000:25000);}}
