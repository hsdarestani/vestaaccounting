import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = 'https://hesab.vesta-cosmetics.ir';
const out = resolve(process.env.BROWSER_OUTPUT || 'browser-output');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox']});
let phase='page';
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  let jsErrors=0;
  page.on('pageerror',()=>{jsErrors++;});
  const root=await page.goto(url+'/',{waitUntil:'networkidle',timeout:45000});
  assert.equal(root.status(),200);assert.equal(new URL(page.url()).origin,url);
  assert.ok(root.headers()['strict-transport-security']);
  const health=await (await page.request.get(url+'/health',{maxRedirects:0})).json();
  assert.equal(health.database,'postgresql');assert.equal(health.mode,'source');
  assert.equal(health.store_writes,false);assert.equal(health.posting_authorized,false);
  if(process.env.EXPECT_RELEASE)assert.equal(health.version,process.env.EXPECT_RELEASE);
  console.log('browser_public_release='+health.version);
  assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
  assert.equal(await page.locator('input[name=otp]').count(),0);
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(font=>document.fonts.check('16px '+font),health.font),true);
  await page.screenshot({path:out+'/vesta-login-desktop.png',animations:'disabled'});
  phase='auth';
  assert.ok(process.env.ADMIN&&process.env.PASS);
  await page.locator('input[name=username]').fill(process.env.ADMIN);
  await page.locator('input[name=password]').fill(process.env.PASS);
  await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#app .dashboard-welcome').waitFor({state:'visible',timeout:24000});
  const me=await page.request.get(url+'/api/me');
  assert.equal(me.status(),200);assert.equal((await me.json()).role,'owner');
  const cookie=(await page.context().cookies()).find(x=>x.name==='__Host-vesta');
  assert.ok(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Strict');
  assert.equal((await page.request.post(url+'/api/logout',{data:{}})).status(),403);
  const dashboard=(await (await page.request.get(url+'/api/dashboard')).json()).integration;
  assert.ok(dashboard&&typeof dashboard.complete==='boolean');
  console.log('private_woo_sync_health='+JSON.stringify({
    has_imported_catalog:dashboard.products>0,has_imported_orders:dashboard.orders>0,
    has_imported_variations:dashboard.variations>0,has_imported_customers:dashboard.customers>0,
    has_imported_refunds:dashboard.refunds>0,has_imported_categories:dashboard.categories>0,
    completed_first_cycle:!!dashboard.last_success,current_cycle_complete:dashboard.complete,
    has_source_error:!!dashboard.last_error,
    source_error:/^(woo_http_\d{3}|sync_failed|read_only_credentials_missing|catalog_empty|count_changed|source_timeout|pagination_headers_missing|invalid_source_page|invalid_source_identity)$/.test(dashboard.last_error||'')?dashboard.last_error:null
  }));
  phase='dashboard-image';
  // Browser artifacts must remain safe to share: mask every private metric,
  // identity and record. Individual order/customer data is not photographed.
  const mask=page.locator('#userName, #content .card strong, #content .sync-item b, #content tbody, #content .chart');
  await page.screenshot({path:out+'/vesta-dashboard-redacted.png',animations:'disabled',mask:[mask],maskColor:'#f3d9e7'});
  const controls=await page.locator('#nav button[data-view]').evaluateAll(nodes=>nodes.map(m=>m.dataset.view));
  assert.equal(await page.locator('#nav > details').count(),9);
  assert.equal(await page.locator('#nav > details[open]').count(),0);
  assert.equal(await page.locator('#content .quick-actions button').count(),9);
  await page.getByRole('button',{name:'این هفته',exact:true}).click();
  await page.locator('#content .dashboard-welcome').waitFor();
  for(const view of controls){
    assert.match(view,/^[a-z_]+$/);
    phase='view_'+view;
    const navButton=page.locator(`#nav [data-view="${view}"]`);
    await navButton.evaluate(btn=>{for(let p=btn.parentElement;p&&p.id!=='nav';p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
    await navButton.click();
    await page.waitForFunction(()=>document.querySelector('#content .panel')||document.querySelector('#content .dashboard-welcome'),null,{timeout:16000});
    assert.equal(await page.locator('#content .error').count(),0,'screen '+view);
    if(view==='opening_costs'){
      const costs=await page.request.get(url+'/api/data/opening_costs');
      assert.equal(costs.status(),200);
      assert.ok((await costs.json()).rows.length>0);
      await page.getByRole('button',{name:'اصلاح قیمت',exact:true}).first().click();
      await page.locator('#detail:not([hidden]) input[type=number]').waitFor({state:'visible'});
      await page.locator('#closeDrawer').click();
    }
    if(view==='opening_balances'){
      const evidence=await page.request.get(url+'/api/data/opening_balances');
      assert.equal(evidence.status(),200);
      const {rows}=await evidence.json();
      assert.equal(rows.length,12);
      assert.equal(rows.filter(r=>r.account_kind==='supplier_payable'&&r.party).length,3);
      assert.equal(rows.filter(r=>r.account_kind==='gateway'&&r.rules).length,5);
      assert.equal(await page.locator('#content tbody tr').count(),12);
    }
    if(view==='opening_valuation'){
      const result=await page.request.get(url+'/api/data/opening_valuation');
      assert.equal(result.status(),200);
      const valuation=await result.json();
      assert.equal(valuation.posting_authorized,false);
      assert.equal(valuation.status,'review');
      assert.ok(valuation.capture&&valuation.preview.length>0);
      const units=v=>{const [whole,fraction='']=v.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));};
      assert.equal(valuation.preview.reduce((sum,line)=>sum+units(line.debit)-units(line.credit),0n),0n);
      await page.getByRole('heading',{name:'پیش‌نویس تطبیق افتتاحیه',exact:true}).waitFor();
      console.log('browser_opening_costs_balances_and_balanced_review_verified=true');
      console.log('opening_stock_row_counts='+JSON.stringify(Object.fromEntries(valuation.counts.map(row=>[row.review_status,row.count]))));
      console.log('opening_woo_activity_review='+JSON.stringify(valuation.activity));
    }
    if(view==='settlement_evidence'){
      const response=await page.request.get(url+'/api/data/settlement_evidence');
      assert.equal(response.status(),200);const evidence=await response.json();
      assert.ok(Array.isArray(evidence.rows)&&Array.isArray(evidence.summary));
      await page.getByRole('button',{name:'ثبت مدرک تسویه',exact:true}).waitFor();
      console.log('browser_settlement_evidence_verified=true');
    }
    if(view==='sales_proposals'){
      const response=await page.request.get(url+'/api/data/sales_proposals');
      assert.equal(response.status(),200);const evidence=await response.json();
      assert.equal(evidence.posting_authorized,false);
      assert.ok(Array.isArray(evidence.rows));
      await page.getByRole('heading',{name:'پیشنهاد خودکار اسناد فروش',exact:true}).waitFor();
      console.log('browser_sales_proposals_verified=true');
    }
    if(view==='opening_bridge'){
      const response=await page.request.get(url+'/api/data/opening_bridge');
      assert.equal(response.status(),200);const evidence=await response.json();
      assert.equal(evidence.posting_authorized,false);assert.equal(evidence.rows.length,12);
      await page.getByRole('button',{name:'ثبت مدرک تطبیق',exact:true}).waitFor();
      console.log('browser_opening_balance_bridge_verified=true');
    }
    if(view==='opening_stock_reconciliation'){
      const response=await page.request.get(url+'/api/data/opening_stock_reconciliation');
      assert.equal(response.status(),200);const evidence=await response.json();
      assert.equal(evidence.posting_authorized,false);assert.ok(evidence.capture&&evidence.rows.length>0);
      await page.getByRole('button',{name:'ثبت مدرک موجودی',exact:true}).waitFor();
      console.log('browser_opening_stock_reconciliation_verified=true');
      const template=await page.request.get(url+'/api/opening-stock-template');assert.equal(template.status(),200);assert.ok(Array.isArray((await template.json()).rows));
      const download=page.waitForEvent('download');await page.getByRole('button',{name:'دانلود قالب Excel (CSV)',exact:true}).click();
      const csvFile=await download;assert.equal(csvFile.suggestedFilename(),'vesta-opening-stock-template.csv');
      assert.ok((await readFile(await csvFile.path(),'utf8')).includes('شمارش واقعی'));
      assert.equal(await page.getByRole('button',{name:'ثبت گروهی مدارک',exact:true}).isDisabled(),true);
    }
    if(view==='financial_readiness'){
      const response=await page.request.get(url+'/api/data/financial_readiness');
      assert.equal(response.status(),200);const evidence=await response.json();
      assert.equal(evidence.posting_authorized,false);assert.equal(evidence.preview_is_partial,true);
      assert.ok(evidence.coverage.imported_costs>0&&evidence.coverage.stock_total>0);
      const units=v=>{const [whole,fraction='']=v.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));};
      assert.equal(evidence.preview.reduce((sum,row)=>sum+units(row.debit)-units(row.credit),0n),0n);
      await page.getByRole('heading',{name:'وضعیت واقعی دفتر مالی',exact:true}).waitFor();
      console.log('browser_financial_readiness_verified=true');
      console.log('financial_readiness_counts='+JSON.stringify(evidence.coverage));
    }
    if(['inventory_cost_evidence','expense_evidence','purchase_invoice_evidence','supplier_payment_evidence','refund_review'].includes(view)){
      const response=await page.request.get(url+'/api/data/'+view);
      assert.equal(response.status(),200);const evidence=await response.json();
      assert.equal(evidence.posting_authorized,false);assert.ok(Array.isArray(evidence.rows));
      const labels={inventory_cost_evidence:'محاسبه بهای تاریخی',expense_evidence:'ثبت مدرک هزینه',purchase_invoice_evidence:'ثبت مدرک فاکتور خرید',supplier_payment_evidence:'ثبت مدرک پرداخت خرید'};
      if(labels[view])await page.getByRole('button',{name:labels[view],exact:true}).waitFor();
      if(view==='purchase_invoice_evidence'){
        assert.equal(await page.locator('#content input[name=external_id]').count(),0);
        await page.getByRole('button',{name:'جستجو',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('select[aria-label="انتخاب کالا"] option[value="0"]'));
        await page.getByLabel('انتخاب کالا',{exact:true}).selectOption('0');
        await page.locator('#content input[name=value_toman]').fill('۱۲٬۳۴۵٫۵۰');
        assert.equal(await page.locator('#content input[name=total_toman]').inputValue(),'12345.50');
      }
      if(view==='expense_evidence'){
        assert.ok(evidence.categories.length>=17);
        await page.locator('select[name=funding_account]').selectOption('2010');
        assert.equal(await page.locator('select[name=supplier_id]').getAttribute('required'),'');
        assert.equal(await page.locator('input[name=payment_ref]').isVisible(),false);
        await page.getByText('مدیریت دسته‌های هزینه',{exact:true}).click();
        await page.getByRole('button',{name:'ذخیره دسته هزینه',exact:true}).waitFor();
      }
      if(view==='refund_review')await page.getByRole('heading',{name:'بررسی استرداد کامل و جزئی',exact:true}).waitFor();
      console.log('browser_'+view+'_verified=true');
    }
    if(view==='woo_reconciliation'){
      const activity=await page.request.get(url+'/api/data/woo_reconciliation');
      assert.equal(activity.status(),200);
      const evidence=await activity.json();
      assert.ok(evidence.summary.some(row=>row.event_kind==='order_created'&&row.count>0));
      assert.ok(evidence.summary.some(row=>row.event_kind==='order_paid'&&row.count>0));
      await page.getByRole('button',{name:'اعمال تاریخ',exact:true}).waitFor();
      const download=page.waitForEvent('download');
      await page.getByRole('button',{name:'Excel جمع گردش',exact:true}).click();
      const file=await download;
      assert.match(file.suggestedFilename(),/\.xlsx$/);
      const buffer=await readFile(await file.path());
      assert.equal(buffer.readUInt32LE(),0x04034b50);
      console.log('browser_woo_reconciliation_and_excel_verified=true');
      console.log('woo_reconciliation_review_counts='+JSON.stringify(evidence.summary.reduce((counts,row)=>{
        counts[row.event_kind]=(counts[row.event_kind]||0)+row.count;return counts;
      },{})));
    }
    if(view==='source_orders'&&controls.includes('source_categories')&&dashboard.orders>0){
      await page.locator('#content button').filter({hasText:'جزئیات'}).first().click();
      await page.locator('#detail:not([hidden])').waitFor({state:'visible'});
      await page.locator('#closeDrawer').click();
      assert.equal(await page.locator('#detail').getAttribute('hidden'),'');
      console.log('browser_real_order_detail_verified=true');
    }
    if(view==='integration'&&process.env.EXPECT_PRIVATE_SYNC_TOTALS==='1'){
      await page.locator('#content .table').getByText('تعداد رکوردهای ذخیره‌شده در PostgreSQL',{exact:true}).first().waitFor();
      assert.equal(await page.locator('#content .table').getByText('تعداد رکوردهای ذخیره‌شده در PostgreSQL',{exact:true}).count(),7);
      console.log('browser_authenticated_sync_totals_verified=true');
    }
    if(view==='customers'||view==='suppliers')await page.getByRole('button',{name:view==='customers'?'ثبت مشتری جدید':'ثبت تأمین‌کننده جدید',exact:true}).waitFor();
  }
  phase='logout';
  await page.locator('#logout').click();
  await page.locator('#loginForm').waitFor({state:'visible'});
  assert.equal((await page.request.get(url+'/api/me')).status(),401);
  phase='mobile';
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,hasTouch:true});
  assert.equal((await mobile.goto(url+'/',{waitUntil:'networkidle',timeout:30000})).status(),200);
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await mobile.screenshot({path:out+'/vesta-login-mobile.png',animations:'disabled'});
  assert.equal(jsErrors,0);
  console.log('browser_https_login_csrf_cookie_logout_rtl_verified=true');
  console.log('browser_screens_verified='+controls.length);
}catch(e){
  // Never show form values, response payloads or Playwright action traces.
  console.error('browser_checks_failed='+phase+':'+e.name);
  process.exitCode=1;
}finally{await browser.close();}
