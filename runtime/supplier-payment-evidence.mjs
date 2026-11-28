import {randomUUID} from 'node:crypto';
const banks=['1010','1011','1012','1013'];
const clean=(v,max)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():null;
const fail=(error,status=400)=>({error,status});
const dateValid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toJSON()?.slice(0,10)===v;
function cents(v){if(typeof v!=='string'||!/^\d{1,13}(\.\d{1,2})?$/.test(v))return null;const [a,b='']=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
const decimal=n=>String(n/100n)+'.'+String(n%100n).padStart(2,'0');
export async function supplierPaymentList(pool,url){
 const start=url.searchParams.get('start')||'2026-11-24',end=url.searchParams.get('end')||'9999-12-31';
 if(!dateValid(start)||!dateValid(end)||start>end)return {rows:[],summary:[],invoices:[],start,end,posting_authorized:false};
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const {rows:[result]}=await pool.query(`
 WITH payments AS (
 SELECT e.id,e.purchase_id,p.invoice_ref,s.name supplier_name,e.payment_date,e.bank_account,e.payment_ref,e.amount_toman::text,e.evidence_note,j.ref draft_ref,
 CASE WHEN d.journal_id IS NOT NULL THEN 'draft_created'
 WHEN mod(e.amount_toman,1)<>0 THEN 'precision_review'
 WHEN NOT EXISTS(SELECT 1 FROM purchase_invoice_drafts x WHERE x.evidence_id=p.id) THEN 'invoice_draft_required'
 WHEN NOT EXISTS(SELECT 1 FROM periods t WHERE e.payment_date BETWEEN t.starts AND t.ends AND t.locked=0) THEN 'period_required'
 ELSE 'draft_candidate' END payment_status
 FROM supplier_payment_evidence e JOIN purchase_invoice_evidence p ON p.id=e.purchase_id JOIN parties s ON s.id=p.supplier_id
 LEFT JOIN supplier_payment_drafts d ON d.evidence_id=e.id LEFT JOIN journals j ON j.id=d.journal_id
 WHERE e.payment_date BETWEEN $1::date AND $2::date
 ), allocations AS (
 SELECT p.id,p.invoice_ref,s.name supplier_name,p.total_toman::text AS total_toman,
 coalesce(t.paid,0)::text AS allocated_toman,(p.total_toman-coalesce(t.paid,0))::text AS outstanding_toman
 FROM purchase_invoice_evidence p JOIN parties s ON s.id=p.supplier_id
 LEFT JOIN (SELECT purchase_id,sum(amount_toman) paid FROM supplier_payment_evidence GROUP BY purchase_id)t ON t.purchase_id=p.id
 ), sums AS (SELECT bank_account,count(*)::int count,sum(amount_toman::numeric)::text AS amount_toman FROM payments GROUP BY bank_account ORDER BY bank_account)
 SELECT coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM payments ORDER BY payment_date DESC,id LIMIT 100 OFFSET $3) q),'[]'::jsonb) rows,
 coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM sums s),'[]'::jsonb) summary,
 coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT * FROM allocations WHERE outstanding_toman::numeric>0 ORDER BY supplier_name,invoice_ref LIMIT 500) a),'[]'::jsonb) invoices
 `,[start,end,page*100]);
 return {...result,start,end,posting_authorized:false};
}
export async function recordSupplierPayment(pool,b,actor){
 const purchase=clean(b.purchase_id,80),bank=b.bank_account,ref=clean(b.payment_ref,120),note=clean(b.evidence_note,500),date=b.payment_date,amount=cents(b.amount_toman);
 if(!purchase||!banks.includes(bank)||!ref||!note||!dateValid(date)||amount===null||amount<=0n||amount>100000000000000n||b.allocation_confirmed!==true)return fail('فاکتور، مبلغ، تاریخ، مدرک پرداخت و تأیید تخصیص لازم است.');
 const conn=await pool.connect();
 try{
 await conn.query('BEGIN');
 await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[bank+':'+ref]);
 const {rows:[p]}=await conn.query(`SELECT id,total_toman::text total_toman FROM purchase_invoice_evidence
 WHERE id=$1 AND $2::date BETWEEN (received_at AT TIME ZONE 'Asia/Tehran')::date AND (now() AT TIME ZONE 'Asia/Tehran')::date FOR UPDATE`,[purchase,date]);
 if(!p){await conn.query('ROLLBACK');return fail('فاکتور یا تاریخ پرداخت معتبر نیست.',409);}
 const prior=await conn.query('SELECT id,purchase_id=$1 AND payment_date=$2 AND amount_toman=$5 AND evidence_note=$6 AS identical FROM supplier_payment_evidence WHERE bank_account=$3 AND payment_ref=$4',[purchase,date,bank,ref,decimal(amount),note]);
 if(prior.rowCount){await conn.query('COMMIT');return prior.rows[0].identical?{id:prior.rows[0].id,duplicate:true}:fail('مرجع پرداخت قبلاً ثبت شده است.',409);}
 if((await conn.query(`SELECT 1 FROM gateway_settlement_evidence WHERE bank_account=$1 AND bank_ref=$2
 UNION ALL SELECT 1 FROM operating_expense_evidence WHERE funding_account=$1 AND payment_ref=$2`,[bank,ref])).rowCount){await conn.query('ROLLBACK');return fail('مرجع پرداخت در بخش دیگری ثبت شده است.',409);}
 const {rows:[a]}=await conn.query('SELECT coalesce(sum(amount_toman),0)::text AS paid FROM supplier_payment_evidence WHERE purchase_id=$1',[purchase]);
 if(cents(a.paid)+amount>cents(p.total_toman)){await conn.query('ROLLBACK');return fail('جمع پرداخت‌ها بیشتر از مبلغ فاکتور است.',409);}
 const id=randomUUID();
 await conn.query(`INSERT INTO supplier_payment_evidence(id,purchase_id,payment_date,bank_account,payment_ref,amount_toman,evidence_note,actor)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,purchase,date,bank,ref,decimal(amount),note,actor]);
 await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'supplier.payment_evidence',$2,'مدرک پرداخت تخصیص یافته؛ بدون ثبت قطعی')",[actor,id]);
 await conn.query('COMMIT');return {id,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function draftSupplierPayment(pool,b,actor){
 const id=clean(b.id,80);if(!id)return fail('شناسه مدرک لازم است.');
 const conn=await pool.connect();
 try{
 await conn.query('BEGIN');
 const {rows:[e]}=await conn.query(`SELECT e.id,e.purchase_id,e.payment_date,e.bank_account,e.amount_toman::text AS amount_exact,p.supplier_id
 FROM supplier_payment_evidence e JOIN purchase_invoice_evidence p ON p.id=e.purchase_id WHERE e.id=$1 FOR UPDATE OF e`,[id]);
 if(!e){await conn.query('ROLLBACK');return fail('مدرک یافت نشد.',404);}
 const prior=await conn.query('SELECT journal_id FROM supplier_payment_drafts WHERE evidence_id=$1',[id]);
 if(prior.rowCount){await conn.query('COMMIT');return {id:prior.rows[0].journal_id,duplicate:true};}
 if(!(await conn.query('SELECT 1 FROM purchase_invoice_drafts WHERE evidence_id=$1',[e.purchase_id])).rowCount){await conn.query('ROLLBACK');return fail('ابتدا پیش‌نویس فاکتور خرید را بسازید.',409);}
 const amount=cents(e.amount_exact);if(amount===null||amount%100n!==0n){await conn.query('ROLLBACK');return fail('مبلغ اعشاری گرد نمی‌شود.',409);}
 const period=await conn.query('SELECT id FROM periods WHERE $1::date BETWEEN starts AND ends AND locked=0 FOR SHARE',[e.payment_date]);
 if(period.rowCount!==1){await conn.query('ROLLBACK');return fail('دوره مالی باز لازم است.',409);}
 const journal=randomUUID(),ref='supplier-payment:'+id;
 await conn.query("INSERT INTO journals(id,ref,date,period,description,actor,at) VALUES($1,$2,$3,$4,'پیش‌نویس پرداخت فاکتور خرید',$5,now()::text)",[journal,ref,e.payment_date,period.rows[0].id,actor]);
 await conn.query("INSERT INTO lines(journal,account,detail,debit,credit) VALUES($1,'2010',$2,$3,0),($1,$4,$5,0,$3)",[journal,e.supplier_id,String(amount/100n),e.bank_account,id]);
 await conn.query('INSERT INTO supplier_payment_drafts(evidence_id,journal_id) VALUES($1,$2)',[id,journal]);
 await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'supplier.payment_draft',$2,'پیش‌نویس بدون ثبت قطعی')",[actor,ref]);
 await conn.query('COMMIT');return {id:journal,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
