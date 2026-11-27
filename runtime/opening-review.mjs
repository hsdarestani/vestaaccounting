const pageSize=100;

export const openingReviewModules=['opening_costs','opening_balances','opening_valuation'];

export async function reviewOpeningInput(pool,module,url){
 const page=Math.max(0,Math.min(10000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 if(module==='opening_costs'){
  const id=(url.searchParams.get('id')||'').trim();
  if(id && !/^[1-9][0-9]{0,15}$/.test(id))return {rows:[]};
  const rows=(await pool.query(`
   SELECT c.*,catalog.name,catalog.parent_id,coalesce(catalog.identities,0) AS identities
   FROM opening_purchase_cost_review c
   LEFT JOIN LATERAL (
    SELECT min(i.name) AS name,min(i.parent_id) AS parent_id,count(*) AS identities
    FROM opening_live_review i WHERE i.source_kind=c.source_kind AND i.external_id=c.external_id::text
   ) catalog ON true
   WHERE ($1='' OR c.external_id::text=$1)
   ORDER BY c.external_id LIMIT $2 OFFSET $3`,[id,pageSize,page*pageSize])).rows;
  return {rows};
 }
 if(module==='opening_balances'){
  const rows=(await pool.query(`
   SELECT b.evidence_date,b.line_key,b.account_kind,b.display_name,b.amount_toman::text,b.evidence_note,
    l.account,l.party,r.fee_basis,r.rules
   FROM opening_input_balances_v1 b
   LEFT JOIN opening_balance_account_links l USING(evidence_date,line_key)
   LEFT JOIN opening_gateway_rules r USING(evidence_date,line_key)
   ORDER BY b.evidence_date,b.account_kind,b.line_key`)).rows;
  return {rows};
 }
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await conn.query(`
   SELECT source_kind,external_id,parent_id,name,stock_quantity,stock_status,unit_cost_toman,
    cost_status,priority_review,review_status,
    CASE WHEN review_status IN('estimated_cost','non_estimated_cost')
     THEN (stock_quantity::numeric*unit_cost_toman)::text END AS value_toman
   FROM opening_stock_cost_review
   WHERE ($1::text IS NULL OR review_status=$1) ORDER BY source_kind,external_id::bigint,parent_id
   LIMIT $2 OFFSET $3`,[url.searchParams.get('review_status'),pageSize,page*pageSize])).rows;
  const counts=(await conn.query(`
   SELECT review_status,count(*) AS count,
    coalesce(sum(stock_quantity::numeric*unit_cost_toman)
      FILTER(WHERE review_status IN('estimated_cost','non_estimated_cost')),0)::text AS value_toman
   FROM opening_stock_cost_review GROUP BY review_status ORDER BY review_status`)).rows;
  const capture=(await conn.query('SELECT cutover_at,observed_at FROM opening_capture WHERE id=1')).rows[0]||null;
  const activity=(await conn.query(`
   WITH bounds AS (
    SELECT to_char(effective_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') AS start_gmt,
     to_char((date '2026-11-27'::timestamp AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS') AS end_gmt FROM accounting_cutover WHERE id=1
   )
   SELECT c.kind,((r.payload->>'date_created_gmt')::timestamp AT TIME ZONE 'UTC'
    AT TIME ZONE 'Asia/Tehran')::date AS local_date,count(*) AS count
   FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id CROSS JOIN bounds b
   WHERE c.kind IN('orders','refunds') AND coalesce(r.payload->>'date_created_gmt','')>=b.start_gmt
    AND coalesce(r.payload->>'date_created_gmt','')<b.end_gmt
   GROUP BY c.kind,local_date ORDER BY local_date,c.kind`)).rows;
  const preview=(await conn.query(`
   WITH lines AS (
    SELECT l.account,a.title,b.display_name AS detail,l.party,
     CASE WHEN b.account_kind='supplier_payable' THEN 0 ELSE b.amount_toman END AS debit,
     CASE WHEN b.account_kind='supplier_payable' THEN b.amount_toman ELSE 0 END AS credit
    FROM opening_input_balances_v1 b JOIN opening_balance_account_links l USING(evidence_date,line_key)
    JOIN accounts a ON a.code=l.account WHERE b.evidence_date='2026-11-26' AND b.amount_toman>0
    UNION ALL
    SELECT '1200','موجودی کالا',review_status,NULL,sum(stock_quantity::numeric*unit_cost_toman),0
    FROM opening_stock_cost_review WHERE review_status IN('estimated_cost','non_estimated_cost')
    GROUP BY review_status
   ), offset_total AS (SELECT coalesce(sum(debit-credit),0) net FROM lines),
   balanced AS (
    SELECT * FROM lines
    UNION ALL SELECT '3010','مانده محاسباتی افتتاحیه','نیازمند تطبیق',NULL,
     greatest(-net,0),greatest(net,0) FROM offset_total WHERE net<>0
   )
   SELECT account,title,detail,party,debit::text,credit::text FROM balanced ORDER BY account,detail`)).rows;
  await conn.query('COMMIT');
  return {rows,counts,capture,activity,preview,status:'review',posting_authorized:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}

export async function correctPurchaseCost(pool,{external_id,revision,unit_cost_toman,reason},actor){
 const id=String(external_id??'');
 const version=String(revision??'');
 const trimmed=typeof reason==='string'?reason.trim():'';
 if(!/^[1-9][0-9]{0,15}$/.test(id)||!/^(0|[1-9][0-9]{0,15})$/.test(version)||
  !Number.isSafeInteger(unit_cost_toman)||unit_cost_toman<1||unit_cost_toman>1000000000000||
  !trimmed||trimmed.length>250)return {error:'شناسه، قیمت و دلیل اصلاح را بررسی کنید',status:400};
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  await conn.query('SELECT pg_advisory_xact_lock($1::bigint)',[id]);
  const current=(await conn.query('SELECT revision,unit_cost_toman,cost_status FROM opening_purchase_cost_review WHERE external_id=$1',[id])).rows[0];
  if(!current||String(current.revision)!==version){
   await conn.query('ROLLBACK');
   return current?{error:'قیمت تغییر کرده است. صفحه را دوباره بارگیری کنید.',status:409}:{error:'قیمت خرید پیدا نشد',status:404};
  }
  if(current.unit_cost_toman===unit_cost_toman&&current.cost_status==='owner_entered'){
   await conn.query('COMMIT');return {revision:current.revision};
  }
  const updated=(await conn.query(`
   INSERT INTO purchase_cost_revisions(external_id,unit_cost_toman,reason,actor) VALUES($1,$2,$3,$4) RETURNING id
  `,[id,unit_cost_toman,trimmed,actor])).rows[0];
  await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'purchase_cost.correct',$2,$3)",
   [actor,id,trimmed]);
  await conn.query('COMMIT');return {revision:updated.id};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
