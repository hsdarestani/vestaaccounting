import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import worker from '../edge-demo/worker.mjs';
import {seedDemo} from '../edge-demo/seed.mjs';
import {PgBinding,poolFromEnv} from './pg.mjs';
import {provision,authenticator,verifyPassword,passwordHash} from './auth.mjs';
import {WooSource,persistPage,acceptWebhook,sourceService,normalizeSource} from './source.mjs';
import {runCycle} from './sync.mjs';
const pool=poolFromEnv(),DB=new PgBinding(pool);
try{
 await pool.query(await readFile(new URL('001_runtime.sql',import.meta.url),'utf8'));
 if(!crypto.subtle.timingSafeEqual)Object.defineProperty(crypto.subtle,'timingSafeEqual',{value:(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b))});
 const username='synthetic-owner',password='Synthetic-CI-Only-Password-2026';assert.equal(await provision(pool,username,password),'created');assert.equal(await provision(pool,username,password),'preserved');assert.equal(await verifyPassword('wrong',await passwordHash(password)),false);
 const env={DB,MODE:'demo',IP_SALT:'synthetic-test-only',authenticate:authenticator(pool,{requireMfa:false}),integration:sourceService(pool)};
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
 const raw=Buffer.from(JSON.stringify({id:10})),secret='test-only-webhook',signature=createHmac('sha256',secret).update(raw).digest('base64');const event={secret,payload:raw,signature,topic:'product.updated',deliveryId:'synthetic-1'};assert.equal(await acceptWebhook(pool,event),true);assert.equal(await acceptWebhook(pool,event),true);assert.equal((await pool.query('SELECT count(*) n FROM sync_events')).rows[0].n,1);assert.equal(await acceptWebhook(pool,{...event,signature:'bad'}),false);
 const mock=(url,opts)=>{assert.equal(opts.method,'GET');const p=url.pathname.split('/').at(-1);const data={products:[{id:10,name:'Changed',type:'variable',sku:'SYN-10',date_modified_gmt:'2026-01-02T01:00:00',price:'12.00',variations:[11]}],orders:[{id:21,customer_id:8,currency:'IRR',total:'1230',status:'completed',date_modified_gmt:'2026-01-02T01:00:00',refunds:[{id:31}]}],customers:[{id:8,first_name:'Synthetic'}],variations:[{id:11,sku:'SYN-11',stock_quantity:6,price:'12.00'}],refunds:[{id:31,amount:'100'}],categories:[{id:4,name:'Sample'}],coupons:[{id:5,code:'DEMO',amount:'10'}]}[p]||[];return Promise.resolve(Response.json(data,{headers:{'X-WP-Total':String(data.length),'X-WP-TotalPages':data.length?'1':'0'}}));};
 const source=new WooSource({origin:'https://example.invalid/',key:'synthetic-key',secret:'synthetic-secret',fetcher:mock,pageSize:5});for(let i=0;i<12;i++){const result=await runCycle(pool,source,{budget:2,delay:0});assert.equal(result.failed,undefined);if(result.remaining===0)break;}const summary=await env.integration.summary();assert.ok(summary.complete);assert.equal(summary.orders,1);assert.equal(summary.variations,1);assert.equal(summary.refunds,1);assert.equal(summary.pending,0);
 env.MODE='source';const [sourceDashboard]=await request('/api/dashboard');assert.equal(sourceDashboard.posting_authorized,false);assert.equal(sourceDashboard.integration.orders,1);await request('/api/data/source_orders');await request('/api/operate','POST',{kind:'sale',ref:'SHOULD-NOT-POST'},403);await request('/api/logout','POST',{});await request('/api/dashboard','GET',null,401);
 assert.equal((await pool.query("SELECT COALESCE(SUM(debit-credit),0) n FROM lines l JOIN journals j ON j.id=l.journal WHERE j.status='posted'")).rows[0].n,0);
 console.log('PostgreSQL runtime acceptance complete:',checks,'HTTP assertions; immutable revisions, signed webhook replay, bounded sync and posting guard passed');
}finally{await pool.end();}
