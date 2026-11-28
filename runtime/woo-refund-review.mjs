import {randomUUID} from 'node:crypto';
const validId=v=>typeof v==='string'&&/^[1-9][0-9]{0,15}$/.test(v);
const dateValid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toJSON()?.slice(0,10)===v;
const validStamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)&&new Date(v+'Z').toJSON()?.slice(0,19)===v;
const fail=(error,status=409)=>({error,status});
function money(v,currency,signed=false){
 if(typeof v!=='string'||!/^[-]?\d{1,16}(\.\d{1,6})?$/.test(v)||!['IRR','IRT'].includes(currency))return null;
 const negative=v.startsWith('-');if(negative&&!signed)return null;
 const [a,b='']=(negative?v.slice(1):v).split('.');
 let n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));
 if(currency==='IRR'){if(n%10n!==0n)return null;n/=10n;}
 return negative?-n:n;
}
const format=n=>n===null?null:String(n/1000000n)+(n%1000000n?'.'+String(n%1000000n).padStart(6,'0').replace(/0+$/,''):'');
const key=i=>Number.isSafeInteger(i?.product_id)&&i.product_id>0&&Number.isSafeInteger(i.variation_id)&&i.variation_id>=0?i.product_id+':'+i.variation_id:null;
const whole=n=>n!==null&&n>=0n&&n<=1000000000000000000n;
export function refundProposals({original,current,refunds,cutover}){
 const reasons=new Set(),currency=original?.currency||current?.currency;
 const orig=original||current||{};
 const gross=money(orig.total,currency),capacity=new Map(),used=new Map();
 if(!original)reasons.add('original_draft_required');
 if(!current||!['completed','refunded'].includes(current.status)||!original||current.currency!==original.currency||
  ['total','total_tax','discount_total','shipping_total','shipping_tax','date_completed_gmt','line_items','shipping_lines','fee_lines'].some(k=>JSON.stringify(current[k])!==JSON.stringify(original[k])))reasons.add('original_changed');
 if(!validStamp(orig.date_completed_gmt)||orig.date_completed_gmt<cutover)reasons.add('completion_review');
 if(gross===null||gross<=0n)reasons.add('amount_review');
 if(!Array.isArray(orig.line_items)||!orig.line_items.length)reasons.add('line_review');
 else for(const i of orig.line_items){
  const k=key(i),net=money(i.total,currency),tax=money(i.total_tax,currency);
  if(!k||!Number.isSafeInteger(i.quantity)||i.quantity<=0||net===null||tax===null){reasons.add('line_review');continue;}
  const v=capacity.get(k)||{qty:0n,net:0n,tax:0n};v.qty+=BigInt(i.quantity);v.net+=net;v.tax+=tax;capacity.set(k,v);
 }
 const listed=Array.isArray(current?.refunds)?current.refunds.map(r=>String(r?.id)):[];
 const actual=refunds.map(r=>r.id);
 if(!Array.isArray(current?.refunds)||new Set(listed).size!==listed.length||listed.length!==actual.length||listed.some(id=>!actual.includes(id)))reasons.add('refund_set_review');
 let cumulative=0n;
 const prepared=refunds.map(r=>{
  const p=r.payload||{},localReasons=new Set();
  let amount=money(p.amount,currency,true);if(amount!==null&&amount<0n)amount=-amount;
  if(amount===null||amount<=0n)localReasons.add('amount_review');else cumulative+=amount;
  if(!validStamp(p.date_created_gmt)||p.date_created_gmt<cutover||!validStamp(orig.date_completed_gmt)||p.date_created_gmt<orig.date_completed_gmt)localReasons.add('date_review');
  let net=0n,tax=0n;
  if(!Array.isArray(p.line_items)||!p.line_items.length)localReasons.add('allocation_review');
  else for(const i of p.line_items){
   const k=key(i),n=money(i.total,currency,true),t=money(i.total_tax,currency,true);
   if(!k||!capacity.has(k)||!Number.isSafeInteger(i.quantity)||i.quantity>=0||n===null||n>0n||t===null||t>0n){localReasons.add('allocation_review');continue;}
   const v=used.get(k)||{qty:0n,net:0n,tax:0n};v.qty+=BigInt(-i.quantity);v.net-=n;v.tax-=t;used.set(k,v);
   net-=n;tax-=t;
  }
  if(amount===null||amount!==net+tax||net<=0n)localReasons.add('allocation_review');
  if(amount!==null&&![amount,net,tax].every(whole))localReasons.add('precision_review');
  return {r,amount,net,tax,localReasons};
 });
 if(gross!==null&&cumulative>gross)reasons.add('over_refund');
 for(const [k,v] of used){const c=capacity.get(k);if(v.qty>c.qty||v.net>c.net||v.tax>c.tax)reasons.add('over_refund');}
 if(prepared.some(p=>[...p.localReasons].some(x=>x!=='precision_review')))reasons.add('refund_set_review');
 return prepared.map(({r,amount,net,tax,localReasons})=>{
  const issues=[...new Set([...reasons,...localReasons])];
  const lines=issues.length?[]:[{account:'4040',debit:format(net),credit:'0'},...(tax>0n?[{account:'2100',debit:format(tax),credit:'0'}]:[]),{account:'1100',debit:'0',credit:format(amount)}];
  return {refund_id:r.id,revision_id:r.revision_id,refund_toman:format(amount),merchandise_toman:format(net),refund_tax_toman:format(tax),refund_extent:gross!==null&&cumulative===gross?'full_cumulative':gross!==null&&cumulative<gross?'partial_cumulative':'unverified',reasons:issues,lines,status:issues.length?'review_required':'receivable_reversal_candidate',posting_authorized:false};
 });
}
async function loadOrderRefunds(conn,orderId){
 const {rows:[row]}=await conn.query(`
 SELECT r.payload current,o.payload original,
 to_char(a.effective_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') cutover,
 d.journal_id original_journal,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.external_id,'revision_id',f.revision_id,'payload',v.payload) ORDER BY f.external_id::bigint)
 FROM raw_current f JOIN raw_revisions v ON v.id=f.revision_id WHERE f.kind='refunds' AND f.parent_id=c.external_id),'[]'::jsonb) refunds
 FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id CROSS JOIN accounting_cutover a
 LEFT JOIN woo_revenue_drafts d ON d.external_id=c.external_id LEFT JOIN raw_revisions o ON o.id=d.revision_id
 WHERE a.id=1 AND c.kind='orders' AND c.parent_id='' AND c.external_id=$1`,[orderId]);
 return row;
}
export async function refundReviewList(pool,url){
 const start=url.searchParams.get('start')||'2026-11-24',end=url.searchParams.get('end')||'9999-12-31';
 const id=url.searchParams.get('id')||'';
 if(!dateValid(start)||!dateValid(end)||start>end||(id&&!validId(id)))return {rows:[],start,end,posting_authorized:false};
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const conn=await pool.connect();
 try{
 await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const {rows:entries}=await conn.query(`
 SELECT c.external_id refund_id,c.parent_id order_id,c.revision_id,
 (r.payload->>'date_created_gmt') AS refund_at,j.ref draft_ref,d.refund_revision
 FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
 LEFT JOIN woo_refund_review_drafts d ON d.order_id=c.parent_id AND d.refund_id=c.external_id
 LEFT JOIN journals j ON j.id=d.journal_id
 WHERE c.kind='refunds' AND ($4='' OR c.external_id=$4)
 AND r.payload->>'date_created_gmt'>=to_char(greatest($1::date::timestamp AT TIME ZONE 'Asia/Tehran',(SELECT effective_at_utc FROM accounting_cutover WHERE id=1)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')
 AND r.payload->>'date_created_gmt'<to_char((($2::date+1)::timestamp AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')
 ORDER BY refund_at DESC,c.external_id::bigint LIMIT 100 OFFSET $3`,[start,end,page*100,id]);
 const cache=new Map(),rows=[];
 for(const e of entries){
  if(!cache.has(e.order_id)){const input=await loadOrderRefunds(conn,e.order_id);cache.set(e.order_id,input?refundProposals(input):[]);}
  const proposal=cache.get(e.order_id).find(p=>p.refund_id===e.refund_id)||{refund_id:e.refund_id,revision_id:e.revision_id,reasons:['original_missing'],lines:[],status:'review_required',posting_authorized:false};
  rows.push({...e,...proposal,draft_status:e.draft_ref?(e.refund_revision===e.revision_id&&proposal.status==='receivable_reversal_candidate'?'draft_created':'draft_stale'):proposal.status});
 }
 await conn.query('COMMIT');return {rows,start,end,posting_authorized:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function createRefundDraft(pool,b,actor){
 const orderId=String(b.order_id??''),refundId=String(b.refund_id??''),revision=b.revision_id;
 if(!validId(orderId)||!validId(refundId)||!Number.isSafeInteger(revision)||revision<1||b.uncollected_receivable_confirmed!==true)return fail('مدرک و تأیید دریافتنی وصول‌نشده لازم است.',400);
 const conn=await pool.connect();
 try{
 await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
 await conn.query("SELECT 1 FROM raw_current WHERE kind='orders' AND parent_id='' AND external_id=$1 FOR UPDATE",[orderId]);
 const input=await loadOrderRefunds(conn,orderId);
 const p=input&&refundProposals(input).find(r=>r.refund_id===refundId);
 if(!p||p.revision_id!==revision||p.status!=='receivable_reversal_candidate'){await conn.query('ROLLBACK');return fail('مدرک برگشت یا فروش اولیه نیازمند بررسی است.');}
 const prior=await conn.query('SELECT refund_revision,journal_id FROM woo_refund_review_drafts WHERE order_id=$1 AND refund_id=$2',[orderId,refundId]);
 if(prior.rowCount){await conn.query('COMMIT');return prior.rows[0].refund_revision===revision?{id:prior.rows[0].journal_id,duplicate:true}:fail('نسخه استرداد تغییر کرده است.');}
 const {rows:[original]}=await conn.query("SELECT status FROM journals WHERE id=$1 FOR SHARE",[input.original_journal]);
 if(original?.status!=='draft'){await conn.query('ROLLBACK');return fail('فقط اصلاح پیشنهادی پیش‌نویس درآمد مجاز است.');}
 const {rows:[date]}=await conn.query("SELECT ($1::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran')::date AS local_date",[input.refunds.find(r=>r.id===refundId).payload.date_created_gmt]);
 const period=await conn.query('SELECT id FROM periods WHERE $1::date BETWEEN starts AND ends AND locked=0 FOR SHARE',[date.local_date]);
 if(period.rowCount!==1){await conn.query('ROLLBACK');return fail('دوره مالی باز لازم است.');}
 const journal=randomUUID(),ref='woo-refund:'+orderId+':'+refundId;
 await conn.query("INSERT INTO journals(id,ref,date,period,description,actor,at) VALUES($1,$2,$3,$4,'پیش‌نویس برگشت فروش در برابر دریافتنی وصول‌نشده؛ بدون استرداد وجه یا ورود انبار',$5,now()::text)",[journal,ref,date.local_date,period.rows[0].id,actor]);
 for(const l of p.lines)await conn.query('INSERT INTO lines(journal,account,detail,debit,credit) VALUES($1,$2,$3,$4,$5)',[journal,l.account,l.account==='1100'?'woo-order:'+orderId:'',l.debit,l.credit]);
 await conn.query('INSERT INTO woo_refund_review_drafts(order_id,refund_id,refund_revision,journal_id,actor) VALUES($1,$2,$3,$4,$5)',[orderId,refundId,revision,journal,actor]);
 await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'woo.refund_draft',$2,'پیشنهاد اصلاح دریافتنی؛ بدون ثبت قطعی')",[actor,ref]);
 await conn.query('COMMIT');return {id:journal,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
