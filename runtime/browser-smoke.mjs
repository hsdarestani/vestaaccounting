import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
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
    completed_first_cycle:!!dashboard.last_success,current_cycle_complete:dashboard.complete,
    has_source_error:!!dashboard.last_error,
    source_error:/^(woo_http_\d{3}|sync_failed|read_only_credentials_missing)$/.test(dashboard.last_error||'')?dashboard.last_error:null
  }));
  phase='dashboard-image';
  // Browser artifacts must remain safe to share: mask every private metric,
  // identity and record. Individual order/customer data is not photographed.
  const mask=page.locator('#userName, #content .card strong, #content .sync-item b, #content tbody, #content .chart');
  await page.screenshot({path:out+'/vesta-dashboard-redacted.png',animations:'disabled',mask:[mask],maskColor:'#f3d9e7'});
  const controls=await page.locator('#nav button[data-view]').evaluateAll(nodes=>nodes.map(m=>m.dataset.view));
  for(const view of controls){
    assert.match(view,/^[a-z_]+$/);
    phase='view_'+view;
    await page.locator(`#nav [data-view="${view}"]`).click();
    await page.waitForFunction(()=>document.querySelector('#content .panel')||document.querySelector('#content .dashboard-welcome'),null,{timeout:16000});
    assert.equal(await page.locator('#content .error').count(),0,'screen '+view);
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
