// Exact, evidence-backed bridge from reported balances to the approved cutover.
 // The user supplies totals from statements, not WooCommerce payment status.
 // No financial posting or opening approval takes place here.
const clean=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max?x.trim():null;
const decimal=x=>typeof x==='string'&&/^\d{1,14}(\.\d{1,2})?$/.test(x)?x:null;
export async function openingBridgeList(pool){
 const {rows}=await pool.query(`
 SELECT b.evidence_date,b.line_key,b.account_kind,b.display_name,b.amount_toman::text AS reported_toman,
  b.evidence_note,r.id AS bridge_revision,
  to_char(r.observed_at AT TIME ZONE 'Asia/Tehran','YYYY-MM-DD HH24:MI') AS observed_tehran,
  r.increases_toman::text,r.decreases_toman::text,r.reference,
  CASE WHEN r.id IS NOT NULL THEN (b.amount_toman-r.increases_toman+r.decreases_toman)::text END AS opening_toman,
  CASE WHEN r.id IS NULL THEN 'evidence_required' WHEN b.amount_toman-r.increases_toman+r.decreases_toman<0 THEN 'negative_review' ELSE 'bridge_proposed' END AS bridge_status
 FROM opening_input_balances_v1 b
 LEFT JOIN LATERAL(SELECT * FROM opening_balance_bridge_evidence e WHERE e.evidence_date=b.evidence_date AND e.line_key=b.line_key ORDER BY e.id DESC LIMIT 1) r ON true
 ORDER BY b.evidence_date,b.account_kind,b.line_key`);
 return {rows,posting_authorized:false};
}
export async function recordOpeningBridge(pool,input,actor){
 const key=clean(input.line_key,120),date=input.evidence_date,time=input.observed_time,
  inc=decimal(input.increases_toman),dec=decimal(input.decreases_toman),ref=clean(input.reference,500);
 const error=(message,status=400)=>({error:message,status});
 if(!key||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toJSON()?.slice(0,10)!==date||
 typeof time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)||inc===null||dec===null||!ref||input.coverage_confirmed!==true)
 return error('زمان برداشت، گردش کامل و مرجع مستند را وارد و پوشش کامل بازه را تأیید کنید.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const balance=await client.query(`SELECT b.line_key FROM opening_input_balances_v1 b CROSS JOIN accounting_cutover c
   WHERE b.line_key=$1 AND b.evidence_date=$2 AND c.id=1
    AND (($2::date+$3::time) AT TIME ZONE 'Asia/Tehran')>=c.effective_at_utc
    AND (($2::date+$3::time) AT TIME ZONE 'Asia/Tehran')<=now() FOR UPDATE OF b`,[key,date,time]);
  if(!balance.rowCount){await client.query('ROLLBACK');return error('مدرک مانده یا زمان معتبر پیدا نشد.',404);}
  const prior=await client.query(`SELECT id,observed_at=(($2::date+$3::time) AT TIME ZONE 'Asia/Tehran') AND increases_toman=$4 AND decreases_toman=$5 AND reference=$6 AS identical
   FROM opening_balance_bridge_evidence WHERE line_key=$1 AND evidence_date=$2 ORDER BY id DESC LIMIT 1`,[key,date,time,inc,dec,ref]);
  if(prior.rows[0]?.identical){await client.query('COMMIT');return {revision:prior.rows[0].id,duplicate:true};}
  const {rows:[r]}=await client.query(`INSERT INTO opening_balance_bridge_evidence(evidence_date,line_key,observed_at,increases_toman,decreases_toman,reference,actor)
   VALUES($2,$1,(($2::date+$3::time) AT TIME ZONE 'Asia/Tehran'),$4,$5,$6,$7) RETURNING id`,[key,date,time,inc,dec,ref,actor]);
  await client.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'opening.balance_bridge',$2,'مدرک گردش افتتاحیه؛ بدون ثبت قطعی')",[actor,key+':'+date+':'+r.id]);
  await client.query('COMMIT');return {revision:r.id,duplicate:false};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
