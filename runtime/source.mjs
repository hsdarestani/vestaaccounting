import {refundReviewList,createRefundDraft} from './woo-refund-review.mjs';
import {supplierPaymentList,recordSupplierPayment,draftSupplierPayment} from './supplier-payment-evidence.mjs';
import {purchaseInvoiceList,recordPurchaseInvoice,draftPurchaseInvoice} from './purchase-invoice-evidence.mjs';
import {expenseEvidenceList,recordExpenseEvidence,draftExpense} from './operating-expense-evidence.mjs';
import {inventoryCostList,recordInventoryCost} from './inventory-cost-evidence.mjs';
import {financialReadiness} from './financial-readiness.mjs';
import {stockReconciliationList,recordStockReconciliation} from './opening-stock-reconciliation.mjs';
import {openingBridgeList,recordOpeningBridge} from './opening-balance-bridge.mjs';
import {salesProposalList,createRevenueDraft} from './woo-sale-proposals.mjs';
import {settlementList,recordSettlement,draftSettlement} from './gateway-settlement-evidence.mjs';
import {wooReconciliation} from './woo-reconciliation.mjs';
import {correctPurchaseCost,openingReviewModules,reviewOpeningInput} from './opening-review.mjs';
import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const kinds=['products','variations','orders','customers','refunds','coupons','categories'];
const now=()=>new Date().toISOString();
const fields={products:'id,name,sku,type,status,price,regular_price,sale_price,currency,stock_quantity,stock_status,manage_stock,categories,date_modified_gmt,variations',variations:'id,name,sku,price,regular_price,sale_price,currency,stock_quantity,stock_status,manage_stock,attributes,date_modified_gmt,status',orders:'id,number,date_created_gmt,date_modified_gmt,status,currency,customer_id,total,total_tax,discount_total,discount_tax,shipping_total,shipping_tax,payment_method,payment_method_title,transaction_id,date_paid_gmt,date_completed_gmt,line_items,shipping_lines,coupon_lines,fee_lines,tax_lines,refunds',customers:'id,date_created_gmt,date_modified_gmt,first_name,last_name',refunds:'id,date_created_gmt,amount,reason,line_items',coupons:'id,code,discount_type,amount,date_modified_gmt,date_expires_gmt,usage_limit,usage_count',categories:'id,name,slug,parent,count'};
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(o,k)).map(k=>[k,o[k]]));
const nestedFields=['id','name','product_id','variation_id','quantity','sku','subtotal','subtotal_tax','total','total_tax','taxes','method_title','method_id','code','discount','discount_tax','rate_id','label','compound','tax_total','shipping_tax_total','amount'];
export function normalizeSource(kind,row,parent=''){
 if(!kinds.includes(kind)||!row||!Number.isSafeInteger(row.id)||row.id<=0)throw Error('invalid source identity');
 const data=pick(row,fields[kind].split(','));for(const field of ['line_items','shipping_lines','coupon_lines','fee_lines','tax_lines','refunds'])if(Array.isArray(data[field]))data[field]=data[field].map(x=>pick(x,nestedFields));
 // Monetary values intentionally remain original decimal strings + source currency.
 // No customer names, addresses or payment credentials are sent to logs/UI.
 const modified=data.date_modified_gmt||data.date_created_gmt||null;
 return {kind,external_id:String(row.id),parent_id:String(parent),modified,payload:data,fingerprint:hash(JSON.stringify(data))};
}
export async function persistPage(pool,kind,rows,parent=''){
 const conn=await pool.connect();try{await conn.query('BEGIN');for(const row of rows){const x=normalizeSource(kind,row,parent),values=[x.kind,x.external_id,x.parent_id,x.fingerprint,x.modified,JSON.stringify(x.payload)];const insert=await conn.query('INSERT INTO raw_revisions(kind,external_id,parent_id,fingerprint,modified,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING id',values);const id=insert.rows[0]?.id||(await conn.query('SELECT id FROM raw_revisions WHERE kind=$1 AND external_id=$2 AND parent_id=$3 AND fingerprint=$4',values.slice(0,4))).rows[0].id;await conn.query('INSERT INTO raw_current(kind,external_id,parent_id,revision_id,modified) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,external_id,parent_id) DO UPDATE SET revision_id=excluded.revision_id,modified=excluded.modified,checked_at=now() WHERE raw_current.modified IS NULL OR (excluded.modified IS NOT NULL AND excluded.modified>=raw_current.modified)',[x.kind,x.external_id,x.parent_id,id,x.modified]);}await conn.query('COMMIT');}catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}}
