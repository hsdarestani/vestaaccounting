import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import assert from 'node:assert/strict';
import worker,{balanced,weightedCost} from './worker.mjs';
import {seedDemo} from './seed.mjs';

// Local test double of D1's binding; SQLite transactions and actual triggers.
// In addition, the deployed API is exercised separately against real D1.
const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');database.exec(readFileSync(new URL('001_schema.sql',import.meta.url),'utf8'));
if(!crypto.subtle.timingSafeEqual)Object.defineProperty(crypto.subtle,'timingSafeEqual',{value:(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b))});
class Prepared {constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Prepared(this.sql,args);}async all(){return {results:database.prepare(this.sql).all(...this.args)};}async first(){return (await this.all()).results[0]||null;}async run(){return database.prepare(this.sql).run(...this.args);}}
const DB={prepare:sql=>new Prepared(sql),async batch(stmts){database.exec('BEGIN');try{const r=[];for(const s of stmts){if(/^SELECT/i.test(s.sql))r.push(await s.all());else r.push(await s.run());}database.exec('COMMIT');return r;}catch(e){database.exec('ROLLBACK');throw e;}}};
const env={DB,DEMO_PASSWORD:'fake-test-secret',REVIEWER_PASSWORD:'fake-reviewer',IP_SALT:'fake-salt'};
let auth='',csrf='';let checks=0;
async function req(path,method='GET',body=null,expected=200){const r=await worker.fetch(new Request('https://demo.example'+path,{method,headers:{'Content-Type':'application/json',Cookie:auth,'X-CSRF-Token':csrf,'CF-Connecting-IP':'192.0.2.1'},...(body?{body:JSON.stringify(body)}:{})}),env);const j=await r.json();assert.equal(r.status,expected,JSON.stringify(j));checks++;return [j,r];}
const operate=async b=>(await req('/api/operate','POST',b,201))[0];
assert.equal(weightedCost(100,3,1),33);assert.equal(weightedCost(67,2,2),67);assert.throws(()=>weightedCost(100,3,4));assert.throws(()=>balanced([{account:'1010',debit:1,credit:0},{account:'3010',debit:0,credit:2}]));
await req('/api/dashboard','GET',null,401);await req('/api/login','POST',{username:'demo',password:'wrong'},401);
let [login,response]=await req('/api/login','POST',{username:'demo',password:env.DEMO_PASSWORD});auth=response.headers.get('Set-Cookie').split(';')[0];csrf=login.csrf;
const seed=await seedDemo(operate);assert.equal(seed.products,8);assert.equal(seed.sales,12);
for(const m of ['accounts','journals','ledger?account=1010','trial','periods','sales','products','inventory','movements','purchases','customers','suppliers','bank','gateways','payments','settlements','expenses','reconciliation','reports','balance_sheet','cashflow','profitability','opening','opening_refs','audit','users','settings','integration'])await req('/api/data/'+m);
const [dashboard]=await req('/api/dashboard');assert.equal(dashboard.products,8);assert.equal(dashboard.exceptions,4);assert.ok(dashboard.financial.net_profit!==0);
const sum=database.prepare("SELECT SUM(l.debit-l.credit) balance FROM lines l JOIN journals j ON l.journal=j.id WHERE j.status='posted'").get();assert.equal(sum.balance,0);
const inventory=database.prepare('SELECT SUM(value) n FROM products').get().n;assert.equal(inventory,dashboard.inventory);assert.equal(inventory,database.prepare("SELECT SUM(l.debit-l.credit) n FROM lines l JOIN journals j ON j.id=l.journal WHERE j.status='posted' AND account='1200'").get().n);
const scan=await operate({kind:'scan'});assert.equal(scan.issues,0);assert.equal(scan.inventory_equal,true);
const [bs]=await req('/api/data/balance_sheet');assert.equal(bs.sums.asset,bs.sums.liability+bs.sums.equity+bs.net_profit);
const [cash]=await req('/api/data/cashflow');assert.equal(cash.closing,dashboard.bank);
const sale=database.prepare("SELECT * FROM documents WHERE kind='sale' LIMIT 1").get();await req('/api/details?type=documents&id='+sale.id);const firstProd=database.prepare('SELECT * FROM products LIMIT 1').get();await req('/api/details?type=products&id='+firstProd.id);
const count=database.prepare('SELECT COUNT(*) n FROM journals').get().n;
await req('/api/operate','POST',{kind:'sale',ref:'DEMO-WC-100',date:'2026-11-22',party:sale.party,product:sale.product,quantity:1,subtotal:300000},409);assert.equal(database.prepare('SELECT COUNT(*) n FROM journals').get().n,count);
await req('/api/operate','POST',{kind:'sale',ref:'DEMO-TOO-LARGE',date:'2026-11-22',party:sale.party,product:sale.product,quantity:99999,subtotal:100000},422);
const j=database.prepare("SELECT id FROM journals WHERE status='posted' LIMIT 1").get();assert.throws(()=>database.prepare('UPDATE journals SET description=? WHERE id=?').run('changed',j.id));
const p=database.prepare('SELECT id FROM periods LIMIT 1').get();await operate({kind:'period_lock',id:p.id,locked:true,reason:'test'});await req('/api/operate','POST',{kind:'expense',date:'2026-11-22',ref:'LOCKED',amount:500,channel:'1010',account:'5090'},422);await operate({kind:'period_lock',id:p.id,locked:false,reason:'test'});
await req('/api/logout','POST',{});await req('/api/dashboard','GET',null,401);[login,response]=await req('/api/login','POST',{username:'reviewer',password:env.REVIEWER_PASSWORD});auth=response.headers.get('Set-Cookie').split(';')[0];csrf=login.csrf;await req('/api/dashboard');await req('/api/operate','POST',{kind:'customer',name:'Forbidden',ref:'NO'},403);
console.log('Edge evaluation checks:',checks,'HTTP assertions; ledger and inventory reconcile exactly.');
