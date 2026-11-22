import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createHash,timingSafeEqual} from 'node:crypto';
import worker from '../edge-demo/worker.mjs';
import {PgBinding,poolFromEnv} from './pg.mjs';
import {authenticator} from './auth.mjs';
import {sourceService,acceptWebhook} from './source.mjs';
const pool=poolFromEnv(),db=new PgBinding(pool),origin=new URL(process.env.APP_ORIGIN||'https://hesab.vesta-cosmetics.ir').origin;
const mfa=process.env.MFA_REQUIRED!=='0';if(mfa&&!process.env.ADMIN_TOTP_SECRET)throw Error('MFA secret must be provisioned privately');if(!process.env.IP_SALT||process.env.IP_SALT.length<32)throw Error('IP salt required');
const fontPath=process.env.IRANYEKAN_FONT_PATH;const fontAvailable=!!fontPath&&await stat(fontPath).then(x=>x.isFile()&&x.size>1000&&x.size<8*1024*1024).catch(()=>false);
const vazirFont=await readFile(new URL('../edge-demo/fonts/Vazirmatn.woff2',import.meta.url));
const env={DB:db,MODE:'source',IP_SALT:process.env.IP_SALT,RELEASE:process.env.RELEASE||'local',FONT_AVAILABLE:fontAvailable,VAZIR_FONT:vazirFont,MFA_REQUIRED:mfa,authenticate:authenticator(pool,{requireMfa:mfa,totpSecret:process.env.ADMIN_TOTP_SECRET}),integration:sourceService(pool)};
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,origin);if(url.origin!==origin){res.writeHead(400);res.end();return;}
 if(url.pathname==='/fonts/iranyekan.woff2'&&req.method==='GET'){if(!fontAvailable){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'font/woff2','Cache-Control':'private,max-age=86400','X-Content-Type-Options':'nosniff'});res.end(await readFile(fontPath));return;}
 let data=null;if(!['GET','HEAD'].includes(req.method)){let size=0,parts=[];const max=url.pathname==='/webhooks/woocommerce'?2097152:32768;for await(const chunk of req){size+=chunk.length;if(size>max){res.writeHead(413);res.end();return;}parts.push(chunk);}data=Buffer.concat(parts);}
 if(url.pathname==='/webhooks/woocommerce'&&req.method==='POST'){const ok=await acceptWebhook(pool,{secret:process.env.WOO_WEBHOOK_SECRET,payload:data,signature:req.headers['x-wc-webhook-signature'],topic:req.headers['x-wc-webhook-topic'],deliveryId:req.headers['x-wc-webhook-delivery-id']});res.writeHead(ok?202:401,{'Cache-Control':'no-store'});res.end();return;}
 const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v!==undefined&&k!=='host'&&k!=='cf-connecting-ip')headers.set(k,Array.isArray(v)?v.join(','):v);headers.set('CF-Connecting-IP',req.socket.remoteAddress||'unknown');const input=new Request(url,{method:req.method,headers,...(data?{body:data}: {})});const response=await worker.fetch(input,env);res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body){for await(const chunk of response.body){if(!res.write(chunk))await new Promise(r=>res.once('drain',r));}}res.end();
 }catch{console.error(JSON.stringify({event:'http_failure'}));if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"خطای سرویس"}');}});
server.requestTimeout=30000;server.headersTimeout=10000;server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log(JSON.stringify({event:'ready',mode:'source',database:'postgresql',posting_authorized:false,font:fontAvailable})));process.on('SIGTERM',()=>server.close(()=>pool.end().finally(()=>process.exit(0))));
