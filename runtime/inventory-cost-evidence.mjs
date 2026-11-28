import {createHash} from 'node:crypto';
const idPattern=/^[1-9][0-9]{0,15}$/;
const integer=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000000000;
const money=v=>typeof v==='string'&&/^\d{1,20}$/.test(v);
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)+'Z'===v;
const fail=(error,status=400)=>({error,status});
export function replayInventory({openingQuantity,openingValue,receivedQuantity,issuedQuantity,observedQuantity,cutover,observedAt,events}){
 if(![openingQuantity,receivedQuantity,issuedQuantity,observedQuantity].every(integer)||!money(openingValue)||!timestamp(cutover)||!timestamp(observedAt)||!Array.isArray(events)||events.length>5000)return fail('اطلاعات اولیه یا قالب گردش معتبر نیست.');
 let q=BigInt(openingQuantity),v=BigInt(openingValue),incoming=0n,outgoing=0n,cogs=0n,other=0n,last=cutover;
 if(q===0n&&v!==0n)return fail('ارزش موجودی صفر نامعتبر است.');
 const refs=new Set(),rows=[];
 for(const e of events){
  if(!e||!timestamp(e.at)||e.at<last||e.at>observedAt||!integer(e.quantity)||e.quantity===0||typeof e.ref!=='string'||!e.ref.trim()||e.ref.length>120||refs.has(e.ref.trim()))return fail('ترتیب زمانی، تعداد یا مرجع گردش نامعتبر یا تکراری است.');
  last=e.at;refs.add(e.ref.trim());const n=BigInt(e.quantity);let cost;
  if(['purchase','return_in','adjustment_in'].includes(e.kind)){
   if(!money(e.value_toman)||BigInt(e.value_toman)<=0n)return fail('ورودی باید ارزش مستند مثبت داشته باشد.');
   cost=BigInt(e.value_toman);q+=n;v+=cost;incoming+=n;
  }else if(['sale','return_out','damage','adjustment_out'].includes(e.kind)){
   if(q<n)return fail('گردش باعث موجودی منفی می‌شود.',409);
   if(e.value_toman!==undefined&&e.value_toman!=='')return fail('بهای خروج با میانگین موزون محاسبه می‌شود؛ مبلغ دستی وارد نکنید.');
   cost=n===q?v:(v*n*2n+q)/(q*2n);
   q-=n;v-=cost;outgoing+=n;
   if(e.kind==='sale')cogs+=cost;else other+=cost;
  }else return fail('نوع گردش پشتیبانی نمی‌شود.');
  rows.push({at:e.at,kind:e.kind,ref:e.ref.trim(),quantity:e.quantity,movement_value_toman:cost.toString(),remaining_quantity:q.toString(),remaining_value_toman:v.toString()});
 }
 if(incoming!==BigInt(receivedQuantity)||outgoing!==BigInt(issuedQuantity)||q!==BigInt(observedQuantity))return fail('جمع ورود، خروج یا مانده با مدرک شمارش تطابق ندارد.',409);
 return {rows,opening_value_toman:openingValue,ending_quantity:q.toString(),ending_value_toman:v.toString(),sales_cogs_toman:cogs.toString(),other_out_value_toman:other.toString(),posting_authorized:false};
}
// Invoices are immutable; use their exact line values and actual receipt times.
// The input remains a review calculation, never a stock write or posted journal.
async function registeredPurchaseEvents(conn,k,id,p,cutover,observedAt){
 const {rows}=await conn.query(`
 SELECT to_char(e.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
 'purchase:'||e.id AS ref,(i->>'quantity')::bigint AS quantity,
 trim_scale((i->>'value_toman')::numeric)::text AS value_toman
 FROM purchase_invoice_evidence e CROSS JOIN LATERAL jsonb_array_elements(e.items) i
 WHERE e.received_at BETWEEN $4::timestamptz AND $5::timestamptz
 AND e.items @> jsonb_build_array(jsonb_build_object('source_kind',$1::text,'external_id',$2::text,'parent_id',$3::text))
 AND i->>'source_kind'=$1 AND i->>'external_id'=$2 AND i->>'parent_id'=$3
 ORDER BY e.received_at,e.id LIMIT 5001`,[k,id,p,cutover,observedAt]);
 return rows.map(r=>({...r,kind:'purchase'}));
}
export async function inventoryCostList(pool,url){
 const id=url.searchParams.get('id')||'';
 if(id&&!idPattern.test(id))return {rows:[],posting_authorized:false};
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const {rows}=await pool.query(`
 SELECT s.source_kind,s.external_id,s.parent_id,s.name,s.opening_quantity,s.observed_quantity,s.received_quantity,s.issued_quantity,
 s.reconciliation_revision,s.cost_status,s.unit_cost_toman,s.value_toman::text AS opening_value_toman,
 e.id AS evidence_id,e.result->>'sales_cogs_toman' AS sales_cogs_toman,e.result->>'ending_value_toman' AS ending_value_toman,
 CASE WHEN s.reconciliation_status NOT IN ('zero_reviewed','non_estimated_reviewed','estimated_reviewed') THEN 'opening_required'
 WHEN e.id IS NULL THEN 'movement_required'
 WHEN e.stock_revision<>s.reconciliation_revision OR e.cost_revision<>coalesce(c.revision,0) THEN 'stale_evidence'
 WHEN e.evidence->>'purchase_source'='registered_invoices' AND (e.evidence->>'registered_purchase_count')::bigint<>(SELECT count(*) FROM purchase_invoice_evidence p WHERE p.received_at BETWEEN a.effective_at_utc AND s.observed_at AND p.items @> jsonb_build_array(jsonb_build_object('source_kind',s.source_kind,'external_id',s.external_id,'parent_id',s.parent_id))) THEN 'stale_evidence'
 ELSE 'calculated_review' END AS cost_review_status
 FROM opening_stock_reconciled_review s CROSS JOIN accounting_cutover a
 LEFT JOIN opening_purchase_cost_review c ON c.external_id::text=s.external_id AND c.source_kind=s.source_kind
 LEFT JOIN LATERAL(SELECT * FROM inventory_cost_evidence e WHERE e.source_kind=s.source_kind AND e.external_id=s.external_id AND e.parent_id=s.parent_id ORDER BY e.id DESC LIMIT 1)e ON true
 WHERE a.id=1 AND ($1='' OR s.external_id=$1) ORDER BY s.source_kind,s.external_id::bigint,s.parent_id LIMIT 100 OFFSET $2
 `,[id,page*100]);
 return {rows,posting_authorized:false};
}
export async function recordInventoryCost(pool,b,actor){
 const {source_kind:k,external_id:id,parent_id:p,events,reference}=b;
 if(!['products','variations'].includes(k)||typeof id!=='string'||!idPattern.test(id)||(k==='products'?p!=='':typeof p!=='string'||!idPattern.test(p))||
 typeof reference!=='string'||!reference.trim()||reference.length>500||b.coverage_confirmed!==true||!Array.isArray(events)||events.length>5000)return fail('شناسه کالا، مرجع و تأیید کامل بودن گردش لازم است.');
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const {rows:[s]}=await conn.query(`
   SELECT s.*,s.value_toman::text AS value_exact,coalesce(c.revision,0) AS cost_revision,
   to_char(a.effective_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') cutover,
   to_char(s.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') observed_at_utc
   FROM opening_stock_reconciled_review s CROSS JOIN accounting_cutover a
   LEFT JOIN opening_purchase_cost_review c ON c.source_kind=s.source_kind AND c.external_id::text=s.external_id
   WHERE a.id=1 AND s.source_kind=$1 AND s.external_id=$2 AND s.parent_id=$3
  `.replace('SELECT s.*,','SELECT s.reconciliation_revision,s.opening_quantity,s.observed_quantity,s.received_quantity,s.issued_quantity,s.reconciliation_status,s.cost_status,'),[k,id,p]);
  if(!s||!['zero_reviewed','non_estimated_reviewed','estimated_reviewed'].includes(s.reconciliation_status)){await conn.query('ROLLBACK');return fail('ابتدا موجودی و بهای افتتاحیه را تطبیق دهید.',409);}
  let movements=events,registered=[];
  if(b.use_registered_purchases===true){
   if(events.some(e=>!e||e.kind==='purchase'||String(e.ref||'').startsWith('purchase:'))){await conn.query('ROLLBACK');return fail('در حالت اتصال فاکتورها، ورود خرید دستی مجاز نیست.');}
   registered=await registeredPurchaseEvents(conn,k,id,p,s.cutover,s.observed_at_utc);
   if(registered.some(e=>!money(e.value_toman))){await conn.query('ROLLBACK');return fail('حداقل یک ردیف خرید اعشاری است؛ ارزش گرد نمی‌شود.',409);}
   const times=new Set(registered.map(e=>e.at));
   if(events.some(e=>times.has(e.at))){await conn.query('ROLLBACK');return fail('زمان خرید و گردش دیگر یکسان است؛ ترتیب واقعی باید بررسی شود.',409);}
   if(events.some((e,i)=>i>0&&e.at<events[i-1].at)){await conn.query('ROLLBACK');return fail('گردش دستی باید به ترتیب زمانی باشد.');}
   movements=[...registered,...events].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  }
  const result=replayInventory({openingQuantity:s.opening_quantity,openingValue:s.value_exact,receivedQuantity:s.received_quantity,issuedQuantity:s.issued_quantity,observedQuantity:s.observed_quantity,cutover:s.cutover,observedAt:s.observed_at_utc,events:movements});
  if(result.error){await conn.query('ROLLBACK');return result;}
  const evidence=b.use_registered_purchases===true?{reference:reference.trim(),events:movements,purchase_source:'registered_invoices',registered_purchase_count:registered.length}:{reference:reference.trim(),events};
  const fingerprint=createHash('sha256').update(JSON.stringify([k,id,p,s.reconciliation_revision,s.cost_revision,s.value_exact,evidence])).digest('hex');
  const inserted=await conn.query(`INSERT INTO inventory_cost_evidence(stock_revision,cost_revision,source_kind,external_id,parent_id,opening_value_toman,evidence,result,fingerprint,actor)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10) ON CONFLICT(fingerprint) DO NOTHING RETURNING id`,
   [s.reconciliation_revision,s.cost_revision,k,id,p,s.value_exact,JSON.stringify(evidence),JSON.stringify(result),fingerprint,actor]);
  const saved=inserted.rows[0]||(await conn.query('SELECT id FROM inventory_cost_evidence WHERE fingerprint=$1',[fingerprint])).rows[0];
  if(inserted.rowCount)await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'inventory.cost_evidence',$2,'محاسبه میانگین موزون؛ بدون ثبت قطعی')",[actor,String(saved.id)]);
  await conn.query('COMMIT');return {id:saved.id,duplicate:!inserted.rowCount,result};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
