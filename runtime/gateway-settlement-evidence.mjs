import {randomUUID} from 'node:crypto';
const gateways=['1310','1320','1330','1340','1350','1390'],banks=['1010','1012','1013'];
const invalid=(error,status=400)=>({error,status});
const clean=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max?v.trim():null;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toJSON()?.slice(0,10)===v;
function cents(v){if(typeof v!=='string'||!/^\d{1,13}(\.\d{1,2})?$/.test(v))return null;const [a,b='']=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
const decimal=n=>String(n/100n)+'.'+String(n%100n).padStart(2,'0');

export async function settlementList(pool,url){
 const start=url.searchParams.get('start')||'2026-11-24';
 const end=url.searchParams.get('end')||'9999-12-31';
 if(!validDate(start)||!validDate(end)||start>end)return {rows:[],summary:[],start,end};
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const {rows:[result]}=await pool.query(`
 WITH selected AS (
  SELECT e.id,e.gateway_account,e.bank_account,e.gateway_ref,e.bank_ref,e.settlement_date,
    e.gross_toman::text,e.net_toman::text,e.fee_toman::text,e.ledger_basis,e.evidence_note,e.actor,e.at,
    j.ref AS journal_ref,
    CASE WHEN d.journal_id IS NOT NULL THEN 'draft_created'
      WHEN e.ledger_basis='unknown' THEN 'basis_review'
      WHEN mod(e.gross_toman,1)<>0 OR mod(e.net_toman,1)<>0 OR mod(e.fee_toman,1)<>0 THEN 'fractional_review'
      WHEN NOT EXISTS(SELECT 1 FROM periods p WHERE e.settlement_date BETWEEN p.starts AND p.ends AND p.locked=0) THEN 'period_required'
      ELSE 'ready_for_draft' END AS settlement_status
  FROM gateway_settlement_evidence e LEFT JOIN gateway_settlement_drafts d ON d.evidence_id=e.id
   LEFT JOIN journals j ON j.id=d.journal_id
  WHERE e.settlement_date BETWEEN $1::date AND $2::date
 ), sums AS (
  SELECT gateway_account,count(*)::int AS count, sum(gross_toman::numeric)::text AS gross_toman,
   sum(net_toman::numeric)::text AS net_toman,sum(fee_toman::numeric)::text AS fee_toman
  FROM selected GROUP BY gateway_account ORDER BY gateway_account
 )
 SELECT coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM
  (SELECT * FROM selected ORDER BY settlement_date DESC,id LIMIT 100 OFFSET $3) q),'[]'::jsonb) rows,
  coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM sums s),'[]'::jsonb) summary
 `,[start,end,page*100]);
 return {...result,start,end};
}
export async function recordSettlement(pool,b,actor){
 const gateway=clean(b.gateway_account,12),bank=clean(b.bank_account,12),gatewayRef=clean(b.gateway_ref,120),bankRef=clean(b.bank_ref,120),note=clean(b.evidence_note,500),date=b.settlement_date;
 const basis=b.ledger_basis;
 const gross=cents(b.gross_toman),net=cents(b.net_toman),fee=cents(b.fee_toman);
 if(!['gross_unexpensed','net_already_expensed','unknown'].includes(basis)||!gateways.includes(gateway)||!banks.includes(bank)||!gatewayRef||!bankRef||!note||!validDate(date)||
  gross===null||net===null||fee===null||gross<=0n||net<=0n||gross>100000000000000n||gross!==net+fee)
  return invalid('اطلاعات تسویه نامعتبر است؛ مبلغ ناخالص باید برابر واریزی به‌علاوه کارمزد مستند باشد.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const bounds=await client.query(`SELECT 1 FROM accounting_cutover WHERE id=1 AND
    $1::date BETWEEN (effective_at_utc AT TIME ZONE 'Asia/Tehran')::date AND (now() AT TIME ZONE 'Asia/Tehran')::date`,[date]);
  if(!bounds.rowCount){await client.query('ROLLBACK');return invalid('تاریخ خارج از بازه حسابداری است.');}
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[bank+':'+bankRef]);
  if((await client.query('SELECT 1 FROM operating_expense_evidence WHERE funding_account=$1 AND payment_ref=$2',[bank,bankRef])).rowCount){await client.query('ROLLBACK');return invalid('این مرجع بانک در هزینه عملیاتی ثبت شده است.',409);}
  const args=[gateway,bank,gatewayRef,bankRef,date,decimal(gross),decimal(net),decimal(fee),note,basis];
  const result=await client.query(`INSERT INTO gateway_settlement_evidence
    (id,gateway_account,bank_account,gateway_ref,bank_ref,settlement_date,gross_toman,net_toman,fee_toman,evidence_note,ledger_basis,actor)
    VALUES($11,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12) ON CONFLICT DO NOTHING RETURNING id`,[...args,randomUUID(),actor]);
  if(!result.rowCount){
   const prior=await client.query(`SELECT id FROM gateway_settlement_evidence WHERE
     gateway_account=$1 AND bank_account=$2 AND gateway_ref=$3 AND bank_ref=$4 AND settlement_date=$5
     AND gross_toman=$6 AND net_toman=$7 AND fee_toman=$8 AND evidence_note=$9 AND ledger_basis=$10`,args);
   await client.query('COMMIT');
   return prior.rowCount?{id:prior.rows[0].id,duplicate:true}:invalid('مرجع بانکی یا درگاه قبلاً با اطلاعات متفاوت ثبت شده است.',409);
  }
  const id=result.rows[0].id;
  await client.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'settlement.evidence',$2,'مدرک تسویه؛ بدون ثبت قطعی')",[actor,id]);
  await client.query('COMMIT');return {id,duplicate:false};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function draftSettlement(pool,b,actor){
 const id=clean(b.id,80);if(!id)return invalid('شناسه مدرک لازم است.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const {rows:[e]}=await client.query(`SELECT id,gateway_account,bank_account,settlement_date,ledger_basis,gross_toman::text AS gross_exact,net_toman::text AS net_exact,fee_toman::text AS fee_exact
   FROM gateway_settlement_evidence WHERE id=$1 FOR UPDATE`,[id]);
  if(!e){await client.query('ROLLBACK');return invalid('مدرک پیدا نشد.',404);}
  const prior=await client.query('SELECT journal_id FROM gateway_settlement_drafts WHERE evidence_id=$1',[id]);
  if(prior.rowCount){await client.query('COMMIT');return {id:prior.rows[0].journal_id,duplicate:true};}
  if(e.ledger_basis==='unknown'){await client.query('ROLLBACK');return invalid('مبنای مانده و کارمزد باید از دفتر تأیید شود.',409);}
  const amounts=[e.gross_exact,e.net_exact,e.fee_exact].map(cents);
  if(amounts.some(n=>n===null||n%100n!==0n)){await client.query('ROLLBACK');return invalid('دفتر فعلی فقط تومان صحیح می‌پذیرد؛ مدرک دقیق محفوظ است و گرد نمی‌شود.',409);}
  const [gross,net,fee]=amounts.map(n=>String(n/100n));
  const period=await client.query('SELECT id FROM periods WHERE $1::date BETWEEN starts AND ends AND locked=0 FOR SHARE',[e.settlement_date]);
  if(period.rowCount!==1){await client.query('ROLLBACK');return invalid('ابتدا دوره مالی باز مربوط به تاریخ تسویه را تعریف کنید.',409);}
  const journal=randomUUID(),ref='settlement-evidence:'+id;
  await client.query(`INSERT INTO journals(id,ref,date,period,description,actor,at)
    VALUES($1,$2,$3,$4,'پیش‌نویس تسویه درگاه بر اساس مدرک ثبت‌شده',$5,now()::text)`,
    [journal,ref,e.settlement_date,period.rows[0].id,actor]);
  await client.query("INSERT INTO lines(journal,account,detail,debit,credit) VALUES($1,$2,$3,$4,0),($1,$5,$3,0,$6)",[journal,e.bank_account,id,net,e.gateway_account,e.ledger_basis==='net_already_expensed'?net:gross]);
  if(e.ledger_basis==='gross_unexpensed'&&fee!=='0')await client.query("INSERT INTO lines(journal,account,detail,debit,credit) VALUES($1,'5020',$2,$3,0)",[journal,id,fee]);
  await client.query('INSERT INTO gateway_settlement_drafts(evidence_id,journal_id) VALUES($1,$2)',[id,journal]);
  await client.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'settlement.draft',$2,'سند پیش‌نویس؛ بدون تأیید یا ثبت قطعی')",[actor,ref]);
  await client.query('COMMIT');return {id:journal,duplicate:false};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
