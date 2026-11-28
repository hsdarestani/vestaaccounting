import {randomUUID} from 'node:crypto';
const idPattern=/^[1-9][0-9]{0,15}$/;
const clean=(v,max)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():null;
const fail=(error,status=400)=>({error,status});
function cents(v){if(typeof v!=='string'||!/^\d{1,13}(\.\d{1,2})?$/.test(v))return null;const [a,b='']=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
const decimal=n=>String(n/100n)+'.'+String(n%100n).padStart(2,'0');
const dateValid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toJSON()?.slice(0,10)===v;
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)&&Number.isFinite(Date.parse(v+'+03:30'))&&new Date(v+'Z').toISOString().slice(0,16)===v;
export async function purchaseInvoiceList(pool,url){
 const start=url.searchParams.get('start')||'2026-11-24',end=url.searchParams.get('end')||'9999-12-31';
 if(!dateValid(start)||!dateValid(end)||start>end)return {rows:[],summary:[],start,end,posting_authorized:false};
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const {rows:[result]}=await pool.query(`
 WITH evidence AS (
  SELECT e.id,e.supplier_id,p.name AS supplier_name,e.invoice_ref,
   (e.received_at AT TIME ZONE 'Asia/Tehran')::date AS purchase_date,
   to_char(e.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS received_utc,
   e.total_toman::text AS total_toman,e.items,e.evidence_note,j.ref AS draft_ref,coalesce(t.payment_mode,'credit') payment_mode,t.due_date,coalesce(t.initial_paid_toman,0)::text initial_paid_toman,
   coalesce((SELECT sum(amount_toman) FROM supplier_payment_evidence sp WHERE sp.purchase_id=e.id),0)::text allocated_toman,
   (e.total_toman-coalesce((SELECT sum(amount_toman) FROM supplier_payment_evidence sp WHERE sp.purchase_id=e.id),0))::text outstanding_toman,
   CASE WHEN d.journal_id IS NOT NULL THEN 'draft_created'
    WHEN NOT EXISTS(SELECT 1 FROM periods p WHERE (e.received_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN p.starts AND p.ends AND p.locked=0) THEN 'period_required'
    ELSE 'draft_candidate' END AS purchase_status
  FROM purchase_invoice_evidence e JOIN parties p ON p.id=e.supplier_id LEFT JOIN purchase_invoice_terms t ON t.invoice_id=e.id
  LEFT JOIN purchase_invoice_drafts d ON d.evidence_id=e.id LEFT JOIN journals j ON j.id=d.journal_id
  WHERE (e.received_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN $1::date AND $2::date
 ), sums AS (
  SELECT supplier_id,supplier_name,count(*)::int AS count,sum(total_toman::numeric)::text AS total_toman
  FROM evidence GROUP BY supplier_id,supplier_name ORDER BY supplier_name
 )
 SELECT coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM evidence ORDER BY purchase_date DESC,id LIMIT 100 OFFSET $3) q),'[]'::jsonb) rows,
 coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM sums s),'[]'::jsonb) summary
 `,[start,end,page*100]);
 return {...result,start,end,posting_authorized:false};
}
export async function recordPurchaseInvoice(pool,b,actor){
 const supplier=clean(b.supplier_id,120),invoice=clean(b.invoice_ref,120),note=clean(b.evidence_note,500),at=b.received_tehran,total=cents(b.total_toman);
 const mode=b.payment_mode||'credit',due=b.due_date||null,payment=b.initial_payment||null;
 if(!supplier||!invoice||!note||!stamp(at)||total===null||total<=0n||total>100000000000000n||b.receipt_confirmed!==true||!['credit','cash','mixed'].includes(mode)||(b.funding_confirmed!==true&&!(mode==='credit'&&b.credit_purchase_confirmed===true))||!Array.isArray(b.items)||!b.items.length||b.items.length>200)return fail('مدرک خرید، دریافت کالا، روش پرداخت، مبلغ کل و اقلام معتبر لازم است.');
 if(due&&(!dateValid(due)||due<at.slice(0,10)||mode==='cash'))return fail('سررسید معتبر برای مانده بدهی لازم است.');
 let paid=0n,bank=null,paymentRef=null,paymentNote=null,paymentDate=null;
 if(mode!=='credit'){paid=cents(payment?.amount_toman);bank=payment?.bank_account;paymentRef=clean(payment?.payment_ref,120);paymentNote=clean(payment?.evidence_note,500);paymentDate=payment?.payment_date;
  if(paid===null||paid<=0n||(mode==='cash'?paid!==total:paid>=total)||!['1010','1011','1012','1013'].includes(bank)||!paymentRef||!paymentNote||!dateValid(paymentDate)||paymentDate<at.slice(0,10)||payment?.confirmed!==true)return fail('مبلغ پرداخت واقعی، حساب، تاریخ و مرجع معتبر لازم است.');
 }else if(payment)return fail('در حالت نسیه اولیه، مدرک پرداخت اولیه ارسال نشود.');
 const items=[],seen=new Set();let sum=0n;
 for(const item of b.items){
  if(!item)return fail('ردیف فاکتور معتبر نیست.');
  const {source_kind:k,external_id:id,parent_id:p,quantity:q}=item,n=cents(item.value_toman);
  if(!['products','variations'].includes(k)||typeof id!=='string'||!idPattern.test(id)||(k==='products'?p!=='':typeof p!=='string'||!idPattern.test(p))||!Number.isSafeInteger(q)||q<1||q>1000000000000||n===null||n<=0n||n>100000000000000n)return fail('شناسه، تعداد یا ارزش ردیف خرید نامعتبر است.');
  const key=k+':'+id+':'+p;if(seen.has(key))return fail('ردیف کالا تکراری است؛ تعداد و ارزش را یکجا وارد کنید.');
  seen.add(key);sum+=n;items.push({source_kind:k,external_id:id,parent_id:p,quantity:q,value_toman:decimal(n)});
 }
 if(sum!==total)return fail('جمع ارزش اقلام با مبلغ فاکتور برابر نیست.');
 items.sort((a,b)=>(a.source_kind+':'+a.external_id+':'+a.parent_id).localeCompare(b.source_kind+':'+b.external_id+':'+b.parent_id));
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const bounds=await conn.query(`SELECT 1 FROM accounting_cutover WHERE id=1 AND ($1::timestamp AT TIME ZONE 'Asia/Tehran') BETWEEN effective_at_utc AND now()`,[at]);
  if(!bounds.rowCount){await conn.query('ROLLBACK');return fail('زمان دریافت خارج از بازه حسابداری است.');}
  if(!(await conn.query("SELECT 1 FROM parties WHERE id=$1 AND kind='supplier'",[supplier])).rowCount){await conn.query('ROLLBACK');return fail('تأمین‌کننده معتبر نیست.');}
  if(paid>0n){await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[bank+':'+paymentRef]);const {rows:[date]}=await conn.query("SELECT $1::date<=(now() AT TIME ZONE 'Asia/Tehran')::date valid",[paymentDate]);if(!date.valid){await conn.query('ROLLBACK');return fail('تاریخ پرداخت آینده مجاز نیست.');}}
  await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['invoice:'+invoice]);
  if((await conn.query('SELECT 1 FROM operating_expense_evidence WHERE invoice_ref=$1 AND (supplier_id=$2 OR supplier_id IS NULL)',[invoice,supplier])).rowCount){await conn.query('ROLLBACK');return fail('این فاکتور قبلاً به عنوان هزینه ثبت شده است.',409);}
  const {rows:[matching]}=await conn.query(`
   SELECT count(*)::int AS n FROM jsonb_to_recordset($1::jsonb) i(source_kind text,external_id text,parent_id text)
   WHERE EXISTS(SELECT 1 FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
    WHERE c.kind=i.source_kind AND c.external_id=i.external_id AND c.parent_id=i.parent_id
    AND (i.source_kind='variations' OR r.payload->>'type'='simple'))
  `,[JSON.stringify(items)]);
  if(matching.n!==items.length){await conn.query('ROLLBACK');return fail('حداقل یک شناسه کالا با ووکامرس مطابقت ندارد.',409);}
  const args=[supplier,invoice,at,decimal(total),JSON.stringify(items),note];
  const saved=await conn.query(`INSERT INTO purchase_invoice_evidence(id,supplier_id,invoice_ref,received_at,total_toman,items,evidence_note,actor)
   VALUES($7,$1,$2,$3::timestamp AT TIME ZONE 'Asia/Tehran',$4,$5::jsonb,$6,$8) ON CONFLICT DO NOTHING RETURNING id`,[...args,randomUUID(),actor]);
  if(!saved.rowCount){
   const prior=await conn.query(`SELECT id FROM purchase_invoice_evidence WHERE supplier_id=$1 AND invoice_ref=$2
    AND received_at=($3::timestamp AT TIME ZONE 'Asia/Tehran') AND total_toman=$4 AND items=$5::jsonb AND evidence_note=$6`,args);
   if(!prior.rowCount){await conn.query('ROLLBACK');return fail('فاکتور با اطلاعات متفاوت قبلاً ثبت شده است.',409);}const id=prior.rows[0].id;
   const {rows:[terms]}=await conn.query(`SELECT coalesce(t.payment_mode,'credit')=$2 AND t.due_date IS NOT DISTINCT FROM $3::date AND coalesce(t.initial_paid_toman,0)=$4::numeric AND p.bank_account IS NOT DISTINCT FROM $5 AND p.payment_ref IS NOT DISTINCT FROM $6 AND p.payment_date IS NOT DISTINCT FROM $7::date AND p.evidence_note IS NOT DISTINCT FROM $8 identical,t.initial_payment_id FROM purchase_invoice_evidence e LEFT JOIN purchase_invoice_terms t ON t.invoice_id=e.id LEFT JOIN supplier_payment_evidence p ON p.id=t.initial_payment_id WHERE e.id=$1`,[id,mode,due,decimal(paid),bank,paymentRef,paymentDate,paymentNote]);
   await conn.query('COMMIT');return terms.identical?{id,duplicate:true,payment_id:terms.initial_payment_id}:fail('روش پرداخت یا مدرک اولیه فاکتور قبلی متفاوت است.',409);
  }
  const id=saved.rows[0].id;
  let paymentId=null;if(paid>0n){const used=await conn.query(`SELECT 1 FROM gateway_settlement_evidence WHERE bank_account=$1 AND bank_ref=$2 UNION ALL SELECT 1 FROM operating_expense_evidence WHERE funding_account=$1 AND payment_ref=$2 UNION ALL SELECT 1 FROM bank_movement_references WHERE account=$1 AND reference=$2 UNION ALL SELECT 1 FROM supplier_payment_evidence WHERE bank_account=$1 AND payment_ref=$2 UNION ALL SELECT 1 FROM bank_statement_candidates WHERE source_kind IN('woo_collection','woo_refund_payment') AND account=$1 AND reference=$2`,[bank,paymentRef]);if(used.rowCount){await conn.query('ROLLBACK');return fail('مرجع پرداخت در بخش دیگری ثبت شده است؛ فاکتور ذخیره نشد.',409);}paymentId=randomUUID();await conn.query('INSERT INTO supplier_payment_evidence(id,purchase_id,payment_date,bank_account,payment_ref,amount_toman,evidence_note,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[paymentId,id,paymentDate,bank,paymentRef,decimal(paid),paymentNote,actor]);await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'supplier.payment_evidence',$2,'مدرک پرداخت اولیه همراه فاکتور؛ بدون ثبت قطعی')",[actor,paymentId]);}
  await conn.query('INSERT INTO purchase_invoice_terms(invoice_id,payment_mode,due_date,initial_payment_id,initial_paid_toman) VALUES($1,$2,$3,$4,$5)',[id,mode,due,paymentId,decimal(paid)]);
  await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'purchase.invoice_evidence',$2,'مدرک خرید و دریافت کالا؛ بدون ثبت قطعی')",[actor,id]);
  await conn.query('COMMIT');return {id,duplicate:false,payment_id:paymentId};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function draftPurchaseInvoice(pool,b,actor){
 const id=clean(b.id,80);if(!id)return fail('شناسه مدرک لازم است.');
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const {rows:[e]}=await conn.query(`SELECT id,supplier_id,items,total_toman::text AS total_exact,(received_at AT TIME ZONE 'Asia/Tehran')::date AS purchase_date
   FROM purchase_invoice_evidence WHERE id=$1 FOR UPDATE`,[id]);
  if(!e){await conn.query('ROLLBACK');return fail('مدرک یافت نشد.',404);}
  const prior=await conn.query('SELECT journal_id FROM purchase_invoice_drafts WHERE evidence_id=$1',[id]);
  if(prior.rowCount){await conn.query('COMMIT');return {id:prior.rows[0].journal_id,duplicate:true};}
  const total=cents(e.total_exact);
  if(total===null||e.items.some(i=>cents(i.value_toman)===null)){await conn.query('ROLLBACK');return fail('مبالغ دقیق نامعتبر است.',409);}
  const period=await conn.query('SELECT id FROM periods WHERE $1::date BETWEEN starts AND ends AND locked=0 FOR SHARE',[e.purchase_date]);
  if(period.rowCount!==1){await conn.query('ROLLBACK');return fail('دوره مالی باز لازم است.',409);}
  const journal=randomUUID(),ref='purchase-evidence:'+id;
  await conn.query("INSERT INTO journals(id,ref,date,period,description,actor,at) VALUES($1,$2,$3,$4,'پیش‌نویس خرید نسیه؛ گردش قطعی انبار هنوز ثبت نشده',$5,now()::text)",[journal,ref,e.purchase_date,period.rows[0].id,actor]);
  for(const i of e.items)await conn.query("INSERT INTO lines(journal,account,detail,debit,credit) VALUES($1,'1200',$2,$3,0)",[journal,i.source_kind+':'+i.external_id+':'+i.parent_id,decimal(cents(i.value_toman))]);
  await conn.query("INSERT INTO lines(journal,account,detail,debit,credit) VALUES($1,'2010',$2,0,$3)",[journal,e.supplier_id,decimal(total)]);
  await conn.query('INSERT INTO purchase_invoice_drafts(evidence_id,journal_id) VALUES($1,$2)',[id,journal]);
  await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'purchase.invoice_draft',$2,'پیش‌نویس؛ بدون ثبت قطعی انبار یا بدهی')",[actor,ref]);
  await conn.query('COMMIT');return {id:journal,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
