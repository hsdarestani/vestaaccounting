import {randomUUID} from 'node:crypto';
const accounts=['5030','5040','5090'],funding=['1010','1011','1012','1013','2010'];
const err=(error,status=400)=>({error,status});
const clean=(v,max)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():null;
const dateValid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toJSON()?.slice(0,10)===v;
function cents(v){if(typeof v!=='string'||!/^\d{1,13}(\.\d{1,2})?$/.test(v))return null;const [a,b='']=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
const decimal=n=>String(n/100n)+'.'+String(n%100n).padStart(2,'0');
export async function expenseEvidenceList(pool,url){
 const start=url.searchParams.get('start')||'2026-11-24',end=url.searchParams.get('end')||'9999-12-31';
 if(!dateValid(start)||!dateValid(end)||start>end)return {rows:[],summary:[],start,end};
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const {rows:[result]}=await pool.query(`
 WITH evidence AS (
  SELECT e.id,e.expense_date,e.expense_account,e.funding_account,e.invoice_ref,e.payment_ref,e.amount_toman::text,
   e.description,p.name AS supplier_name,j.ref AS draft_ref,
   CASE WHEN d.journal_id IS NOT NULL THEN 'draft_created'
    WHEN mod(e.amount_toman,1)<>0 THEN 'precision_review'
    WHEN NOT EXISTS(SELECT 1 FROM periods p WHERE e.expense_date BETWEEN p.starts AND p.ends AND p.locked=0) THEN 'period_required'
    ELSE 'draft_candidate' END AS expense_status
   FROM operating_expense_evidence e LEFT JOIN parties p ON p.id=e.supplier_id
   LEFT JOIN operating_expense_drafts d ON d.evidence_id=e.id LEFT JOIN journals j ON j.id=d.journal_id
   WHERE e.expense_date BETWEEN $1::date AND $2::date
 ), sums AS (
  SELECT expense_account,funding_account,count(*)::int AS count,sum(amount_toman::numeric)::text AS amount_toman
  FROM evidence GROUP BY expense_account,funding_account ORDER BY expense_account,funding_account
 )
 SELECT coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM evidence ORDER BY expense_date DESC,id LIMIT 100 OFFSET $3) q),'[]'::jsonb) rows,
 coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM sums s),'[]'::jsonb) summary
 `,[start,end,page*100]);return {...result,start,end,posting_authorized:false};
}
export async function recordExpenseEvidence(pool,b,actor){
 const a=b.expense_account,f=b.funding_account,date=b.expense_date,invoice=clean(b.invoice_ref,120),note=clean(b.description,500),
 supplier=clean(b.supplier_id,120),payment=clean(b.payment_ref,120),amount=cents(b.amount_toman);
 if(!accounts.includes(a)||!funding.includes(f)||!dateValid(date)||!invoice||!note||amount===null||amount<=0n||amount>100000000000000n||
 (f==='2010'?(!supplier||payment):!payment))return err('حساب، مبلغ، مدرک هزینه و وضعیت پرداخت معتبر لازم است.');
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const bounds=await conn.query("SELECT 1 FROM accounting_cutover WHERE id=1 AND $1::date BETWEEN (effective_at_utc AT TIME ZONE 'Asia/Tehran')::date AND (now() AT TIME ZONE 'Asia/Tehran')::date",[date]);
  if(!bounds.rowCount){await conn.query('ROLLBACK');return err('تاریخ خارج از بازه حسابداری است.');}
  if(supplier&&!(await conn.query("SELECT 1 FROM parties WHERE id=$1 AND kind='supplier'",[supplier])).rowCount){await conn.query('ROLLBACK');return err('تأمین‌کننده معتبر نیست.');}
  // Serialize competing uses of a bank statement reference across evidence modules.
  if(payment)await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[f+':'+payment]);
  if(payment&&(await conn.query('SELECT 1 FROM gateway_settlement_evidence WHERE bank_account=$1 AND bank_ref=$2',[f,payment])).rowCount){await conn.query('ROLLBACK');return err('این مرجع بانک در تسویه درگاه ثبت شده است.',409);}
  const values=[date,a,f,supplier,invoice,payment,decimal(amount),note];
  const {rows}=await conn.query(`INSERT INTO operating_expense_evidence(id,expense_date,expense_account,funding_account,supplier_id,invoice_ref,payment_ref,amount_toman,description,actor)
   VALUES($9,$1,$2,$3,$4,$5,$6,$7,$8,$10) ON CONFLICT DO NOTHING RETURNING id`,[...values,randomUUID(),actor]);
  if(!rows.length){
   const prior=await conn.query(`SELECT id FROM operating_expense_evidence WHERE expense_date=$1 AND expense_account=$2 AND funding_account=$3 AND supplier_id IS NOT DISTINCT FROM $4
    AND invoice_ref=$5 AND payment_ref IS NOT DISTINCT FROM $6 AND amount_toman=$7 AND description=$8`,values);
   await conn.query('COMMIT');return prior.rowCount?{id:prior.rows[0].id,duplicate:true}:err('مرجع فاکتور یا پرداخت قبلاً ثبت شده است.',409);
  }
  await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'expense.evidence',$2,'مدرک هزینه عملیاتی؛ بدون ثبت قطعی')",[actor,rows[0].id]);
  await conn.query('COMMIT');return {id:rows[0].id,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function draftExpense(pool,b,actor){
 const id=clean(b.id,80);if(!id)return err('شناسه مدرک لازم است.');
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const {rows:[e]}=await conn.query("SELECT id,expense_date,expense_account,funding_account,supplier_id,amount_toman::text AS amount_exact FROM operating_expense_evidence WHERE id=$1 FOR UPDATE",[id]);
  if(!e){await conn.query('ROLLBACK');return err('مدرک یافت نشد.',404);}
  const prior=await conn.query('SELECT journal_id FROM operating_expense_drafts WHERE evidence_id=$1',[id]);
  if(prior.rowCount){await conn.query('COMMIT');return {id:prior.rows[0].journal_id,duplicate:true};}
  const n=cents(e.amount_exact);
  if(n===null||n%100n!==0n){await conn.query('ROLLBACK');return err('دفتر فعلی فقط تومان صحیح می‌پذیرد؛ مبلغ گرد نمی‌شود.',409);}
  const period=await conn.query('SELECT id FROM periods WHERE $1::date BETWEEN starts AND ends AND locked=0 FOR SHARE',[e.expense_date]);
  if(period.rowCount!==1){await conn.query('ROLLBACK');return err('دوره مالی باز لازم است.',409);}
  const j=randomUUID(),ref='expense-evidence:'+id,amount=String(n/100n);
  await conn.query("INSERT INTO journals(id,ref,date,period,description,actor,at) VALUES($1,$2,$3,$4,'پیش‌نویس هزینه عملیاتی مستند',$5,now()::text)",[j,ref,e.expense_date,period.rows[0].id,actor]);
  await conn.query("INSERT INTO lines(journal,account,detail,debit,credit) VALUES($1,$2,$3,$4,0),($1,$5,$6,0,$4)",[j,e.expense_account,id,amount,e.funding_account,e.supplier_id||id]);
  await conn.query('INSERT INTO operating_expense_drafts(evidence_id,journal_id) VALUES($1,$2)',[id,j]);
  await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'expense.draft',$2,'پیش‌نویس بدون ثبت قطعی')",[actor,ref]);
  await conn.query('COMMIT');return {id:j,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