export class WooSource{
 constructor({origin,key,secret,fetcher=fetch,pageSize=30,catalogAdapter=false}){const u=new URL(origin);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/')throw Error('explicit HTTPS WooCommerce origin required');if(!key||!secret)throw Error('read-only WooCommerce credentials required');this.origin=u.origin;this.auth='Basic '+Buffer.from(key+':'+secret).toString('base64');this.fetcher=fetcher;this.pageSize=Math.min(50,Math.max(1,pageSize));this.catalogAdapter=catalogAdapter;}
 async page(kind,page,{parent='',after='',before='',descending=false}={}){
  if(!kinds.includes(kind)||!Number.isSafeInteger(page)||page<1)throw Error('invalid source request');
  if(parent&&!/^\d+$/.test(parent))throw Error('invalid parent identity');
  if((kind==='variations'||kind==='refunds')&&!parent)throw Error('parent required');
  const catalog=this.catalogAdapter&&['products','variations'].includes(kind);
  const path=catalog?'vesta-accounting/catalog':kind==='variations'?`products/${parent}/variations`:kind==='refunds'?`orders/${parent}/refunds`:kind==='categories'?'products/categories':kind;
  const u=new URL('/wp-json/wc/v3/'+path,this.origin);
  u.searchParams.set('page',String(page));u.searchParams.set('per_page',String(this.pageSize));u.searchParams.set('_fields',fields[kind]);
  if(catalog&&parent)u.searchParams.set('parent',parent);
  if(kind==='products'||kind==='orders'){u.searchParams.set('orderby','id');u.searchParams.set('order',descending?'desc':'asc');if(after)u.searchParams.set('modified_after',after);if(before)u.searchParams.set(after?'modified_before':'before',before);u.searchParams.set('dates_are_gmt','true');}
  if(['customers','categories','coupons'].includes(kind)){u.searchParams.set('orderby','id');u.searchParams.set('order',descending?'desc':'asc');}
  const r=await this.fetcher(u,{method:'GET',headers:{Authorization:this.auth,Accept:'application/json','User-Agent':'VestaAccounting-readonly/0.5'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('woo_http_'+r.status);
  const rows=await r.json();if(!Array.isArray(rows)||rows.length>this.pageSize)throw Error('invalid woo page');
  const ph=r.headers.get('X-WP-TotalPages'),th=r.headers.get('X-WP-Total'),pages=Number(ph),total=Number(th);
  if(ph===null||th===null||!Number.isSafeInteger(pages)||pages<0||!Number.isSafeInteger(total)||total<0)throw Error('pagination headers missing');
  return {rows,pages,total};
 }
}
export function verifyWebhook(secret,payload,signature){if(!secret||typeof signature!=='string')return false;try{const a=createHmac('sha256',secret).update(payload).digest(),b=Buffer.from(signature,'base64');return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}}
export async function acceptWebhook(pool,{secret,payload,signature,topic,deliveryId}){if(!verifyWebhook(secret,payload,signature))return false;const body=JSON.parse(payload.toString('utf8'));if(!Number.isSafeInteger(body.id)||body.id<=0||typeof topic!=='string'||topic.length>100||!deliveryId||deliveryId.length>150)return false;const fp=hash(payload),key=topic+':'+deliveryId;await pool.query('INSERT INTO sync_events(event_key,topic,fingerprint,source_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[key,topic,fp,String(body.id)]);const existing=(await pool.query('SELECT fingerprint FROM sync_events WHERE event_key=$1',[key])).rows[0];if(existing.fingerprint!==fp){await pool.query("UPDATE sync_events SET status='review' WHERE event_key=$1",[key]);return false;}await pool.query('UPDATE sync_control SET requested=true WHERE id=1');return true;}
export function sourceService(pool){return {
 createRevenueDraft(input,actor){return createRevenueDraft(pool,input,actor);},
 createRefundDraft(input,actor){return createRefundDraft(pool,input,actor);},
 recordSupplierPayment(input,actor){return recordSupplierPayment(pool,input,actor);},
 draftSupplierPayment(input,actor){return draftSupplierPayment(pool,input,actor);},
 recordPurchaseInvoice(input,actor){return recordPurchaseInvoice(pool,input,actor);},
 draftPurchaseInvoice(input,actor){return draftPurchaseInvoice(pool,input,actor);},
 recordExpenseEvidence(input,actor){return recordExpenseEvidence(pool,input,actor);},
 draftExpense(input,actor){return draftExpense(pool,input,actor);},
 recordInventoryCost(input,actor){return recordInventoryCost(pool,input,actor);},
 recordStockReconciliation(input,actor){return recordStockReconciliation(pool,input,actor);},
 recordOpeningBridge(input,actor){return recordOpeningBridge(pool,input,actor);},
 recordSettlement(input,actor){return recordSettlement(pool,input,actor);},
 draftSettlement(input,actor){return draftSettlement(pool,input,actor);},
 correctPurchaseCost(input,actor){return correctPurchaseCost(pool,input,actor);},
 async detail(kind,id,parent){if(!['orders','refunds'].includes(kind)||!/^\d{1,20}$/.test(id||'')||!(kind==='refunds'?/^\d{1,20}$/.test(parent||''):!parent))return null;
   const row=(await pool.query('SELECT r.payload FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id WHERE c.kind=$1 AND c.external_id=$2 AND c.parent_id=$3',[kind,id,parent||''])).rows[0]?.payload;
   if(!row)return null;const record=pick(row,['id','number','date_created_gmt','date_paid_gmt','date_completed_gmt','status','currency','customer_id','total','total_tax','discount_total','shipping_total','payment_method','payment_method_title','transaction_id','amount']);
   if(kind==='refunds'){const order=(await pool.query("SELECT r.payload->>'currency' AS currency FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id WHERE c.kind='orders' AND c.external_id=$1 AND c.parent_id=''",[parent])).rows[0];record.currency=order?.currency??null;}
   const parts=pick(row,['line_items','shipping_lines','coupon_lines','fee_lines','tax_lines','refunds']);return {record,parts};
 },
 async summary(){const rows=(await pool.query('SELECT kind,count(*) n FROM raw_current GROUP BY kind')).rows,counts=Object.fromEntries(rows.map(x=>[x.kind,Number(x.n)]));const s=(await pool.query('SELECT * FROM sync_control WHERE id=1')).rows[0];const e=(await pool.query("SELECT count(*) FILTER(WHERE status='pending') pending,count(*) FILTER(WHERE status='review') failed FROM sync_events")).rows[0];const progress=(await pool.query("SELECT count(*) FILTER(WHERE status='failed') failed, count(*) FILTER(WHERE status='complete') complete FROM sync_state")).rows[0];const cutover=(await pool.query('SELECT effective_at_utc,timezone,currency_unit,status,stock_snapshot_status FROM accounting_cutover WHERE id=1')).rows[0]||null;
 const capture=(await pool.query('SELECT cutover_at,observed_at,last_full_sync_at,verification_status FROM opening_capture WHERE id=1')).rows[0]||null;
 const reviewSource=capture?'opening_capture_items':'opening_live_review';
 const o=(await pool.query("SELECT COUNT(*) items,COUNT(*) FILTER(WHERE NULLIF(trim(sku),'') IS NULL) missing_sku,COUNT(*) FILTER(WHERE stock_quantity IS NULL) unknown_quantity,COUNT(*) FILTER(WHERE stock_quantity<0) negative_quantity,COUNT(*) FILTER(WHERE NULLIF(trim(price),'') IS NULL) missing_price,COUNT(*) FILTER(WHERE stock_status='instock' AND (stock_quantity IS NULL OR stock_quantity<=0)) status_conflicts,COUNT(*) FILTER(WHERE currency IS DISTINCT FROM 'IRT') currency_review FROM "+reviewSource)).rows[0];
 const opening={phase:capture?'frozen_unverified':'live_preview',cutover_at:cutover?.effective_at_utc||null,observed_at:capture?.observed_at||null,source_full_sync_at:capture?.last_full_sync_at||null,verification_status:capture?.verification_status||'not_captured',...Object.fromEntries(Object.entries(o).map(([k,v])=>[k,Number(v)]))};
 return {cutover,opening,products:counts.products||0,variations:counts.variations||0,orders:counts.orders||0,customers:counts.customers||0,refunds:counts.refunds||0,coupons:counts.coupons||0,categories:counts.categories||0,last_success:s.last_success,pending:Number(e.pending),failed:Number(e.failed)+Number(progress.failed),last_error:s.last_error,complete:Number(progress.complete)===kinds.length,initial_complete:Boolean(s.last_success),refresh_in_progress:Boolean(s.last_success)&&Number(progress.complete)!==kinds.length};},
 async retry(){await pool.query('UPDATE sync_control SET requested=true WHERE id=1');return {queued:true};},
 async list(module,url){if(module==='refund_review')return refundReviewList(pool,url);if(module==='supplier_payment_evidence')return supplierPaymentList(pool,url);if(module==='purchase_invoice_evidence')return purchaseInvoiceList(pool,url);if(module==='expense_evidence')return expenseEvidenceList(pool,url);if(module==='inventory_cost_evidence')return inventoryCostList(pool,url);if(module==='financial_readiness')return financialReadiness(pool);if(module==='opening_stock_reconciliation')return stockReconciliationList(pool,url);if(module==='opening_bridge')return openingBridgeList(pool);if(module==='sales_proposals')return salesProposalList(pool,url);if(module==='settlement_evidence')return settlementList(pool,url);if(module==='woo_reconciliation')return wooReconciliation(pool,url);
  if(openingReviewModules.includes(module))return reviewOpeningInput(pool,module,url);
  if(module==='opening_review'){
   const capture=(await pool.query('SELECT observed_at,last_full_sync_at,verification_status FROM opening_capture WHERE id=1')).rows[0]||null;
   const p=Math.max(0,Math.min(100000,Math.trunc(Number(url.searchParams.get('page')||0)||0)));
   const rows=(await pool.query('SELECT source_kind,external_id,parent_id,name,sku,stock_quantity,stock_status,manage_stock,price,currency,source_checked_at FROM '+(capture?'opening_capture_items':'opening_live_review')+' ORDER BY source_kind,external_id::bigint LIMIT 100 OFFSET $1',[p*100])).rows;
   return {phase:capture?'frozen_unverified':'live_preview',observed_at:capture?.observed_at||null,rows:rows.map(r=>{
     const issues=[];
     if(!r.sku?.trim())issues.push('SKU نامشخص');
     if(r.stock_quantity===null)issues.push('تعداد نامشخص');
     if(r.stock_quantity!==null&&r.stock_quantity<0)issues.push('تعداد منفی');
     if(r.stock_status==='instock'&&(r.stock_quantity===null||r.stock_quantity<=0))issues.push('مغایرت وضعیت موجودی');
     if(!r.price?.trim())issues.push('قیمت فروش نامشخص');
     if(r.currency!=='IRT')issues.push('واحد پول نیازمند بررسی');
     return {...r,display_sku:r.sku||'WC-'+r.source_kind+'-'+r.external_id,issues:issues.join('، ')||'—'};
   })};
  }if(module==='integration'){const s=await this.summary(),rows=[{source:'PostgreSQL',status:'فعال',details:'پایگاه داده عملیاتی مستقل'},{source:'واردات اولیه ووکامرس',status:s.initial_complete?'تکمیل‌شده':'در حال دریافت',details:s.last_success||'هنوز دور کامل ثبت نشده'},{source:'به‌روزرسانی‌های ووکامرس',status:s.last_error?'نیازمند بررسی':s.refresh_in_progress?'در حال دریافت تغییرات':s.initial_complete?'آخرین دور کامل':'در انتظار واردات اولیه',details:s.initial_complete?'واردات اولیه محفوظ است؛ به‌روزرسانی‌ها مستقل انجام می‌شوند':'داده‌های خام در حال دریافت هستند'},{source:'افتتاحیه موجودی',status:s.opening.phase==='live_preview'?'پیش‌نمایش؛ برداشت رسمی انجام نشده':'مدرک ذخیره‌شده؛ نیازمند تطبیق',details:new Intl.NumberFormat('fa-IR').format(s.opening.items)+' قلم · تعدادهای نامشخص '+new Intl.NumberFormat('fa-IR').format(s.opening.unknown_quantity)+' · بدون بهای خرید تأییدشده'},{source:'مبنای شروع حسابداری',status:s.cutover?.status==='planned'?'تاریخ ثبت‌شده؛ افتتاحیه در انتظار':s.cutover?.status||'تنظیم نشده',details:s.cutover?new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:s.cutover.timezone,year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s.cutover.effective_at_utc))+' · تهران · تومان':'تاریخ در دیتابیس ثبت نشده'},{source:'رویدادهای در انتظار',status:String(s.pending),details:'صف خام'},{source:'خطاهای ثبت‌شده',status:String(s.failed),details:s.last_error||'بدون خطای ثبت‌شده'},{source:'ثبت اسناد واقعی',status:'غیرفعال',details:'نیازمند افتتاحیه و تأیید مالک'}];const labels={products:'محصولات',variations:'تنوع‌ها',orders:'سفارش‌ها',customers:'مشتریان',refunds:'استردادها',coupons:'کوپن‌ها',categories:'دسته‌بندی‌ها'};for(const k of kinds)rows.push({source:labels[k],status:new Intl.NumberFormat('fa-IR').format(s[k]),details:'تعداد رکوردهای ذخیره‌شده در PostgreSQL'});return {rows};}const kind=module.replace('source_','');if(!kinds.includes(kind))return {rows:[]};const p=Math.max(0,Math.min(10000,Math.trunc(Number(url.searchParams.get('page')||0)||0)));const rows=(await pool.query('SELECT c.external_id,c.parent_id,c.modified,r.payload FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id WHERE c.kind=$1 ORDER BY c.external_id::bigint DESC LIMIT 100 OFFSET $2',[kind,p*100])).rows;return {rows:rows.map(r=>({...pick(r,['external_id','parent_id','modified']),...pick(r.payload,['name','sku','type','price','currency','stock_quantity','customer_id','total','payment_method','discount_total','shipping_total','total_tax','discount_type','amount','parent','slug','count','number']),order_status:r.payload.status,name:r.payload.name||r.payload.code||'',total:r.payload.total||r.payload.amount||null}))};}
};}
