import {randomUUID} from 'node:crypto';
const banks=['1010','1012','1013'],fail=(error,status=400)=>({error,status});
const clean=(x,max)=>typeof x==='string'&&x.trim()&&x.trim().length<=max?x.trim():null;
const dateValid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toJSON()?.slice(0,10)===v;
export function exactStatementAmount(value,currency){
 if(typeof value!=='string'||!/^\d{1,14}(\.\d{1,6})?$/.test(value)||!['IRT','IRR'].includes(currency))return null;
 const [a,b='']=value.split('.');let n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));if(currency==='IRR'){if(n%10n!==0n)return null;n/=10n;}
 if(n<=0n||n>1000000000000000000n)return null;const fraction=String(n%1000000n).padStart(6,'0').replace(/0+$/,'').padEnd(2,'0');return String(n/1000000n)+'.'+fraction;
}
async function lock(conn,account){await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['bank-statement:'+account]);}
async function matchExact(conn,account,actor){
 const {rows:[r]}=await conn.query(`WITH matches AS (
  SELECT s.id,c.source_key,count(*) OVER(PARTITION BY s.id) AS occurrences,count(*) OVER(PARTITION BY c.source_key) AS source_occurrences
  FROM bank_statement_rows s JOIN bank_statement_candidates c ON c.account=s.account AND c.reference=s.reference AND c.transaction_date=s.transaction_date AND c.direction=s.direction AND c.amount_toman=s.amount_toman
  WHERE s.account=$1 AND NOT EXISTS(SELECT 1 FROM bank_statement_links l WHERE l.statement_id=s.id OR l.source_key=c.source_key)
    AND NOT EXISTS(SELECT 1 FROM bank_statement_candidates other WHERE other.account=c.account AND other.reference=c.reference AND other.source_key<>c.source_key)
 ), saved AS (INSERT INTO bank_statement_links(statement_id,source_key,method,note,actor)
  SELECT id,source_key,'exact_reference','تطبیق خودکار مرجع، مبلغ، تاریخ و جهت',$2 FROM matches WHERE occurrences=1 AND source_occurrences=1 ON CONFLICT DO NOTHING RETURNING statement_id),
 audit_rows AS (INSERT INTO audit(at,actor,action,ref,description) SELECT now()::text,$2,'bank.statement_match',statement_id,'تطبیق دقیق صورت‌حساب؛ بدون ثبت سند' FROM saved)
 SELECT count(*)::int AS matched FROM saved`,[account,actor]);return r.matched;
}
export async function importBankStatement(pool,b,actor){
 const account=b.account,currency=b.currency;if(!banks.includes(account)||!['IRT','IRR'].includes(currency)||!Array.isArray(b.rows)||!b.rows.length||b.rows.length>50)return fail('حساب بانک، واحد مبلغ و حداکثر ۵۰ ردیف معتبر لازم است.');
 const seen=new Set(),items=[];
 for(const row of b.rows){const reference=clean(row?.reference,120),date=row?.transaction_date,direction=row?.direction,amount=exactStatementAmount(row?.amount,currency),description=typeof row?.description==='string'?row.description.trim():'';
  if(!reference||seen.has(reference)||!dateValid(date)||!['credit','debit'].includes(direction)||amount===null||description.length>500)return fail('تاریخ، مرجع یکتا، جهت و مبلغ دقیق همه ردیف‌ها الزامی است.');
  seen.add(reference);items.push({id:randomUUID(),reference,transaction_date:date,direction,amount_toman:amount,source_amount:row.amount,currency,description});
 }
 const conn=await pool.connect();try{await conn.query('BEGIN');await lock(conn,account);
  const future=await conn.query(`SELECT 1 FROM jsonb_to_recordset($1::jsonb) x(transaction_date date) WHERE x.transaction_date>(now() AT TIME ZONE 'Asia/Tehran')::date LIMIT 1`,[JSON.stringify(items)]);
  if(future.rowCount){await conn.query('ROLLBACK');return fail('تاریخ گردش آینده پذیرفته نمی‌شود.');}
  const prior=await conn.query(`SELECT s.reference, s.transaction_date=x.transaction_date AND s.direction=x.direction AND s.amount_toman=x.amount_toman AND s.description=x.description AS identical FROM bank_statement_rows s JOIN jsonb_to_recordset($2::jsonb) x(reference text,transaction_date date,direction text,amount_toman numeric,description text) USING(reference) WHERE s.account=$1`,[account,JSON.stringify(items)]);
  if(prior.rows.some(r=>!r.identical)){await conn.query('ROLLBACK');return fail('حداقل یک مرجع قبلاً با مبلغ، تاریخ، جهت یا شرح متفاوت وارد شده است؛ هیچ ردیف این دسته ذخیره نشد.',409);}
  const saved=await conn.query(`INSERT INTO bank_statement_rows(id,account,transaction_date,reference,direction,amount_toman,currency,source_amount,description,actor)
    SELECT id,$1,transaction_date,reference,direction,amount_toman,currency,source_amount,description,$2 FROM jsonb_to_recordset($3::jsonb) x(id text,transaction_date date,reference text,direction text,amount_toman numeric,currency text,source_amount text,description text) ON CONFLICT(account,reference) DO NOTHING RETURNING id`,[account,actor,JSON.stringify(items)]);
  const matched=await matchExact(conn,account,actor);await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'bank.statement_import',$2,$3)",[actor,account,'تعداد جدید '+saved.rowCount+'؛ تطبیق '+matched]);await conn.query('COMMIT');return {saved:saved.rowCount,duplicates:items.length-saved.rowCount,matched,posting_authorized:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function reconcileBankStatement(pool,b,actor){
 const account=b.account;if(!banks.includes(account))return fail('حساب معتبر بانک لازم است.');const conn=await pool.connect();try{await conn.query('BEGIN');await lock(conn,account);const matched=await matchExact(conn,account,actor);await conn.query('COMMIT');return {matched};}catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function confirmStatementMatch(pool,b,actor){
 const id=clean(b.statement_id,80),key=clean(b.source_key,180),note=clean(b.note,500);if(!id||!key||!note||b.confirmed!==true)return fail('تأیید صریح مرجع و مستند تطبیق لازم است.');
 const conn=await pool.connect();try{await conn.query('BEGIN');const {rows:[s]}=await conn.query('SELECT id,account FROM bank_statement_rows WHERE id=$1',[id]);if(!s){await conn.query('ROLLBACK');return fail('ردیف صورت‌حساب یافت نشد.',404);}await lock(conn,s.account);
 const existing=await conn.query('SELECT source_key FROM bank_statement_links WHERE statement_id=$1',[id]);if(existing.rowCount){await conn.query('COMMIT');return existing.rows[0].source_key===key?{duplicate:true}:fail('ردیف قبلاً تطبیق داده شده است.',409);}
 const valid=await conn.query(`SELECT c.source_key FROM bank_statement_rows s JOIN bank_statement_candidates c ON c.account=s.account AND c.transaction_date=s.transaction_date AND c.direction=s.direction AND c.amount_toman=s.amount_toman
 WHERE s.id=$1 AND c.source_key=$2 AND NOT EXISTS(SELECT 1 FROM bank_statement_links l WHERE l.source_key=c.source_key)
 AND NOT EXISTS(SELECT 1 FROM bank_statement_rows other WHERE other.account=s.account AND other.id<>s.id AND other.reference=c.reference)
 AND NOT EXISTS(SELECT 1 FROM bank_statement_candidates other WHERE other.account=s.account AND other.reference=s.reference AND other.source_key<>c.source_key)`,[id,key]);
 if(valid.rowCount!==1){await conn.query('ROLLBACK');return fail('مستند انتخابی با تاریخ، مبلغ و جهت مطابقت ندارد یا با مرجع دیگری در تعارض است.',409);}
 await conn.query("INSERT INTO bank_statement_links(statement_id,source_key,method,note,actor) VALUES($1,$2,'owner_confirmed',$3,$4)",[id,key,note,actor]);await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'bank.statement_match',$2,'تطبیق مستند به تأیید مالک؛ بدون ثبت سند')",[actor,id]);await conn.query('COMMIT');return {matched:true};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function bankStatementList(pool,url){
 const start=url.searchParams.get('start')||'0001-01-01',end=url.searchParams.get('end')||'9999-12-31',account=url.searchParams.get('account')||'',status=url.searchParams.get('match_status')||'';if(!dateValid(start)||!dateValid(end)||start>end||account&&!banks.includes(account)||!['','matched','exact_pending','conflict','review','unmatched'].includes(status))return {rows:[],summary:[],start,end,posting_authorized:false};
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const {rows:[result]}=await pool.query(`WITH selected AS (
 SELECT s.id,s.account,s.transaction_date,s.reference,s.direction,s.amount_toman::text,s.description,s.currency,s.source_amount,l.method,l.source_key,
 CASE WHEN l.statement_id IS NOT NULL THEN 'matched'
  WHEN EXISTS(SELECT 1 FROM bank_statement_candidates c WHERE c.account=s.account AND c.reference=s.reference AND (c.transaction_date<>s.transaction_date OR c.direction<>s.direction OR c.amount_toman<>s.amount_toman OR EXISTS(SELECT 1 FROM bank_statement_links z WHERE z.source_key=c.source_key))) THEN 'conflict'
  WHEN EXISTS(SELECT 1 FROM bank_statement_candidates c WHERE c.account=s.account AND c.reference=s.reference AND c.transaction_date=s.transaction_date AND c.direction=s.direction AND c.amount_toman=s.amount_toman) THEN 'exact_pending'
  WHEN EXISTS(SELECT 1 FROM bank_statement_candidates c WHERE c.account=s.account AND c.transaction_date=s.transaction_date AND c.direction=s.direction AND c.amount_toman=s.amount_toman AND NOT EXISTS(SELECT 1 FROM bank_statement_links z WHERE z.source_key=c.source_key)) THEN 'review' ELSE 'unmatched' END match_status
 FROM bank_statement_rows s LEFT JOIN bank_statement_links l ON l.statement_id=s.id WHERE s.transaction_date BETWEEN $1::date AND $2::date AND ($3='' OR s.account=$3)
 ), filtered AS (SELECT * FROM selected WHERE $5='' OR match_status=$5), pg AS (SELECT * FROM filtered ORDER BY transaction_date DESC,id LIMIT 100 OFFSET $4), detailed AS (
 SELECT p.*,coalesce((SELECT jsonb_agg(q) FROM (SELECT c.source_key,c.source_kind,c.reference FROM bank_statement_candidates c WHERE p.match_status='review' AND c.account=p.account AND c.transaction_date=p.transaction_date AND c.direction=p.direction AND c.amount_toman=p.amount_toman::numeric AND NOT EXISTS(SELECT 1 FROM bank_statement_links z WHERE z.source_key=c.source_key) ORDER BY c.source_key LIMIT 20) q),'[]'::jsonb) candidates FROM pg p
 ), summary AS (SELECT account,match_status,direction,count(*)::int count,sum(amount_toman::numeric)::text amount_toman FROM filtered GROUP BY account,match_status,direction)
 SELECT coalesce((SELECT jsonb_agg(detailed ORDER BY transaction_date DESC,id) FROM detailed),'[]'::jsonb) rows,coalesce((SELECT jsonb_agg(summary) FROM summary),'[]'::jsonb) summary`,[start,end,account,page*100,status]);return {...result,start,end,posting_authorized:false};
}
