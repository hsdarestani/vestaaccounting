import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import worker from '../edge-demo/worker.mjs';
import {seedDemo} from '../edge-demo/seed.mjs';
import {PgBinding,poolFromEnv} from './pg.mjs';
import {provision,authenticator,verifyPassword,passwordHash} from './auth.mjs';
import {WooSource,persistPage,acceptWebhook,sourceService,normalizeSource} from './source.mjs';
import {runCycle} from './sync.mjs';
import {captureOpening} from './opening.mjs';
import {repairRecentTail} from './tail-repair.mjs';
const pool=poolFromEnv(),DB=new PgBinding(pool);
try{
 await pool.query(await readFile(new URL('001_runtime.sql',import.meta.url),'utf8'));
 await pool.query(await readFile(new URL('002_cutover_plan.sql',import.meta.url),'utf8'));
 await pool.query(await readFile(new URL('003_opening_evidence.sql',import.meta.url),'utf8'));
 const openingMigration=await readFile(new URL('004_opening_input_review.sql',import.meta.url),'utf8');
 await pool.query(openingMigration);
 const plan=(await pool.query('SELECT * FROM accounting_cutover WHERE id=1')).rows[0];
 assert.equal(new Date(plan.effective_at_utc).toISOString(),'2026-11-23T20:30:00.000Z');
 assert.equal(plan.timezone,'Asia/Tehran');
 assert.equal(plan.currency_unit,'TOMAN');
 assert.equal(plan.status,'planned');
 assert.equal(plan.stock_snapshot_status,'not_captured');
 if(!crypto.subtle.timingSafeEqual)Object.defineProperty(crypto.subtle,'timingSafeEqual',{value:(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b))});
 const username='synthetic-owner',password='Synthetic-CI-Only-Password-2026';assert.equal(await provision(pool,username,password),'created');assert.equal(await provision(pool,username,password),'preserved');assert.equal(await verifyPassword('wrong',await passwordHash(password)),false);
 const env={DB,MODE:'demo',IP_SALT:'synthetic-test-only',authenticate:authenticator(pool),integration:sourceService(pool)};
 let cookie='',csrf='',checks=0;async function request(path,method='GET',body=null,status=200){const r=await worker.fetch(new Request('https://example.invalid'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})}),env);const value=await r.json();assert.equal(r.status,status,JSON.stringify({path,value}));checks++;return [value,r];}
 const [user,response]=await request('/api/login','POST',{username,password});cookie=response.headers.get('set-cookie').split(';')[0];csrf=user.csrf;const operate=async b=>(await request('/api/operate','POST',b,201))[0];
 await seedDemo(operate);const [dashboard]=await request('/api/dashboard');assert.equal(dashboard.products,8);const [scan]=await request('/api/operate','POST',{kind:'scan'},201);assert.equal(scan.inventory_equal,true);const [bs]=await request('/api/data/balance_sheet');assert.equal(bs.sums.asset-bs.sums.liability-bs.sums.equity-bs.net_profit,0);
 const [sales]=await request('/api/data/sales');await request('/api/details?type=documents&id='+sales.rows[0].id);const [products]=await request('/api/data/products');await request('/api/details?type=products&id='+products.rows[0].id);
 await request('/api/data/ledger?account=1010');await request('/api/data/cashflow');await request('/api/data/customers');await request('/api/data/suppliers');await request('/api/data/profitability');
 // One version may change, but previously captured evidence is immutable.
 await persistPage(pool,'products',[{id:10,name:'Synthetic',sku:'SYN-10',type:'variable',price:'10.00',date_modified_gmt:'2026-01-01T01:00:00',variations:[11]}]);
 await persistPage(pool,'products',[{id:10,name:'Synthetic',sku:'SYN-10',type:'variable',price:'10.00',date_modified_gmt:'2026-01-01T01:00:00',variations:[11]}]);
 await persistPage(pool,'products',[{id:10,name:'Changed',sku:'SYN-10',type:'variable',price:'12.00',date_modified_gmt:'2026-01-02T01:00:00',variations:[11]}]);
 assert.equal((await pool.query("SELECT count(*) n FROM raw_revisions WHERE kind='products'")).rows[0].n,2);assert.equal((await pool.query("SELECT count(*) n FROM raw_current WHERE kind='products'")).rows[0].n,1);await assert.rejects(()=>pool.query("UPDATE raw_revisions SET payload='{}'"),/immutable record/);
 const raw=Buffer.from(JSON.stringify({id:10})),secret='test-only-webhook',signature=createHmac('sha256',secret).update(raw).digest('base64');const event={secret,payload:raw,signature,topic:'product.updated',deliveryId:'synthetic-1'};assert.equal(await acceptWebhook(pool,event),true);assert.equal(await acceptWebhook(pool,event),true);assert.equal((await pool.query('SELECT count(*) n FROM sync_events')).rows[0].n,1);assert.equal(await acceptWebhook(pool,{...event,signature:'bad'}),false);const missing=Buffer.from(JSON.stringify({id:999}));assert.equal(await acceptWebhook(pool,{...event,payload:missing,signature:createHmac('sha256',secret).update(missing).digest('base64'),deliveryId:'synthetic-unseen'}),true);
 const mock=(url,opts)=>{assert.equal(opts.method,'GET');const p=url.pathname.split('/').at(-1);if(['categories','coupons'].includes(p)){assert.equal(url.searchParams.get('orderby'),'id');assert.equal(url.searchParams.get('order'),'asc');}const data={products:[{id:10,name:'Changed',type:'variable',sku:'SYN-10',date_modified_gmt:'2026-01-02T01:00:00',price:'12.00',variations:[11]}],orders:[{id:21,customer_id:8,currency:'IRR',total:'1230',status:'completed',date_modified_gmt:'2026-01-02T01:00:00',refunds:[{id:31}]}],customers:[{id:8,first_name:'Synthetic'}],variations:[{id:11,sku:'SYN-11',stock_quantity:6,stock_status:'instock',price:'12.00'}],refunds:[{id:31,amount:'100'}],categories:[{id:4,name:'Sample'}],coupons:[{id:5,code:'DEMO',amount:'10'}]}[p]||[];return Promise.resolve(Response.json(data,{headers:{'X-WP-Total':String(data.length),'X-WP-TotalPages':data.length?'1':'0'}}));};
 const source=new WooSource({origin:'https://example.invalid/',key:'synthetic-key',secret:'synthetic-secret',fetcher:mock,pageSize:5});for(let i=0;i<12;i++){const result=await runCycle(pool,source,{budget:2,delay:0});assert.equal(result.failed,undefined);if(result.remaining===0)break;}const summary=await env.integration.summary();assert.ok(summary.complete);assert.equal(summary.orders,1);assert.equal(summary.variations,1);assert.equal(summary.refunds,1);assert.equal(summary.pending,1);
 const openingPreview=(await pool.query('SELECT COUNT(*) n FROM opening_live_review')).rows[0].n;assert.equal(openingPreview,1);
 assert.equal((await captureOpening(pool,{observedAt:new Date('2026-11-23T20:29:59Z')})).due,false);
 const frozen=await captureOpening(pool,{observedAt:new Date('2026-11-23T20:30:01Z')});assert.equal(frozen.captured,true);assert.equal(frozen.unverified,true);
 assert.equal((await pool.query('SELECT COUNT(*) n FROM opening_capture_items')).rows[0].n,1);
 assert.equal((await captureOpening(pool,{observedAt:new Date('2026-11-23T20:30:02Z')})).already,true);
 await assert.rejects(()=>pool.query('DELETE FROM opening_capture_items'),/immutable record/);
 // A first-run category import with duplicate IDs must be automatically re-scanned.
 await pool.query("UPDATE sync_control SET last_success=NULL WHERE id=1");
 await pool.query("UPDATE sync_state SET expected_count=2 WHERE kind IN ('categories','customers')");
 await runCycle(pool,source,{budget:9,delay:0});
 assert.equal((await pool.query("SELECT status FROM sync_state WHERE kind='categories'")).rows[0].status,'complete');
 assert.equal((await pool.query("SELECT COUNT(*) n FROM raw_current WHERE kind='categories'")).rows[0].n,1);
 assert.equal((await pool.query("SELECT status FROM sync_state WHERE kind='customers'")).rows[0].status,'complete');
 assert.equal((await pool.query("SELECT expected_count FROM sync_state WHERE kind='customers'")).rows[0].expected_count,1);

 // An hour-old customer snapshot must refresh even when products/orders are not due.
 await pool.query("UPDATE sync_control SET last_success=now(),last_scan=now(),requested=false WHERE id=1");
 await pool.query("UPDATE sync_state SET last_success=now()");
 await pool.query("UPDATE sync_state SET last_success=now()-interval '2 hours' WHERE kind='customers'");
 const hourlyRefresh=await runCycle(pool,source,{budget:12,delay:0});
 assert.notEqual(hourlyRefresh.idle,true);
 assert.equal((await pool.query("SELECT status FROM sync_state WHERE kind='customers'")).rows[0].status,'complete');
 assert.equal((await pool.query("SELECT last_success>now()-interval '10 minutes' fresh FROM sync_state WHERE kind='customers'")).rows[0].fresh,true);
 // Verify that a long-running variation import cannot starve new orders.
 await pool.query("UPDATE sync_control SET last_success=now(),last_scan=now(),requested=false");
 await pool.query("UPDATE sync_state SET status='running' WHERE kind='variations'");
 await pool.query("UPDATE sync_state SET status='complete',last_success=now()-interval '10 minutes' WHERE kind='orders'");
 const independentOrderPoll=await runCycle(pool,source,{budget:9,delay:0});
 assert.equal(independentOrderPoll.failed,undefined);
 assert.equal((await pool.query("SELECT last_success>now()-interval '2 minutes' fresh FROM sync_state WHERE kind='orders'")).rows[0].fresh,true);
 await pool.query("UPDATE sync_state SET status='complete' WHERE kind='variations'");


 env.MODE='source';const [sourceDashboard]=await request('/api/dashboard');assert.equal(sourceDashboard.posting_authorized,false);assert.equal(sourceDashboard.integration.orders,1);assert.equal(sourceDashboard.integration.initial_complete,true);assert.equal(sourceDashboard.integration.cutover.status,'planned');assert.equal(sourceDashboard.integration.cutover.currency_unit,'TOMAN');assert.equal(sourceDashboard.integration.opening.phase,'frozen_unverified');assert.equal(sourceDashboard.integration.opening.items,1);const [openingRows]=await request('/api/data/opening_review');assert.equal(openingRows.rows.length,1);assert.equal(openingRows.phase,'frozen_unverified');assert.equal(sourceDashboard.integration.refresh_in_progress,false);await pool.query("UPDATE sync_state SET status='running' WHERE kind='variations'");const [duringRefresh]=await request('/api/dashboard');assert.equal(duringRefresh.integration.complete,false);assert.equal(duringRefresh.integration.initial_complete,true);assert.equal(duringRefresh.integration.refresh_in_progress,true);const [duringRefreshRows]=await request('/api/data/integration');assert.ok(duringRefreshRows.rows.some(r=>r.source==='واردات اولیه ووکامرس'&&r.status==='تکمیل‌شده'));assert.ok(duringRefreshRows.rows.some(r=>r.source==='به‌روزرسانی‌های ووکامرس'&&r.status==='در حال دریافت تغییرات'));await pool.query("UPDATE sync_state SET status='complete' WHERE kind='variations'");await request('/api/data/source_orders');const [orderDetail]=await request('/api/source-detail?kind=orders&id=21');assert.equal(orderDetail.record.total,'1230');const [refundDetail]=await request('/api/source-detail?kind=refunds&id=31&parent=21');assert.equal(refundDetail.record.currency,'IRR');await request('/api/source-detail?kind=customers&id=8','GET',null,404);await request('/api/operate','POST',{kind:'sale',ref:'SHOULD-NOT-POST'},403);
 await pool.query("INSERT INTO opening_input_costs_v1(external_id,unit_cost_toman,cost_status,priority_review,source_kind) VALUES(11,25,'estimate',true,'variations')");
 await pool.query("INSERT INTO opening_input_balances_v1 VALUES('2026-11-26','bank-7640','bank','Synthetic bank',123.45,'Synthetic evidence')");
 await pool.query(openingMigration);
 await pool.query(openingMigration);
 const [balanceEvidence]=await request('/api/data/opening_balances');
 assert.equal(balanceEvidence.rows[0].amount_toman,'123.45');
 assert.equal(balanceEvidence.rows[0].account,'1012');
 const [costEvidence]=await request('/api/data/opening_costs?id=11');
 assert.equal(costEvidence.rows[0].parent_id,'10');
 assert.equal(costEvidence.rows[0].identities,1);
 assert.equal(costEvidence.rows[0].priority_review,true);
 await assert.rejects(pool.query('UPDATE opening_input_costs_v1 SET unit_cost_toman=88 WHERE external_id=11'),/immutable record/);
 const [beforeReview]=await request('/api/data/opening_valuation');
 assert.equal(beforeReview.posting_authorized,false);
 assert.equal(beforeReview.rows[0].value_toman,'150');
 assert.equal(beforeReview.preview.find(r=>r.account==='3010').credit,'273.45');
 const corrected={kind:'purchase_cost_correct',external_id:11,revision:0,unit_cost_toman:33,reason:'Synthetic correction'};
 const [newCost]=await request('/api/operate','POST',corrected,201);
 await request('/api/operate','POST',corrected,409);
 const [updatedCosts]=await request('/api/data/opening_costs?id=11');
 assert.equal(updatedCosts.rows[0].unit_cost_toman,33);
 assert.equal(updatedCosts.rows[0].original_cost_toman,25);
 assert.equal(updatedCosts.rows[0].revision,newCost.revision);
 assert.equal(updatedCosts.rows[0].cost_status,'owner_entered');
 await persistPage(pool,'orders',[{id:567,currency:'IRR',total:'1234',status:'completed',
  payment_method:'synthetic_gateway',date_created_gmt:'2026-11-23T20:29:59',date_paid_gmt:'2026-11-23T20:30:01'}]);
 await persistPage(pool,'refunds',[{id:568,amount:'55',date_created_gmt:'2026-11-26T11:20:00'}],'567');
 const [bridge]=await request('/api/data/woo_reconciliation');
 assert.equal(bridge.rows.length,2);
 assert.equal(bridge.rows.find(r=>r.event_kind==='order_paid').amount_exact,'123.4');
 assert.equal(bridge.rows.find(r=>r.event_kind==='refund_created').amount_exact,'5.5');
 assert.equal(bridge.rows.find(r=>r.event_kind==='order_paid').local_date,'2026-11-24');
 const [afterReview]=await request('/api/data/opening_valuation?review_status=non_estimated_cost');
 assert.equal(afterReview.rows[0].value_toman,'198');
 assert.equal(afterReview.preview.find(r=>r.account==='3010').credit,'321.45');
