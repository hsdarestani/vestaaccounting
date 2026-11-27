import {randomUUID} from 'node:crypto';
// Derive a non-postable sales journal proposal from WooCommerce evidence.
 // Revenue is recognized at documented completion, not order creation or payment.
 // Exact decimal arithmetic is used; no bank receipt, historic inventory cost, or
 // return is inferred. The proposals remain distinct from the financial ledger.
const dateValid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toJSON()?.slice(0,10)===v;
const fmt=n=>{if(n===null)return null;const s=(n<0n?-n:n).toString().padStart(7,'0');return (n<0n?'-':'')+s.slice(0,-6)+(s.slice(-6).replace(/0+$/,'')?'.'+s.slice(-6).replace(/0+$/,''):'');};
// Store monetary amounts in millionths of a Toman for exact conversion.
// IRR can have at most five source decimal places; no silent rounding.
function money(v,currency){
 if(typeof v!=='string'||!/^\d{1,16}(\.\d{1,6})?$/.test(v)||!['IRT','IRR'].includes(currency))return null;
 const [a,b='']=v.split('.');const n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));
 if(currency==='IRR'&&n%10n!==0n)return null;
 return currency==='IRR'?n/10n:n;
}
function validStamp(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'Z'));}
function totalLines(rows,field,currency){
 let total=0n;
 for(const row of rows){const value=money(row?.[field],currency);if(value===null)return null;total+=value;}
 return total;
}
export function saleProposal(order,{refundExists=false,cutover='2026-11-23T20:30:00',stockIdentities=[]}={}){
 const reasons=[];
 const currency=order.currency;
 const items=order.line_items;
 const stamp=order.date_completed_gmt;
 if(order.status!=='completed'||!validStamp(stamp)||stamp<cutover)reasons.push('completion_review');
 if(!['IRT','IRR'].includes(currency))reasons.push('currency_review');
 if(!Array.isArray(order.refunds)||order.refunds.length||refundExists)reasons.push('refund_review');
 if(!Array.isArray(items)||!items.length||items.some(i=>!Number.isSafeInteger(i.quantity)||i.quantity<=0||!Number.isSafeInteger(i.product_id)||i.product_id<=0||!Number.isSafeInteger(i.variation_id)||i.variation_id<0))reasons.push('line_review');
 else if(stockIdentities.length!==items.length||stockIdentities.some(v=>!v))reasons.push('identity_review');
 if(!Array.isArray(order.fee_lines)||order.fee_lines.length)reasons.push('fee_review');
 const gross=money(order.total,currency),shipping=money(order.shipping_total,currency),tax=money(order.total_tax,currency),shippingTax=money(order.shipping_tax,currency),discount=money(order.discount_total,currency);
 const net=Array.isArray(items)?totalLines(items,'total',currency):null;
 const subtotal=Array.isArray(items)?totalLines(items,'subtotal',currency):null;
 const itemTax=Array.isArray(items)?totalLines(items,'total_tax',currency):null;
 const shippingLines=Array.isArray(order.shipping_lines)?totalLines(order.shipping_lines,'total',currency):null;
 const shippingLineTax=Array.isArray(order.shipping_lines)?totalLines(order.shipping_lines,'total_tax',currency):null;
 const amounts=[gross,shipping,tax,shippingTax,discount,net,subtotal,itemTax,shippingLines,shippingLineTax];
 if(amounts.some(v=>v===null)||gross===0n||net===0n)reasons.push('amount_review');
 else if(subtotal-net!==discount||shippingLines!==shipping||shippingTax!==shippingLineTax||itemTax+shippingTax!==tax||net+shipping+tax!==gross)reasons.push('total_mismatch');
 const lines=[];
 if(!reasons.length){
  lines.push({account:'1100',debit:fmt(gross),credit:'0'});
  lines.push({account:'4010',debit:'0',credit:fmt(subtotal)});
  if(discount>0n)lines.push({account:'4030',debit:fmt(discount),credit:'0'});
  if(shipping>0n)lines.push({account:'4020',debit:'0',credit:fmt(shipping)});
  if(tax>0n)lines.push({account:'2100',debit:'0',credit:fmt(tax)});
 }
 return {status:reasons.length?'review_required':'revenue_proposed',reasons, gross_toman:fmt(gross),merchandise_net_toman:fmt(net),discount_toman:fmt(discount),shipping_toman:fmt(shipping),tax_toman:fmt(tax),lines,posting_authorized:false,cogs_status:'historical_inventory_required',payment_status:validStamp(order.date_paid_gmt)?'woo_paid_not_bank_verified':'payment_unverified'};
}
export async function salesProposalList(pool,url){
 const start=url.searchParams.get('start')||'2026-11-24';
 const end=url.searchParams.get('end')||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(!dateValid(start)||!dateValid(end)||start>end)return {rows:[],start,end};
 const id=url.searchParams.get('id')||'';
 if(id&&!/^[1-9][0-9]{0,15}$/.test(id))return {rows:[],start,end,posting_authorized:false};
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const {rows}=await pool.query(`
 WITH bounds AS (
  SELECT to_char(effective_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') cutover,
   to_char(greatest($1::date::timestamp AT TIME ZONE 'Asia/Tehran',effective_at_utc) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') first_at,
   to_char((($2::date+1)::timestamp AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') last_at
  FROM accounting_cutover WHERE id=1
 ), candidates AS (
  SELECT c.external_id,c.revision_id,r.payload,b.cutover,
    coalesce(nullif(r.payload->>'date_completed_gmt',''),nullif(r.payload->>'date_paid_gmt',''),r.payload->>'date_created_gmt') activity_at
  FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id CROSS JOIN bounds b
  WHERE c.kind='orders' AND c.parent_id='' AND ($4='' OR c.external_id=$4)
 ), selected AS (
  SELECT c.* FROM candidates c CROSS JOIN bounds b WHERE activity_at>=b.first_at AND activity_at<b.last_at
  ORDER BY activity_at DESC,external_id::bigint LIMIT 100 OFFSET $3
 )
 SELECT c.*,d.revision_id AS draft_revision_id,j.ref AS draft_ref,
   (c.activity_at::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran')::date local_date,
   EXISTS(SELECT 1 FROM raw_current f WHERE f.kind='refunds' AND f.parent_id=c.external_id) refund_exists,
   coalesce((SELECT jsonb_agg(EXISTS(
    SELECT 1 FROM raw_current p JOIN raw_revisions q ON q.id=p.revision_id
    WHERE ((i.item->>'variation_id'='0' AND p.kind='products' AND p.parent_id='' AND p.external_id=i.item->>'product_id' AND q.payload->>'type'='simple')
     OR (i.item->>'variation_id'~'^[1-9][0-9]*$' AND p.kind='variations' AND p.external_id=i.item->>'variation_id' AND p.parent_id=i.item->>'product_id'))
   ) ORDER BY i.ord) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.payload->'line_items')='array' THEN c.payload->'line_items' ELSE '[]'::jsonb END) WITH ORDINALITY i(item,ord)),'[]'::jsonb) identities
 FROM selected c LEFT JOIN woo_revenue_drafts d ON d.external_id=c.external_id LEFT JOIN journals j ON j.id=d.journal_id ORDER BY c.activity_at DESC,c.external_id::bigint
 `,[start,end,page*100,id]);
 return {rows:rows.map(r=>{
  const proposal=saleProposal(r.payload,{refundExists:r.refund_exists,cutover:r.cutover,stockIdentities:r.identities});
  const draft_status=r.draft_ref?(r.draft_revision_id===r.revision_id&&proposal.status==='revenue_proposed'?'draft_created':'draft_stale'):
   proposal.status!=='revenue_proposed'?'review_required':proposal.lines.some(l=>![l.debit,l.credit].every(wholeToman))?'precision_review':'draft_candidate';
  return {external_id:r.external_id,revision_id:r.revision_id,local_date:r.local_date,order_status:r.payload.status,...proposal,draft_status,draft_ref:r.draft_ref};
 }),start,end,posting_authorized:false};
}

