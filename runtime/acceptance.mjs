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
 const settlementMigration=await readFile(new URL('005_gateway_settlement_evidence.sql',import.meta.url),'utf8');
 await pool.query(settlementMigration);
 const bridgeMigration=await readFile(new URL('006_opening_balance_bridge.sql',import.meta.url),'utf8');
 await pool.query(bridgeMigration);
 const stockMigration=await readFile(new URL('007_opening_stock_reconciliation.sql',import.meta.url),'utf8');
 await pool.query(stockMigration);
 const revenueMigration=await readFile(new URL('008_woo_revenue_drafts.sql',import.meta.url),'utf8');
 await pool.query(revenueMigration);
 const costMigration=await readFile(new URL('009_inventory_cost_evidence.sql',import.meta.url),'utf8');
 await pool.query(costMigration);
 const expenseMigration=await readFile(new URL('010_operating_expense_evidence.sql',import.meta.url),'utf8');
 await pool.query(expenseMigration);
 const purchaseMigration=await readFile(new URL('011_purchase_invoice_evidence.sql',import.meta.url),'utf8');
 await pool.query(purchaseMigration);
 const supplierPaymentMigration=await readFile(new URL('012_supplier_payment_evidence.sql',import.meta.url),'utf8');
 await pool.query(supplierPaymentMigration);
 const refundMigration=await readFile(new URL('013_refund_review.sql',import.meta.url),'utf8');
 await pool.query(refundMigration);
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
 // Indicative margin covers only fully identified, refund-free paid orders.
 await persistPage(pool,'products',[{id:12,type:'simple',name:'Synthetic simple',sku:'SYN-12'}]);
 await pool.query("INSERT INTO opening_input_costs_v1(external_id,unit_cost_toman,cost_status,priority_review,source_kind) VALUES(12,20,'estimate',true,'products')");
 const paidBase={currency:'IRT',status:'completed',date_paid_gmt:'2026-11-24T10:00:00',refunds:[]};
 await persistPage(pool,'orders',[
  {...paidBase,id:570,currency:'IRR',line_items:[{product_id:10,variation_id:11,quantity:2,total:'1005'}]},
  {...paidBase,id:571,line_items:[{product_id:12,variation_id:0,quantity:2,total:'70.25'}]},
  {...paidBase,id:572,line_items:[{product_id:999,variation_id:0,quantity:1,total:'90'}]},
  {...paidBase,id:573,refunds:[{id:574}],line_items:[{product_id:12,variation_id:0,quantity:1,total:'45'}]},
  {...paidBase,id:575,line_items:[{product_id:999,variation_id:11,quantity:1,total:'45'}]},
  {...paidBase,id:576,status:'cancelled',line_items:[{product_id:12,variation_id:0,quantity:1,total:'45'}]},
  {...paidBase,id:577,line_items:[{product_id:12,variation_id:0,quantity:1,total:'45'}]}
 ]);
 await persistPage(pool,'refunds',[{id:578,amount:'10',date_created_gmt:'2026-11-26T11:20:00'}],'577');
 const postedBeforeMargin=(await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n;
 const [margin]=await request('/api/data/woo_reconciliation');
 const day=margin.margin_review.filter(r=>r.local_date==='2026-11-24');
 const byStatus=Object.fromEntries(day.map(r=>[r.margin_status,r]));
 assert.equal(byStatus.non_estimated_reference.merchandise_net_toman,'100.5');
 assert.equal(byStatus.non_estimated_reference.reference_cost_toman,'66');
 assert.equal(byStatus.non_estimated_reference.indicative_margin_toman,'34.5');
 assert.equal(byStatus.estimated_reference.indicative_margin_toman,'30.25');
 assert.equal(byStatus.line_or_cost_review.count,2);
 assert.equal(byStatus.line_or_cost_review.indicative_margin_toman,null);
 assert.equal(byStatus.refund_review.count,2);
 assert.equal(byStatus.status_review.count,1);
 assert.equal((await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n,postedBeforeMargin);

  // Real financial writes remain blocked; settlement evidence is exact and draft creation is explicit.
 const settlement={kind:'settlement_evidence',gateway_account:'1310',bank_account:'1012',gateway_ref:'SYN-GW-1',bank_ref:'SYN-BANK-1',settlement_date:'2026-11-25',gross_toman:'110',net_toman:'100',fee_toman:'10',ledger_basis:'gross_unexpensed',evidence_note:'Synthetic paired provider and bank statements'};
 const [savedSettlement]=await request('/api/operate','POST',settlement,201);
 const [repeatedSettlement]=await request('/api/operate','POST',settlement,201);
 assert.equal(repeatedSettlement.id,savedSettlement.id);assert.equal(repeatedSettlement.duplicate,true);
 await request('/api/operate','POST',{...settlement,net_toman:'99'},400);
 await request('/api/operate','POST',{...settlement,gateway_ref:'SYN-GW-OTHER'},409);
 const [fractionalSettlement]=await request('/api/operate','POST',{...settlement,gateway_ref:'SYN-GW-2',bank_ref:'SYN-BANK-2',gross_toman:'11.25',net_toman:'10.10',fee_toman:'1.15'},201);
 const [settlementReport]=await request('/api/data/settlement_evidence');
 assert.equal(settlementReport.rows.length,2);assert.equal(settlementReport.summary[0].gross_toman,'121.25');assert.equal(settlementReport.summary[0].net_toman,'110.10');
 assert.equal(settlementReport.rows.find(r=>r.id===fractionalSettlement.id).settlement_status,'fractional_review');
 await request('/api/operate','POST',{kind:'settlement_draft',id:fractionalSettlement.id},409);
 await pool.query(`INSERT INTO periods(id,title,starts,ends) SELECT 'settlement-ci','Settlement CI','2026-11-25','2026-11-25'
 WHERE NOT EXISTS(SELECT 1 FROM periods WHERE date '2026-11-25' BETWEEN starts AND ends)`);
 const postedBeforeSettlement=(await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n;
 const [settlementDraft]=await request('/api/operate','POST',{kind:'settlement_draft',id:savedSettlement.id},201);
 const [repeatDraft]=await request('/api/operate','POST',{kind:'settlement_draft',id:savedSettlement.id},201);
 assert.equal(repeatDraft.id,settlementDraft.id);
 const journal=(await pool.query('SELECT status FROM journals WHERE id=$1',[settlementDraft.id])).rows[0];
 assert.equal(journal.status,'draft');
 const draftLines=(await pool.query('SELECT account,debit,credit FROM lines WHERE journal=$1 ORDER BY account',[settlementDraft.id])).rows;
 assert.deepEqual(draftLines,[{account:'1012',debit:100,credit:0},{account:'1310',debit:0,credit:110},{account:'5020',debit:10,credit:0}]);
 assert.equal((await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n,postedBeforeSettlement);
 await assert.rejects(pool.query("UPDATE gateway_settlement_evidence SET net_toman=1 WHERE id=$1",[savedSettlement.id]),/immutable record/);
 await pool.query(settlementMigration);
 const [updatedSettlementReport]=await request('/api/data/settlement_evidence');
 assert.equal(updatedSettlementReport.rows.find(r=>r.id===savedSettlement.id).settlement_status,'draft_created');
 const [netEvidence]=await request('/api/operate','POST',{...settlement,gateway_ref:'SYN-GW-NET',bank_ref:'SYN-BANK-NET',ledger_basis:'net_already_expensed'},201);
 const [netDraft]=await request('/api/operate','POST',{kind:'settlement_draft',id:netEvidence.id},201);
 assert.deepEqual((await pool.query('SELECT account,debit,credit FROM lines WHERE journal=$1 ORDER BY account',[netDraft.id])).rows,[{account:'1012',debit:100,credit:0},{account:'1310',debit:0,credit:100}]);
 const [unknownEvidence]=await request('/api/operate','POST',{...settlement,gateway_ref:'SYN-GW-UNKNOWN',bank_ref:'SYN-BANK-UNKNOWN',ledger_basis:'unknown'},201);
 await request('/api/operate','POST',{kind:'settlement_draft',id:unknownEvidence.id},409);
 // Operating expenses are independent of inventory and provider fees.
 await pool.query("INSERT INTO parties(id,kind,name,ref) VALUES('expense-ci-supplier','supplier','Synthetic expense supplier','EXPENSE-CI-SUPPLIER')");
 const expense={kind:'expense_evidence',expense_date:'2026-11-25',expense_account:'5040',funding_account:'1012',invoice_ref:'EXPENSE-CI-1',payment_ref:'EXPENSE-BANK-1',amount_toman:'125',description:'Synthetic operating expense'};
 await request('/api/operate','POST',{...expense,expense_account:'5020'},400);
 await request('/api/operate','POST',{...expense,payment_ref:'SYN-BANK-1'},409);
 const [paidExpense]=await request('/api/operate','POST',expense,201);
 const [duplicateExpense]=await request('/api/operate','POST',expense,201);
 assert.equal(duplicateExpense.id,paidExpense.id);assert.equal(duplicateExpense.duplicate,true);
 await request('/api/operate','POST',{...expense,amount_toman:'126'},409);
 await request('/api/operate','POST',{...settlement,gateway_ref:'SYN-GW-EXPENSE',bank_ref:'EXPENSE-BANK-1'},409);
 const [accruedExpense]=await request('/api/operate','POST',{...expense,expense_account:'5090',funding_account:'2010',supplier_id:'expense-ci-supplier',invoice_ref:'EXPENSE-CI-2',payment_ref:'',amount_toman:'45'},201);
 const [fractionalExpense]=await request('/api/operate','POST',{...expense,invoice_ref:'EXPENSE-CI-3',payment_ref:'EXPENSE-BANK-3',amount_toman:'5.75'},201);
 await request('/api/operate','POST',{kind:'expense_draft',id:fractionalExpense.id},409);
 const beforeExpensePosting=(await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n;
 const [paidDraft]=await request('/api/operate','POST',{kind:'expense_draft',id:paidExpense.id},201);
 const [paidDraftRepeat]=await request('/api/operate','POST',{kind:'expense_draft',id:paidExpense.id},201);
 assert.equal(paidDraftRepeat.id,paidDraft.id);
 assert.deepEqual((await pool.query('SELECT account,debit,credit FROM lines WHERE journal=$1 ORDER BY account',[paidDraft.id])).rows,[{account:'1012',debit:0,credit:125},{account:'5040',debit:125,credit:0}]);
 const [accruedDraft]=await request('/api/operate','POST',{kind:'expense_draft',id:accruedExpense.id},201);
 assert.deepEqual((await pool.query('SELECT account,detail,debit,credit FROM lines WHERE journal=$1 AND account=$2',[accruedDraft.id,'2010'])).rows,[{account:'2010',detail:'expense-ci-supplier',debit:0,credit:45}]);
 const [expenses]=await request('/api/data/expense_evidence?start=2026-11-25&end=2026-11-25');
 assert.equal(expenses.rows.length,3);assert.equal(expenses.posting_authorized,false);
 assert.equal(expenses.rows.find(r=>r.id===paidExpense.id).expense_status,'draft_created');
 assert.equal(expenses.rows.find(r=>r.id===fractionalExpense.id).amount_toman,'5.75');
 assert.equal((await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n,beforeExpensePosting);
 await assert.rejects(pool.query("UPDATE operating_expense_evidence SET amount_toman=0 WHERE id=$1",[paidExpense.id]),/immutable record/);
 await pool.query(expenseMigration);


 

 const purchaseEvidence={kind:'purchase_invoice_evidence',supplier_id:'expense-ci-supplier',invoice_ref:'PURCHASE-CI-1',received_tehran:'2026-11-25T10:00',total_toman:'150',evidence_note:'Synthetic received credit purchase',receipt_confirmed:true,credit_purchase_confirmed:true,items:[{source_kind:'variations',external_id:'11',parent_id:'10',quantity:3,value_toman:'150'}]};
 await request('/api/operate','POST',{...purchaseEvidence,receipt_confirmed:false},400);
 await request('/api/operate','POST',{...purchaseEvidence,total_toman:'151'},400);
 await request('/api/operate','POST',{...purchaseEvidence,items:[{...purchaseEvidence.items[0],parent_id:'999'}]},409);
 await request('/api/operate','POST',{...purchaseEvidence,invoice_ref:'EXPENSE-CI-2'},409);
 const [purchaseSaved]=await request('/api/operate','POST',purchaseEvidence,201);
 const [purchaseRepeat]=await request('/api/operate','POST',purchaseEvidence,201);
 assert.equal(purchaseRepeat.id,purchaseSaved.id);assert.equal(purchaseRepeat.duplicate,true);
 await request('/api/operate','POST',{...expense,invoice_ref:'PURCHASE-CI-1',payment_ref:'PURCHASE-AS-EXPENSE'},409);
 const [fractionalPurchase]=await request('/api/operate','POST',{...purchaseEvidence,invoice_ref:'PURCHASE-CI-2',total_toman:'150.25',items:[{source_kind:'products',external_id:'12',parent_id:'',quantity:3,value_toman:'150.25'}]},201);
 await request('/api/operate','POST',{kind:'purchase_invoice_draft',id:fractionalPurchase.id},409);
 const beforePurchasePosted=(await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n;
 const [purchaseDraft]=await request('/api/operate','POST',{kind:'purchase_invoice_draft',id:purchaseSaved.id},201);
 const [purchaseDraftRepeat]=await request('/api/operate','POST',{kind:'purchase_invoice_draft',id:purchaseSaved.id},201);
 assert.equal(purchaseDraftRepeat.id,purchaseDraft.id);
 assert.deepEqual((await pool.query('SELECT account,debit,credit FROM lines WHERE journal=$1 ORDER BY account',[purchaseDraft.id])).rows,[{account:'1200',debit:150,credit:0},{account:'2010',debit:0,credit:150}]);
 const [purchases]=await request('/api/data/purchase_invoice_evidence?start=2026-11-25&end=2026-11-25');
 assert.equal(purchases.rows.length,2);assert.equal(purchases.posting_authorized,false);
 assert.equal(purchases.rows.find(r=>r.id===purchaseSaved.id).purchase_status,'draft_created');
 assert.equal(purchases.summary[0].total_toman,'300.25');
 assert.equal((await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n,beforePurchasePosted);
 await assert.rejects(pool.query("UPDATE purchase_invoice_evidence SET total_toman=0 WHERE id=$1",[purchaseSaved.id]),/immutable record/);
 const supplierPayment={kind:'supplier_payment_evidence',purchase_id:purchaseSaved.id,payment_date:'2026-11-25',bank_account:'1012',payment_ref:'SUPPLIER-BANK-CI-1',amount_toman:'60',evidence_note:'Synthetic invoice payment receipt',allocation_confirmed:true};
 await request('/api/operate','POST',{...supplierPayment,allocation_confirmed:false},400);
 await request('/api/operate','POST',{...supplierPayment,payment_ref:'SYN-BANK-1'},409);
 await request('/api/operate','POST',{...supplierPayment,amount_toman:'151'},409);
 const [supplierPaymentSaved]=await request('/api/operate','POST',supplierPayment,201);
 const [supplierPaymentRepeat]=await request('/api/operate','POST',supplierPayment,201);
 assert.equal(supplierPaymentRepeat.id,supplierPaymentSaved.id);assert.equal(supplierPaymentRepeat.duplicate,true);
 await request('/api/operate','POST',{...supplierPayment,amount_toman:'61'},409);
 await request('/api/operate','POST',{...supplierPayment,payment_ref:'SUPPLIER-BANK-CI-OVER',amount_toman:'91'},409);
 await request('/api/operate','POST',{...expense,invoice_ref:'EXPENSE-AS-SUPPLIER-PAYMENT',payment_ref:supplierPayment.payment_ref},409);
 await request('/api/operate','POST',{...settlement,gateway_ref:'SYN-GW-SUPPLIER',bank_ref:supplierPayment.payment_ref},409);
 const [paymentReport]=await request('/api/data/supplier_payment_evidence?start=2026-11-25&end=2026-11-25');
 assert.equal(paymentReport.invoices.find(i=>i.id===purchaseSaved.id).outstanding_toman,'90.00');
 assert.equal(paymentReport.posting_authorized,false);
 const beforeSupplierPayment=(await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n;
 const [supplierPaymentDraft]=await request('/api/operate','POST',{kind:'supplier_payment_draft',id:supplierPaymentSaved.id},201);
 const [supplierPaymentDraftRepeat]=await request('/api/operate','POST',{kind:'supplier_payment_draft',id:supplierPaymentSaved.id},201);
 assert.equal(supplierPaymentDraftRepeat.id,supplierPaymentDraft.id);
 assert.deepEqual((await pool.query('SELECT account,debit,credit FROM lines WHERE journal=$1 ORDER BY account',[supplierPaymentDraft.id])).rows,[{account:'1012',debit:0,credit:60},{account:'2010',debit:60,credit:0}]);
 await request('/api/operate','POST',{...supplierPayment,payment_ref:'SUPPLIER-BANK-CI-2',amount_toman:'90'},201);
 const [fullyPaid]=await request('/api/data/supplier_payment_evidence');
 assert.equal(fullyPaid.invoices.some(i=>i.id===purchaseSaved.id),false);
 await request('/api/operate','POST',{...supplierPayment,payment_ref:'SUPPLIER-BANK-CI-EXTRA',amount_toman:'1'},409);
 assert.equal((await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n,beforeSupplierPayment);
 await assert.rejects(pool.query('DELETE FROM supplier_payment_evidence WHERE id=$1',[supplierPaymentSaved.id]),/immutable record/);
 await pool.query(supplierPaymentMigration);

 // Completed Woo sales yield balanced revenue proposals, not cash receipts or posted documents.
 const completed={id:580,currency:'IRT',status:'completed',date_created_gmt:'2026-11-24T09:00:00',date_paid_gmt:'2026-11-24T09:01:00',date_completed_gmt:'2026-11-25T09:00:00',total:'114.5',total_tax:'9.5',discount_total:'10',shipping_total:'5',shipping_tax:'0.5',refunds:[],fee_lines:[],shipping_lines:[{total:'5',total_tax:'0.5'}],line_items:[{id:1,product_id:10,variation_id:11,quantity:2,subtotal:'110',total:'100',total_tax:'9'}]};
 await persistPage(pool,'orders',[completed,{...completed,id:581,total:'115'},{...completed,id:582,status:'processing',date_completed_gmt:null},{...completed,id:583,currency:'IRR',total:'1145',total_tax:'95',discount_total:'100',shipping_total:'50',shipping_tax:'5',shipping_lines:[{total:'50',total_tax:'5'}],line_items:[{id:1,product_id:10,variation_id:11,quantity:2,subtotal:'1100',total:'1000',total_tax:'90'}]},{...completed,id:584,refunds:[{id:999}]},{...completed,id:585,line_items:[{id:1,product_id:999,variation_id:11,quantity:2,subtotal:'110',total:'100',total_tax:'9'}]}]);
 const journalCountBeforeProposal=(await pool.query('SELECT count(*) n FROM journals')).rows[0].n;
 const [proposalResult]=await request('/api/data/sales_proposals?start=2026-11-24&end=2026-11-26');
 const proposal=proposalResult.rows.find(r=>r.external_id==='580');
 assert.equal(proposal.status,'revenue_proposed');assert.equal(proposal.posting_authorized,false);
 assert.deepEqual(proposal.lines,[{account:'1100',debit:'114.5',credit:'0'},{account:'4010',debit:'0',credit:'110'},{account:'4030',debit:'10',credit:'0'},{account:'4020',debit:'0',credit:'5'},{account:'2100',debit:'0',credit:'9.5'}]);
 assert.equal(proposalResult.rows.find(r=>r.external_id==='581').reasons.includes('total_mismatch'),true);
 assert.equal(proposalResult.rows.find(r=>r.external_id==='582').reasons.includes('completion_review'),true);
 assert.deepEqual(proposalResult.rows.find(r=>r.external_id==='583').lines,proposal.lines);
 assert.equal(proposalResult.rows.find(r=>r.external_id==='584').reasons.includes('refund_review'),true);
 assert.equal(proposalResult.rows.find(r=>r.external_id==='585').reasons.includes('identity_review'),true);
 assert.equal((await pool.query('SELECT count(*) n FROM journals')).rows[0].n,journalCountBeforeProposal);
 const wholeOrder={...completed,id:586,total:'115',total_tax:'10',shipping_tax:'1',shipping_lines:[{total:'5',total_tax:'1'}]};
 await persistPage(pool,'orders',[wholeOrder]);
 const [wholeRows]=await request('/api/data/sales_proposals?id=586&start=2026-11-24&end=2026-11-26');
 const whole=wholeRows.rows[0];
 assert.equal(whole.draft_status,'draft_candidate');
 await request('/api/operate','POST',{kind:'woo_revenue_draft',external_id:'580',revision_id:proposal.revision_id},409);
 const beforeRevenuePosted=(await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n;
 const inputDraft={kind:'woo_revenue_draft',external_id:'586',revision_id:whole.revision_id};
 const [revenueDraft]=await request('/api/operate','POST',inputDraft,201);
 const [repeatedRevenue]=await request('/api/operate','POST',inputDraft,201);
 assert.equal(revenueDraft.ref,'woo-revenue:586');assert.equal(repeatedRevenue.duplicate,true);
 const revenueJournal=(await pool.query('SELECT id,status FROM journals WHERE ref=$1',[revenueDraft.ref])).rows[0];
 assert.equal(revenueJournal.status,'draft');
 const revenueLines=(await pool.query('SELECT account,debit,credit FROM lines WHERE journal=$1 ORDER BY account',[revenueJournal.id])).rows;
 assert.equal(revenueLines.reduce((sum,l)=>sum+l.debit-l.credit,0),0);
 assert.equal(revenueLines.find(l=>l.account==='1100').debit,115);
 assert.equal((await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n,beforeRevenuePosted);
 await persistPage(pool,'refunds',[{id:587,amount:'5',date_created_gmt:'2026-11-26T11:30:00'}],'586');
 const [staleRevenue]=await request('/api/data/sales_proposals?id=586&start=2026-11-24&end=2026-11-26');
 assert.equal(staleRevenue.rows[0].draft_status,'draft_stale');
 // Merchandise refunds require full refund evidence and an unchanged original revenue draft.
 const returnOrder={...wholeOrder,id:590,total:'110',total_tax:'10',shipping_total:'0',shipping_tax:'0',shipping_lines:[],line_items:[{...wholeOrder.line_items[0],total_tax:'10'}]};
 await persistPage(pool,'orders',[returnOrder]);
 const [originalReturnSale]=await request('/api/data/sales_proposals?id=590&start=2026-11-24&end=2026-11-26');
 await request('/api/operate','POST',{kind:'woo_revenue_draft',external_id:'590',revision_id:originalReturnSale.rows[0].revision_id},201);
 const partRefund={id:591,amount:'55',date_created_gmt:'2026-11-25T10:30:00',line_items:[{id:91,product_id:10,variation_id:11,quantity:-1,total:'-50',total_tax:'-5'}]};
 await persistPage(pool,'orders',[{...returnOrder,refunds:[{id:591,total:'-55'}]}]);
 await persistPage(pool,'refunds',[partRefund],'590');
 const [partialReview]=await request('/api/data/refund_review?id=591');
 const partial=partialReview.rows[0];
 assert.equal(partial.refund_extent,'partial_cumulative');assert.equal(partial.draft_status,'receivable_reversal_candidate');
 assert.deepEqual(partial.lines,[{account:'4040',debit:'50',credit:'0'},{account:'2100',debit:'5',credit:'0'},{account:'1100',debit:'0',credit:'55'}]);
 const refundInput={kind:'woo_refund_draft',order_id:'590',refund_id:'591',revision_id:partial.revision_id,uncollected_receivable_confirmed:true};
 await request('/api/operate','POST',{...refundInput,uncollected_receivable_confirmed:false},400);
 const postedBeforeRefund=(await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n;
 const [refundDraft]=await request('/api/operate','POST',refundInput,201);
 const [repeatRefundDraft]=await request('/api/operate','POST',refundInput,201);
 assert.equal(repeatRefundDraft.id,refundDraft.id);assert.equal(repeatRefundDraft.duplicate,true);
 assert.deepEqual((await pool.query('SELECT account,debit,credit FROM lines WHERE journal=$1 ORDER BY account',[refundDraft.id])).rows,[{account:'1100',debit:0,credit:55},{account:'2100',debit:5,credit:0},{account:'4040',debit:50,credit:0}]);
 await persistPage(pool,'orders',[{...returnOrder,status:'refunded',refunds:[{id:591},{id:592}]}]);
 const [missingRefund]=await request('/api/data/refund_review?id=591');
 assert.equal(missingRefund.rows[0].draft_status,'draft_stale');assert.ok(missingRefund.rows[0].reasons.includes('refund_set_review'));
 await persistPage(pool,'refunds',[{...partRefund,id:592}],'590');
 const [fullRefund]=await request('/api/data/refund_review?id=592');
 assert.equal(fullRefund.rows[0].refund_extent,'full_cumulative');assert.equal(fullRefund.rows[0].draft_status,'receivable_reversal_candidate');
 await persistPage(pool,'orders',[{...returnOrder,status:'refunded',refunds:[{id:591},{id:592},{id:593}]}]);
 await persistPage(pool,'refunds',[{...partRefund,id:593}],'590');
 const [overRefund]=await request('/api/data/refund_review?id=593');
 assert.ok(overRefund.rows[0].reasons.includes('over_refund'));assert.equal(overRefund.rows[0].status,'review_required');
 await request('/api/operate','POST',{...refundInput,refund_id:'593',revision_id:overRefund.rows[0].revision_id},409);
 assert.equal((await pool.query("SELECT count(*) n FROM journals WHERE status='posted'")).rows[0].n,postedBeforeRefund);
 await pool.query(refundMigration);

 await request('/api/operate','POST',inputDraft,409);
 
  
 const openingBridge={kind:'opening_bridge',line_key:'bank-7640',evidence_date:'2026-11-26',observed_time:'10:30',increases_toman:'30.10',decreases_toman:'5.05',reference:'Synthetic complete statements',coverage_confirmed:true};
 await request('/api/operate','POST',{...openingBridge,coverage_confirmed:false},400);
 const [bridgeSaved]=await request('/api/operate','POST',openingBridge,201);
 const [bridgeRepeat]=await request('/api/operate','POST',openingBridge,201);
 assert.equal(bridgeRepeat.revision,bridgeSaved.revision);assert.equal(bridgeRepeat.duplicate,true);
 const [bridgeRows]=await request('/api/data/opening_bridge');
 const bridgeRow=bridgeRows.rows.find(r=>r.line_key==='bank-7640');
 assert.equal(bridgeRow.opening_toman,'98.40');assert.equal(bridgeRow.bridge_status,'bridge_proposed');assert.equal(bridgeRows.posting_authorized,false);
 await assert.rejects(pool.query('UPDATE opening_balance_bridge_evidence SET increases_toman=0 WHERE id=$1',[bridgeSaved.revision]),/immutable record/);
 const [negativeBridge]=await request('/api/operate','POST',{...openingBridge,increases_toman:'200',reference:'Synthetic revised statement'},201);
 assert.notEqual(negativeBridge.revision,bridgeSaved.revision);
 const [updatedBridge]=await request('/api/data/opening_bridge');
 assert.equal(updatedBridge.rows.find(r=>r.line_key==='bank-7640').bridge_status,'negative_review');
 await pool.query(bridgeMigration);
 
 const stockEvidence={kind:'opening_stock_reconciliation',source_kind:'variations',external_id:'11',parent_id:'10',observed_tehran:'2026-11-26T10:30',observed_quantity:7,received_quantity:3,issued_quantity:2,reference:'Synthetic physical count and complete movement log',coverage_confirmed:true};
 await request('/api/operate','POST',{...stockEvidence,coverage_confirmed:false},400);
 const [stockSaved]=await request('/api/operate','POST',stockEvidence,201);
 const [stockRepeat]=await request('/api/operate','POST',stockEvidence,201);
 assert.equal(stockRepeat.revision,stockSaved.revision);assert.equal(stockRepeat.duplicate,true);
 await request('/api/operate','POST',{...stockEvidence,parent_id:'999'},404);
 const [stockReview]=await request('/api/data/opening_stock_reconciliation?id=11');
 assert.equal(stockReview.rows[0].opening_quantity,6);assert.equal(stockReview.rows[0].value_toman,'198');assert.equal(stockReview.posting_authorized,false);
 await assert.rejects(pool.query('UPDATE opening_stock_reconciliation SET observed_quantity=0 WHERE id=$1',[stockSaved.revision]),/immutable record/);
 const [negativeStock]=await request('/api/operate','POST',{...stockEvidence,received_quantity:20,reference:'Synthetic revised movements'},201);
 assert.notEqual(negativeStock.revision,stockSaved.revision);
 const [stockIssues]=await request('/api/data/opening_stock_reconciliation?review_status=negative_review');
 assert.equal(stockIssues.rows[0].external_id,'11');assert.equal(stockIssues.rows[0].value_toman,null);
 await pool.query(stockMigration);
 
 const [notReady]=await request('/api/data/financial_readiness');
 assert.equal(notReady.posting_authorized,false);
 assert.equal(notReady.preview_is_partial,true);
 assert.equal(notReady.coverage.balance_negative,1);
 assert.equal(notReady.coverage.stock_negative,1);
 assert.equal(notReady.rows.find(r=>r.key==='posting_gate').status,'required');
 assert.equal(notReady.preview.length,0);
 await request('/api/operate','POST',openingBridge,201);
 await request('/api/operate','POST',stockEvidence,201);
 const [readiness]=await request('/api/data/financial_readiness');
 assert.equal(readiness.coverage.balance_missing,0);
 assert.equal(readiness.coverage.balance_fractional,1);
 assert.equal(readiness.coverage.stock_evidence_missing,0);
 assert.equal(readiness.rows.find(r=>r.key==='ledger_precision').status,'required');
 assert.equal(readiness.preview.find(r=>r.account==='1012').debit,'98.40');
 assert.equal(readiness.preview.find(r=>r.account==='1200').debit,'198');
 assert.equal(readiness.preview.find(r=>r.account==='3010').credit,'296.40');
 assert.equal(readiness.posting_authorized,false);
 
 const inventoryEvidence={kind:'inventory_cost_evidence',source_kind:'variations',external_id:'11',parent_id:'10',reference:'Synthetic chronological receipts and issues',coverage_confirmed:true,events:[
  {at:'2026-11-24T09:00:00Z',kind:'purchase',ref:'IN-COST-1',quantity:3,value_toman:'150'},
  {at:'2026-11-25T09:00:00Z',kind:'sale',ref:'OUT-COST-1',quantity:2,value_toman:''}
 ]};
 await request('/api/operate','POST',{...inventoryEvidence,coverage_confirmed:false},400);
 await request('/api/operate','POST',{...inventoryEvidence,events:[]},409);
 const [costEvidenceSaved]=await request('/api/operate','POST',inventoryEvidence,201);
 assert.equal(costEvidenceSaved.result.sales_cogs_toman,'77');
 assert.equal(costEvidenceSaved.result.ending_value_toman,'271');
 assert.equal(costEvidenceSaved.result.ending_quantity,'7');
 assert.equal(costEvidenceSaved.result.posting_authorized,false);
 const [repeatCostEvidence]=await request('/api/operate','POST',inventoryEvidence,201);
 assert.equal(repeatCostEvidence.id,costEvidenceSaved.id);assert.equal(repeatCostEvidence.duplicate,true);
 const [historyCost]=await request('/api/data/inventory_cost_evidence?id=11');
 assert.equal(historyCost.rows[0].cost_review_status,'calculated_review');
 assert.equal(historyCost.rows[0].sales_cogs_toman,'77');
 const linkedCost={...inventoryEvidence,use_registered_purchases:true,events:inventoryEvidence.events.filter(e=>e.kind!=='purchase'),reference:'Synthetic linked purchase invoice and sale evidence'};
 await request('/api/operate','POST',{...inventoryEvidence,use_registered_purchases:true},400);
 const [linked]=await request('/api/operate','POST',linkedCost,201);
 assert.equal(linked.result.sales_cogs_toman,'77');assert.equal(linked.result.ending_value_toman,'271');
 assert.equal(linked.result.rows.find(r=>r.kind==='purchase').ref,'purchase:'+purchaseSaved.id);
 const [linkedRepeat]=await request('/api/operate','POST',linkedCost,201);
 assert.equal(linkedRepeat.id,linked.id);assert.equal(linkedRepeat.duplicate,true);
 const [currentLinked]=await request('/api/data/inventory_cost_evidence?id=11');
 assert.equal(currentLinked.rows[0].cost_review_status,'calculated_review');
 await request('/api/operate','POST',{...purchaseEvidence,invoice_ref:'PURCHASE-CI-LATE',received_tehran:'2026-11-25T12:00',total_toman:'20.25',items:[{...purchaseEvidence.items[0],quantity:1,value_toman:'20.25'}]},201);
 const [staleLinked]=await request('/api/data/inventory_cost_evidence?id=11');
 assert.equal(staleLinked.rows[0].cost_review_status,'stale_evidence');
 await request('/api/operate','POST',linkedCost,409);

 await assert.rejects(pool.query("UPDATE inventory_cost_evidence SET actor='changed' WHERE id=$1",[costEvidenceSaved.id]),/immutable record/);
 await pool.query(costMigration);
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