await request('/api/logout','POST',{});await request('/api/dashboard','GET',null,401);
 assert.equal((await pool.query("SELECT COALESCE(SUM(debit-credit),0) n FROM lines l JOIN journals j ON j.id=l.journal WHERE j.status='posted'")).rows[0].n,0);

 // Repair a new Woo order in raw storage only, without posting a journal.
 const originalOrders=(await pool.query("SELECT COUNT(*) n FROM raw_current WHERE kind='orders'")).rows[0].n;
 const postedBeforeTail=(await pool.query("SELECT COUNT(*) n FROM journals WHERE status='posted'")).rows[0].n;
 const tailSource={page:async(kind,page,opts)=>{
  assert.equal(opts.descending,true);
  assert.equal(page,1);
  return kind==='orders'?{rows:[{id:555,number:'555',date_modified_gmt:'2026-11-23T06:55:00',currency:'IRT',total:'2500',status:'processing',customer_id:8}],pages:1,total:originalOrders+1}:{rows:[],pages:1,total:0};
 }};
 const firstTail=await repairRecentTail(pool,tailSource,{pages:1});
 assert.equal(firstTail[0].inserted,1);
 const secondTail=await repairRecentTail(pool,tailSource,{pages:1});
 assert.equal(secondTail[0].inserted,0);
 assert.equal((await pool.query("SELECT COUNT(*) n FROM raw_current WHERE kind='orders'")).rows[0].n,originalOrders+1);
 assert.equal((await pool.query("SELECT COUNT(*) n FROM journals WHERE status='posted'")).rows[0].n,postedBeforeTail);
 console.log('PostgreSQL runtime acceptance complete:',checks,'HTTP assertions; immutable revisions, signed webhook replay, bounded sync and posting guard passed');
}finally{await pool.end();}
