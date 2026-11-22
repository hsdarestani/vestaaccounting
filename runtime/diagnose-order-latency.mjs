import {WooSource} from './source.mjs';
import {poolFromEnv} from './pg.mjs';
const pool=poolFromEnv();
try {
 const s=(await pool.query("SELECT status,processed_count,cursor,watermark,last_error FROM sync_state WHERE kind='orders'")).rows[0];
 if(!s){console.log('order_probe_state=absent');process.exit(1);}
 const page=Number(s.cursor?.page||1);
 const before=s.cursor?.before||'';
 const after=s.watermark?new Date(new Date(s.watermark).getTime()-120000).toISOString():'';
 if(!Number.isInteger(page)||page<1)throw Error('invalid_cursor');
 console.log('order_probe_cursor='+JSON.stringify({page,status:s.status,processed:Number(s.processed_count),
   last_error:s.last_error||'none',anchored:!!before,incremental:!!after}));
 const source=new WooSource({origin:process.env.WOO_ORIGIN,key:process.env.WOO_KEY,
   secret:process.env.WOO_SECRET,pageSize:30,catalogAdapter:process.env.WOO_CATALOG_ADAPTER==='1'});
 const start=Date.now();
 try {
  const x=await source.page('orders',page,{before,after});
  console.log('order_probe_result='+JSON.stringify({success:true,elapsed_ms:Date.now()-start,
    page,rows:x.rows.length,total:x.total,total_pages:x.pages}));
 }catch(e){
  const error=/^woo_http_\d{3}$/.test(e.message)?e.message:e.name==='TimeoutError'?'source_timeout':'probe_error';
  console.log('order_probe_result='+JSON.stringify({success:false,elapsed_ms:Date.now()-start,page,error}));
 }
}finally {await pool.end();}