function wholeToman(v){return /^\d{1,13}$/.test(v)&&BigInt(v)<=1000000000000n;}
export async function createRevenueDraft(pool,input,actor){
 const id=String(input.external_id??''),revision=input.revision_id;
 const error=(error,status=409)=>({error,status});
 if(!/^[1-9][0-9]{0,15}$/.test(id)||!Number.isSafeInteger(revision)||revision<1)return error('شناسه سفارش و نسخه مدرک معتبر لازم است.',400);
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const current=await conn.query("SELECT revision_id FROM raw_current WHERE kind='orders' AND external_id=$1 AND parent_id='' FOR UPDATE",[id]);
  if(!current.rowCount){await conn.query('ROLLBACK');return error('سفارش یافت نشد.',404);}
  if(current.rows[0].revision_id!==revision){await conn.query('ROLLBACK');return error('مدرک سفارش تغییر کرده است.');}
  const query=new URL('https://example.invalid/?id='+id+'&start=2026-11-24');
  const {rows:[p]}=await salesProposalList(conn,query);
  if(!p||p.status!=='revenue_proposed'){await conn.query('ROLLBACK');return error('مدرک درآمد سفارش هنوز قابل استفاده نیست.');}
  if(p.draft_status==='draft_stale'){await conn.query('ROLLBACK');return error('پیش‌نویس قبلی نیازمند بررسی مجدد است.');}
  if(p.draft_status==='draft_created'){await conn.query('COMMIT');return {ref:p.draft_ref,duplicate:true};}
  if(p.draft_status!=='draft_candidate'){await conn.query('ROLLBACK');return error('مبلغ سند نیازمند بررسی دقت پولی است؛ گرد نمی‌شود.');}
  const period=await conn.query('SELECT id FROM periods WHERE $1::date BETWEEN starts AND ends AND locked=0 FOR SHARE',[p.local_date]);
  if(period.rowCount!==1){await conn.query('ROLLBACK');return error('دوره مالی باز برای تاریخ تکمیل سفارش لازم است.');}
  const journal=randomUUID(),ref='woo-revenue:'+id;
  await conn.query(`INSERT INTO journals(id,ref,date,period,description,actor,at) VALUES($1,$2,$3,$4,'پیش‌نویس درآمد ووکامرس؛ فاقد بهای تمام‌شده و تأیید دریافتنی',$5,now()::text)`,[journal,ref,p.local_date,period.rows[0].id,actor]);
  for(const l of p.lines)await conn.query('INSERT INTO lines(journal,account,detail,debit,credit) VALUES($1,$2,$3,$4,$5)',[journal,l.account,l.account==='1100'?'woo-order:'+id:'',l.debit,l.credit]);
  await conn.query('INSERT INTO woo_revenue_drafts(external_id,revision_id,journal_id,actor) VALUES($1,$2,$3,$4)',[id,revision,journal,actor]);
  await conn.query("INSERT INTO audit(at,actor,action,ref,description) VALUES(now()::text,$1,'woo.revenue_draft',$2,'سند درآمد ناقص؛ بدون ثبت قطعی یا بهای تمام‌شده')",[actor,ref]);
  await conn.query('COMMIT');return {ref,duplicate:false};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
