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

export async function openingStockTemplate(pool){
 const {rows}=await pool.query(`SELECT i.source_kind||':'||i.external_id||':'||i.parent_id AS row_key,i.name,i.sku,i.stock_quantity AS reference_quantity
  FROM opening_capture_items i WHERE i.capture_id=1 AND NOT EXISTS(SELECT 1 FROM opening_stock_reconciliation r
  WHERE r.capture_id=i.capture_id AND r.source_kind=i.source_kind AND r.external_id=i.external_id AND r.parent_id=i.parent_id)
  ORDER BY i.name,i.source_kind,i.external_id::bigint,i.parent_id`);
 return {rows,posting_authorized:false};
}

// All rows in one request are committed together. An existing identical
// reconciliation is a replay; a conflicting revision requires individual review.
export async function recordBulkStockReconciliation(pool,b,actor){
 const fail=(error,status=400)=>({error,status});
 const {observed_tehran:t,coverage_confirmed:confirmed}=b,reference=typeof b.reference==='string'?b.reference.trim():'';
 if(!stamp(t)||confirmed!==true||!reference||reference.length>500||!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100)return fail('زمان، مدرک و حداکثر صد ردیف معتبر لازم است.');
 const keys=new Set(),items=[];
 for(const r of b.rows){
  if(!r||typeof r.row_key!=='string')return fail('کد ردیف نامعتبر است.');
  const [source_kind,external_id,parent_id,...rest]=r.row_key.split(':');
  if(rest.length||!['products','variations'].includes(source_kind)||!validId(external_id)||(source_kind==='products'?parent_id!=='':!validId(parent_id))||keys.has(r.row_key)||![r.observed_quantity,r.received_quantity,r.issued_quantity].every(quantity))return fail('شناسه تکراری یا شمارش/گردش نامعتبر است.');
  keys.add(r.row_key);items.push({source_kind,external_id,parent_id,observed_quantity:r.observed_quantity,received_quantity:r.received_quantity,issued_quantity:r.issued_quantity});
 }
 const conn=await pool.connect();try{
  await conn.query('BEGIN');
  const matched=await conn.query(`SELECT i.source_kind,i.external_id,i.parent_id FROM opening_capture_items i JOIN opening_capture c ON c.id=i.capture_id
   JOIN jsonb_to_recordset($1::jsonb) x(source_kind text,external_id text,parent_id text) USING(source_kind,external_id,parent_id)
   WHERE i.capture_id=1 AND ($2::timestamp AT TIME ZONE 'Asia/Tehran') BETWEEN c.cutover_at AND now()
   ORDER BY i.source_kind,i.external_id,i.parent_id FOR UPDATE OF i`,[JSON.stringify(items),t]);
  if(matched.rowCount!==items.length){await conn.query('ROLLBACK');return fail('حداقل یک کالا یا زمان شمارش در افتتاحیه معتبر نیست.',409);}
  const existing=await conn.query(`SELECT r.source_kind,r.external_id,r.parent_id,
   r.observed_at=($2::timestamp AT TIME ZONE 'Asia/Tehran') AND r.observed_quantity=x.observed_quantity
   AND r.received_quantity=x.received_quantity AND r.issued_quantity=x.issued_quantity AND r.reference=$3 AS identical
   FROM jsonb_to_recordset($1::jsonb) x(source_kind text,external_id text,parent_id text,observed_quantity bigint,received_quantity bigint,issued_quantity bigint)
   JOIN LATERAL(SELECT * FROM opening_stock_reconciliation r WHERE r.capture_id=1 AND r.source_kind=x.source_kind AND r.external_id=x.external_id AND r.parent_id=x.parent_id ORDER BY id DESC LIMIT 1) r ON true`,[JSON.stringify(items),t,reference]);
  if(existing.rows.some(r=>!r.identical)){await conn.query('ROLLBACK');return fail('حداقل یک ردیف قبلاً با مدرک متفاوت تطبیق داده شده است. ابتدا آن ردیف را جداگانه بررسی کنید.',409);}
  const prior=new Set(existing.rows.map(r=>r.source_kind+':'+r.external_id+':'+r.parent_id));
  const fresh=items.filter(r=>!prior.has(r.source_kind+':'+r.external_id+':'+r.parent_id));
  if(fresh.length)await conn.query(`WITH saved AS (
   INSERT INTO opening_stock_reconciliation(capture_id,source_kind,external_id,parent_id,observed_at,observed_quantity,received_quantity,issued_quantity,reference,actor)
    SELECT 1,source_kind,external_id,parent_id,$2::timestamp AT TIME ZONE 'Asia/Tehran',observed_quantity,received_quantity,issued_quantity,$3,$4
    FROM jsonb_to_recordset($1::jsonb) x(source_kind text,external_id text,parent_id text,observed_quantity bigint,received_quantity bigint,issued_quantity bigint)
    RETURNING id,source_kind,external_id,parent_id
   ) INSERT INTO audit(at,actor,action,ref,description) SELECT now()::text,$4,'opening.stock_reconcile',source_kind||':'||external_id||':'||parent_id||':'||id,'مدرک گروهی شمارش و گردش؛ بدون ثبت قطعی' FROM saved`,[JSON.stringify(fresh),t,reference,actor]);
  await conn.query('COMMIT');return {saved:fresh.length,duplicates:prior.size,posting_authorized:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
