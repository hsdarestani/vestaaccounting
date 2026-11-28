import {randomUUID} from 'node:crypto';
const banks=['1010','1011','1012','1013'];
const types=['transfer','customer_receipt','customer_deposit','owner_contribution','owner_withdrawal','loan_receipt'];
const clean=(v,max)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():null;
const fail=(error,status=400)=>({error,status});
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toJSON()?.slice(0,10)===v;
function cents(v){if(typeof v!=='string'||!/^\d{1,13}(\.\d{1,2})?$/.test(v))return null;const [a,b='']=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
const decimal=n=>String(n/100n)+'.'+String(n%100n).padStart(2,'0');
export async function bankMovementList(pool,url){
 const start=url.searchParams.get('start')||'2026-11-24',end=url.searchParams.get('end')||'9999-12-31';
 if(!validDate(start)||!validDate(end)||start>end)return {rows:[],start,end,posting_authorized:false};
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const {rows}=await pool.query(`SELECT e.id,e.movement_kind,e.movement_date,e.bank_account,e.other_bank_account,e.reference,e.other_reference,
  e.amount_toman::text,p.name party_name,e.description,j.ref draft_ref,
  CASE WHEN d.journal_id IS NOT NULL THEN 'draft_created' WHEN mod(e.amount_toman,1)<>0 THEN 'precision_review'
    WHEN NOT EXISTS(SELECT 1 FROM periods p WHERE e.movement_date BETWEEN p.starts AND p.ends AND p.locked=0) THEN 'period_required'
    ELSE 'draft_candidate' END movement_status
  FROM bank_movement_evidence e LEFT JOIN parties p ON p.id=e.party_id LEFT JOIN bank_movement_drafts d ON d.evidence_id=e.id LEFT JOIN journals j ON j.id=d.journal_id
  WHERE e.movement_date BETWEEN $1::date AND $2::date ORDER BY e.movement_date DESC,e.id LIMIT 100 OFFSET $3`,[start,end,page*100]);
 return {rows,start,end,posting_authorized:false};
}
export async function recordBankMovement(pool,b,actor){
 const kind=b.movement_kind,bank=b.bank_account,other=clean(b.other_bank_account,12),ref=clean(b.reference,120),otherRef=clean(b.other_reference,120),party=clean(b.party_id,120),date=b.movement_date,note=clean(b.description,500),amount=cents(b.amount_toman);
 if(!types.includes(kind)||!banks.includes(bank)||!validDate(date)||!ref||!note||amount===null||amount<=0n||amount>100000000000000n||
  (kind==='transfer'?(!banks.includes(other)||other===bank||!otherRef):!!other||!!otherRef)||
  (['customer_receipt','customer_deposit'].includes(kind)?!party:!!party))return fail('نوع گردش، حساب‌ها، تاریخ، مبلغ و مرجع واقعی معتبر لازم است.');
 const refs=[[bank,ref],...(other?[[other,otherRef]]:[])].sort((a,b)=>(a[0]+':'+a[1]).localeCompare(b[0]+':'+b[1]));
 const conn=await pool.connect();try{
  await conn.query('BEGIN');
  if(!(await conn.query("SELECT 1 FROM accounting_cutover WHERE id=1 AND $1::date BETWEEN (effective_at_utc AT TIME ZONE 'Asia/Tehran')::date AND (now() AT TIME ZONE 'Asia/Tehran')::date",[date])).rowCount){await conn.query('ROLLBACK');return fail('تاریخ خارج از بازه حسابداری است.');}
  if(party&&!(await conn.query("SELECT 1 FROM parties WHERE id=$1 AND kind='customer'",[party])).rowCount){await conn.query('ROLLBACK');return fail('مشتری معتبر نیست.');}
  for(const [a,r] of refs)await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[a+':'+r]);
  const values=[kind,date,bank,other,ref,otherRef,party,decimal(amount),note];
  const prior=await conn.query(`SELECT id, movement_kind=$1 AND movement_date=$2 AND other_bank_account IS NOT DISTINCT FROM $4 AND other_reference IS NOT DISTINCT FROM $6
   AND party_id IS NOT DISTINCT FROM $7 AND amount_toman=$8 AND description=$9 AS identical FROM bank_movement_evidence WHERE bank_account=$3 AND reference=$5`,values);
  if(prior.rowCount){await conn.query('COMMIT');return prior.rows[0].identical?{id:prior.rows[0].id,duplicate:true}:fail('مرجع گردش با اطلاعات متفاوت ذخیره شده است.',409);}
  for(const [a,r] of refs){if((await conn.query(`SELECT 1 FROM bank_movement_references WHERE account=$1 AND reference=$2
   UNION ALL SELECT 1 FROM gateway_settlement_evidence WHERE bank_account=$1 AND bank_ref=$2
   UNION ALL SELECT 1 FROM operating_expense_evidence WHERE funding_account=$1 AND payment_ref=$2
   UNION ALL SELECT 1 FROM supplier_payment_evidence WHERE bank_account=$1 AND payment_ref=$2`,[a,r])).rowCount){await conn.query('ROLLBACK');return fail('مرجع گردش بانک یا صندوق قبلاً در بخش دیگری ثبت شده است.',409);}}
  const id=randomUUID();await conn.query(`INSERT INTO bank_movement_evidence(id,movement_kind,movement_date,bank_account,other_bank_account,reference,other_reference,party_id,amount_toman,description,actor)
   VALUES($10,$1,$2,$3,$4,$5,$6,$7,$8,$9,$11)`,[...values,id,actor]);
  for(const [a,r] of refs)await conn.query('INSERT INTO bank_movement_references(account,reference,movement_id) VALUES($1,$2,$3)',[a,r,id]);
  await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'bank.movement_evidence',$2,'مدرک گردش نقدی؛ بدون ثبت قطعی')",[actor,id]);
  await conn.query('COMMIT');return {id,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function draftBankMovement(pool,b,actor){
 const id=clean(b.id,80);if(!id)return fail('مدرک معتبر لازم است.');const conn=await pool.connect();try{
  await conn.query('BEGIN');const {rows:[e]}=await conn.query('SELECT id,movement_kind,movement_date,bank_account,other_bank_account,party_id,amount_toman::text AS amount_exact FROM bank_movement_evidence WHERE id=$1 FOR UPDATE',[id]);
  if(!e){await conn.query('ROLLBACK');return fail('مدرک گردش یافت نشد.',404);}
  const prior=await conn.query('SELECT journal_id FROM bank_movement_drafts WHERE evidence_id=$1',[id]);if(prior.rowCount){await conn.query('COMMIT');return {id:prior.rows[0].journal_id,duplicate:true};}
  const amount=cents(e.amount_exact);if(amount===null||amount%100n!==0n){await conn.query('ROLLBACK');return fail('مبلغ دقیق محفوظ است؛ دفتر فعلی تومان صحیح می‌پذیرد.',409);}
  const period=await conn.query('SELECT id FROM periods WHERE $1::date BETWEEN starts AND ends AND locked=0 FOR SHARE',[e.movement_date]);if(period.rowCount!==1){await conn.query('ROLLBACK');return fail('دوره مالی باز لازم است.',409);}
  const mapping={transfer:[e.other_bank_account,e.bank_account],customer_receipt:[e.bank_account,'1100'],customer_deposit:[e.bank_account,'2020'],owner_contribution:[e.bank_account,'3020'],owner_withdrawal:['3030',e.bank_account],loan_receipt:[e.bank_account,'2030']};
  const [debit,credit]=mapping[e.movement_kind],j=randomUUID(),ref='bank-movement:'+id,v=String(amount/100n);
  await conn.query("INSERT INTO journals(id,ref,date,period,description,actor,at) VALUES($1,$2,$3,$4,'پیش‌نویس گردش بانک و صندوق',$5,now()::text)",[j,ref,e.movement_date,period.rows[0].id,actor]);
  await conn.query('INSERT INTO lines(journal,account,detail,debit,credit) VALUES($1,$2,$3,$4,0),($1,$5,$6,0,$4)',[j,debit,id,v,credit,e.party_id||id]);
  await conn.query('INSERT INTO bank_movement_drafts VALUES($1,$2)',[id,j]);await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'bank.movement_draft',$2,'پیش‌نویس گردش مستند؛ بدون ثبت قطعی')",[actor,ref]);
  await conn.query('COMMIT');return {id:j,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
