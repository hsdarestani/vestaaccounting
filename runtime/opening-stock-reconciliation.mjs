const validId=v=>typeof v==='string'&&/^[1-9][0-9]{0,15}$/.test(v);
const quantity=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000000000;
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)&&Number.isFinite(Date.parse(v+'+03:30'))&&new Date(v+'Z').toISOString().slice(0,16)===v;
export async function stockReconciliationList(pool,url){
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const filter=url.searchParams.get('review_status')||'',id=url.searchParams.get('id')||'';
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {rows}=await conn.query(`SELECT *,value_toman::text AS value_toman FROM opening_stock_reconciled_review
   WHERE ($1='' OR reconciliation_status=$1) AND ($2='' OR external_id=$2)
   ORDER BY source_kind,external_id::bigint,parent_id LIMIT 100 OFFSET $3`,[filter,id,page*100]);
  const {rows:counts}=await conn.query(`SELECT reconciliation_status,count(*)::int AS count,
    sum(value_toman)::text AS value_toman FROM opening_stock_reconciled_review GROUP BY reconciliation_status ORDER BY reconciliation_status`);
  const {rows:[capture]}=await conn.query('SELECT cutover_at,observed_at FROM opening_capture WHERE id=1');
  await conn.query('COMMIT');return {rows,counts,capture:capture||null,posting_authorized:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function recordStockReconciliation(pool,b,actor){
 const {source_kind:k,external_id:id,parent_id:p,observed_quantity:o,received_quantity:r,issued_quantity:i,observed_tehran:t}=b;
 const ref=typeof b.reference==='string'?b.reference.trim():'';
 const error=(error,status=400)=>({error,status});
 if(!['products','variations'].includes(k)||!validId(id)||(k==='products'?p!=='':!validId(p))||![o,r,i].every(quantity)||!stamp(t)||!ref||ref.length>500||b.coverage_confirmed!==true)
 return error('شناسه کالا، شمارش، زمان مشاهده و گردش کامل مستند لازم است.');
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const args=[k,id,p,t,o,r,i,ref];
  const row=await conn.query(`SELECT c.capture_id FROM opening_capture_items c JOIN opening_capture s ON s.id=c.capture_id
   WHERE c.source_kind=$1 AND c.external_id=$2 AND c.parent_id=$3 AND c.capture_id=1
   AND ($4::timestamp AT TIME ZONE 'Asia/Tehran') BETWEEN s.cutover_at AND now()
   FOR UPDATE OF c`,args.slice(0,4));
  if(!row.rowCount){await conn.query('ROLLBACK');return error('کالای افتتاحیه یا زمان معتبر یافت نشد.',404);}
  const prior=await conn.query(`SELECT id,observed_at=($4::timestamp AT TIME ZONE 'Asia/Tehran') AND observed_quantity=$5
   AND received_quantity=$6 AND issued_quantity=$7 AND reference=$8 AS identical
   FROM opening_stock_reconciliation WHERE capture_id=1 AND source_kind=$1 AND external_id=$2 AND parent_id=$3
   ORDER BY id DESC LIMIT 1`,args);
  if(prior.rows[0]?.identical){await conn.query('COMMIT');return {revision:prior.rows[0].id,duplicate:true};}
  const {rows:[saved]}=await conn.query(`INSERT INTO opening_stock_reconciliation(capture_id,source_kind,external_id,parent_id,observed_at,observed_quantity,received_quantity,issued_quantity,reference,actor)
   VALUES(1,$1,$2,$3,$4::timestamp AT TIME ZONE 'Asia/Tehran',$5,$6,$7,$8,$9) RETURNING id`,[...args,actor]);
  await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'opening.stock_reconcile',$2,'مدرک شمارش و گردش؛ بدون ثبت قطعی')",[actor,k+':'+id+':'+p+':'+saved.id]);
  await conn.query('COMMIT');return {revision:saved.id,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
