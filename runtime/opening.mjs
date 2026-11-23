// Freeze read-only WooCommerce stock observations after the approved cutover.
// Evidence is unverified; this never posts opening balances or updates Woo.
export async function captureOpening(pool,{observedAt=new Date()}={}){
 const when=observedAt instanceof Date?observedAt:new Date(observedAt);
 if(!Number.isFinite(when.getTime()))throw Error('invalid observedAt');
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const plan=(await conn.query('SELECT effective_at_utc,status FROM accounting_cutover WHERE id=1')).rows[0];
  if(!plan||plan.status!=='planned'||when.getTime()<new Date(plan.effective_at_utc).getTime()){
   await conn.query('COMMIT');return {due:false};
  }
  const prior=await conn.query('SELECT observed_at FROM opening_capture WHERE id=1');
  if(prior.rows.length){await conn.query('COMMIT');return {captured:false,already:true};}
  const control=(await conn.query('SELECT last_success FROM sync_control WHERE id=1')).rows[0];
  const count=(await conn.query('SELECT COUNT(*) n FROM opening_live_review')).rows[0].n;
  if(!control?.last_success||Number(count)===0){await conn.query('COMMIT');return {due:true,source_not_ready:true};}
  const ins=await conn.query(
   'INSERT INTO opening_capture(id,cutover_at,observed_at,last_full_sync_at) VALUES(1,$1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',
   [plan.effective_at_utc,when.toISOString(),control.last_success]
  );
  if(!ins.rowCount){await conn.query('COMMIT');return {captured:false,already:true};}
  await conn.query('INSERT INTO opening_capture_items (capture_id,source_kind,external_id,parent_id,revision_id,source_checked_at,name,sku,stock_quantity,stock_status,manage_stock,price,currency) SELECT 1,source_kind,external_id,parent_id,revision_id,source_checked_at,name,sku,stock_quantity,stock_status,manage_stock,price,currency FROM opening_live_review');
  await conn.query('COMMIT');
  return {captured:true,unverified:true,observedAt:when.toISOString(),items:Number(count)};
 }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e;}
 finally{conn.release();}
}
