import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {createServer} from 'node:http';
import {crc32} from 'node:zlib';
import gateway from '../worker/gateway.js';
import {configZip} from '../web/config-zip.js';
import worker,{normalize,canonical,pagePayload,seal,hash,deviceConfig,deviceRepairConfig,verifyDeviceGateway,DATA_SOURCE} from '../worker/index.js';
function adapter(){const db=new DatabaseSync(':memory:');const dir=new URL('../drizzle/',import.meta.url);for(const f of readdirSync(dir).filter(x=>x.endsWith('.sql')))db.exec(readFileSync(new URL(f,dir),'utf8'));
 return {raw:db,prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};},async all(){return {results:db.prepare(sql).all()};}};}};}
const OWNER='owner@example.com',ORIGIN='https://capture.test';
const payload=()=>({id:crypto.randomUUID(),raw:'https://example.com/test',personalComment:'公开测试评论',createdAt:'2026-10-23T09:00:00.000Z',isDiandian:false});
async function fixture(mode='normal'){
 const env={DB:adapter(),IDENTITY_PROVIDER:'sites',NOTION_DATA_SOURCE_ID:DATA_SOURCE,OWNER_EMAIL:OWNER,CONFIG_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')};
 await env.DB.prepare("INSERT INTO config(key,value) VALUES('notion',?)").bind(await seal(env,'ntn_test_secret_never_in_client')).run();
 const pages=[],blocks=[];let creates=0,failOnce=mode==='429';
 env.NOTION_FETCH=async(url,opts)=>{const path=new URL(url).pathname,b=opts.body?JSON.parse(opts.body):null;
  if(path.endsWith('/query'))return Response.json({results:pages.filter(p=>p.root===b.filter.rich_text.equals).map(p=>({object:'page',id:p.id,url:'https://www.notion.so/'+p.id}))});
  if(path==='/v1/pages'&&opts.method==='POST'){
   creates++;if(failOnce){failOnce=false;return Response.json({code:'rate_limited'},{status:429,headers:{'Retry-After':'1'}});}
   const page={id:crypto.randomUUID(),root:b.properties['入口记录ID'].rich_text[0].text.content,body:b};pages.push(page);
   if(mode==='timeout')throw Error('simulated lost acknowledgement');
   return Response.json({object:'page',id:page.id,url:'https://www.notion.so/'+page.id});
  }
  if(path.endsWith('/children')&&opts.method==='GET')return Response.json({results:blocks,has_more:false});
  if(path.endsWith('/children')&&opts.method==='PATCH'){blocks.push(...b.children);return Response.json({results:b.children});}
  if(path.startsWith('/v1/pages/')&&opts.method==='PATCH')return Response.json({object:'page'});
  throw Error('unexpected Notion operation '+path);
 };
 const request=(p,headers={})=>worker.fetch(new Request(ORIGIN+'/api/capture',{method:'POST',headers:{'Content-Type':'application/json','Origin':ORIGIN,'oai-authenticated-user-email':OWNER,...headers},body:JSON.stringify(p)}),env);
 return {env,request,pages,blocks,get creates(){return creates;}};
}
test('original content, comment and summary stay distinct; rich text chunks obey Notion bounds',()=>{const p=normalize({...payload(),raw:'字'.repeat(16000)}),out=pagePayload(p,p.id);assert.equal(out.parent.data_source_id,DATA_SOURCE);assert.equal(out.properties['原始内容'].rich_text.map(x=>x.text.content).join(''),p.raw);assert.equal(out.properties['我的个人评论'].rich_text[0].text.content,p.personalComment);assert.equal(out.properties['点点总结'].rich_text.length,0);assert(out.properties['原始内容'].rich_text.every(x=>x.text.content.length<=2000));});
test('conservative URL matching preserves source, identifies xhs note and does not fetch URLs',()=>{assert.equal(canonical({url:'https://example.com/a?utm_source=z&b=1#test'}),'url:https://example.com/a?b=1');assert.equal(canonical({url:'https://www.xiaohongshu.com/explore/1234567890abcdef12345678?xsec_token=secret'}),'xhs:1234567890abcdef12345678');assert.throws(()=>normalize({...payload(),url:'file:///private'}));assert.throws(()=>normalize({...payload(),url:'https://u:p@example.com'}));});
test('capture commits to provider and duplicate UUID returns same page without another write',async()=>{const f=await fixture(),p=payload();let r=await f.request(p);assert.equal(r.status,200);const first=await r.json();assert(first.pageId);r=await f.request(p);assert.equal((await r.json()).pageId,first.pageId);assert.equal(f.creates,1);assert.equal(f.env.DB.raw.prepare('SELECT state FROM events').get().state,'synced');});
test('same id with changed content is rejected',async()=>{const f=await fixture(),p=payload();await f.request(p);assert.equal((await f.request({...p,personalComment:'different'})).status,409);assert.equal(f.creates,1);});
test('lost Notion acknowledgement reconciles before retry, never creates a duplicate',async()=>{const f=await fixture('timeout'),p=payload();assert.equal((await f.request(p)).status,502);assert.equal(f.pages.length,1);const r=await f.request(p);assert.equal(r.status,200);assert.equal((await r.json()).state,'synced');assert.equal(f.creates,1);});
test('unknown write with no query match is not blindly repeated',async()=>{const f=await fixture();f.env.NOTION_FETCH=async(url,opts)=>url.endsWith('/query')?Response.json({results:[]}):Promise.reject(Error('offline'));const p=payload();assert.equal((await f.request(p)).status,502);const r=await f.request(p);assert.equal(r.status,409);assert.equal((await r.json()).code,'uncertain');});
test('rate limit keeps original event pending and retry-after',async()=>{const f=await fixture('429'),p=payload();const r=await f.request(p);assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'1');assert.equal(f.pages.length,0);assert.equal((await f.request(p)).status,429);});
test('same link supplemental summary appends evidence without replacing original or comment',async()=>{const f=await fixture(),p=payload();await f.request(p);const summary={...payload(),raw:'点点公开模拟总结',url:p.raw,isDiandian:true,personalComment:'追加想法'};assert.equal((await f.request(summary)).status,200);assert.equal(f.pages.length,1);assert.equal(f.pages[0].body.properties['原始内容'].rich_text[0].text.content,p.raw);assert.equal(f.pages[0].body.properties['我的个人评论'].rich_text[0].text.content,p.personalComment);assert(f.blocks.some(b=>b.paragraph.rich_text.some(x=>x.text.content==='点点公开模拟总结')));});
test('device token is scoped, revocable, and cannot configure or read owner data',async()=>{const f=await fixture(),key='a'.repeat(64);await f.env.DB.prepare('INSERT INTO devices(id,label,token_hash,created_at) VALUES(?,?,?,?)').bind('device-test','test',await hash(key),'2026-10-23').run();const h={'oai-authenticated-user-email':'','Authorization':'Bearer '+key,'Origin':''};assert.equal((await f.request(payload(),h)).status,200);const setup=await worker.fetch(new Request(ORIGIN+'/api/setup',{headers:{Authorization:'Bearer '+key}}),f.env);assert.equal(setup.status,403);await f.env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind('now','device-test').run();assert.equal((await f.request(payload(),h)).status,401);});
test('browser CSRF and anonymous submissions denied',async()=>{const f=await fixture();assert.equal((await f.request(payload(),{Origin:'https://evil.test'})).status,403);assert.equal((await f.request(payload(),{'oai-authenticated-user-email':''})).status,401);assert.equal(f.creates,0);});
test('notion credential encrypted at rest and absent from generated mobile config',async()=>{const f=await fixture(),row=f.env.DB.raw.prepare("SELECT value FROM config WHERE key='notion'").get();assert(!row.value.includes('ntn_'));const s=JSON.stringify(deviceConfig('https://gateway.test/api/capture','b'.repeat(64)));assert(!s.includes('SITE_SERVICE_TOKEN'));assert(!s.includes('siteToken'));assert(!s.includes('OAI-Sites-Authorization'));assert(!s.includes('ntn_'));assert(s.includes('inspiration_cloud_auth'));});
test('phone keeps failed requests, reuses IDs, and only confirms provider receipt',()=>{const code=phoneCode();let saved='[]',toasts=[],dialogs=[],calls=[];const auth=JSON.stringify({endpoint:'https://gateway.test/api/capture',deviceToken:'b'.repeat(64)});const context={getVariable:k=>k==='inspiration_cloud_auth'?auth:saved,setVariable:(k,v)=>{if(k==='inspiration_cloud_pending')saved=v;},getClipboardContent:()=> 'https://example.com',prompt:()=> '公开评论',uuidv4:()=> 'public-mobile-test-uuid',executeShortcut:(id,o)=>{calls.push(JSON.parse(o.inspiration_request_body));return {status:'networkError'};},showDialog:s=>dialogs.push(s),showToast:s=>toasts.push(s),abort:()=>{}};vm.runInNewContext(code,context);assert.equal(JSON.parse(saved).length,1);assert.equal(toasts.length,0);assert(dialogs[0].includes('未上传'));context.executeShortcut=(id,o)=>{const p=JSON.parse(o.inspiration_request_body);assert.equal(p.id,calls[0].id);return {status:'success',response:{statusCode:200,body:JSON.stringify({ok:true,state:'synced',id:p.id,pageId:'test-notion-page'})}};};vm.runInNewContext(phoneCode(true),context);assert.equal(saved,'[]');assert(toasts[0].includes('已上传到 Notion'));});

function phoneCode(retry=false,summary=false){return readFileSync(new URL('../worker/phone.js.txt',import.meta.url),'utf8').replaceAll('__RETRY_ONLY__',String(retry)).replaceAll('__SUMMARY_MODE__',String(summary));}
const deviceKey='b'.repeat(64),upstreamOrigin='https://capture.example.test';
async function addDevice(f){await f.env.DB.prepare('INSERT INTO devices(id,label,token_hash,created_at) VALUES(?,?,?,?)').bind('phone-test','公开手机测试',await hash(deviceKey),new Date().toISOString()).run();}

test('explicit device authorization cannot inherit owner identity from the platform',async()=>{
 const f=await fixture();await addDevice(f);
 assert.equal((await f.request(payload(),{Authorization:'Bearer '+deviceKey})).status,200);
 assert.equal(f.env.DB.raw.prepare('SELECT device_id FROM events').get().device_id,'phone-test');
 await f.env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind('now','phone-test').run();
 assert.equal((await f.request(payload(),{Authorization:'Bearer '+deviceKey})).status,401);
 assert.equal((await f.request(payload(),{Authorization:'Bearer invalid'})).status,401);
});

test('lost supplemental acknowledgement reconciles its marker and never overwrites original data',async()=>{
 const f=await fixture(),p=payload();await f.request(p);const original=f.env.NOTION_FETCH;let appends=0;
 f.env.NOTION_FETCH=async(u,o)=>{const r=await original(u,o);if(u.includes('/children')&&o.method==='PATCH'){appends++;throw Error('lost append acknowledgement');}return r;};
 const summary={...payload(),raw:'模拟点点：后续总结',url:p.raw,isDiandian:true,personalComment:'我的补充'};
 assert.equal((await f.request(summary)).status,502);
 assert.equal((await f.request(summary)).status,200);assert.equal(appends,1);assert.equal(f.pages.length,1);
 assert.equal(f.pages[0].body.properties['我的个人评论'].rich_text[0].text.content,p.personalComment);
});

test('uncertain supplement with an invisible marker must not be appended again',async()=>{
 const f=await fixture(),p=payload();await f.request(p);const original=f.env.NOTION_FETCH;let appends=0;
 f.env.NOTION_FETCH=async(u,o)=>{if(u.includes('/children')&&o.method==='PATCH'){appends++;throw Error('unknown append');}return original(u,o);};
 const s={...payload(),raw:'模拟补充',url:p.raw,isDiandian:true};
 assert.equal((await f.request(s)).status,502);const r=await f.request(s);assert.equal(r.status,409);assert.equal((await r.json()).code,'uncertain');assert.equal(appends,1);
});

test('phone summary entry asks explicitly for the source and preserves independent comment',()=>{
 let saved='',prompts=0,submitted;const replies=['https://example.com/original','我的新评论'];
 const ctx={getVariable:k=>k==='inspiration_cloud_auth'?JSON.stringify({endpoint:'https://gateway.test/api/capture',deviceToken:deviceKey}):saved,setVariable:(k,v)=>{if(k==='inspiration_cloud_pending')saved=v;},getClipboardContent:()=> '模拟点点总结正文',prompt:()=>replies[prompts++],uuidv4:()=>crypto.randomUUID(),executeShortcut:(id,o)=>{submitted=JSON.parse(o.inspiration_request_body);return {status:'networkError'};},showDialog:()=>{},showToast:()=>{},abort:()=>{}};
 vm.runInNewContext(phoneCode(false,true),ctx);
 assert.equal(prompts,2);assert.equal(submitted.url,replies[0]);assert.equal(submitted.raw,'模拟点点总结正文');assert.equal(submitted.personalComment,replies[1]);assert.equal(submitted.isDiandian,true);assert.equal(JSON.parse(saved)[0].id,submitted.id);
});

test('phone cannot report success for a login redirect, unrelated receipt or invalid body',()=>{
 for(const result of [{status:'success',response:{statusCode:302,body:'login'}},{status:'success',response:{statusCode:200,body:JSON.stringify({ok:true,state:'synced',id:'another-id',pageId:'p'})}},{status:'success',response:{statusCode:200,body:'<html>login</html>'}}]){
  let saved='',toast=0,dialog=0;const ctx={getVariable:k=>k==='inspiration_cloud_auth'?JSON.stringify({endpoint:'https://gateway.test/api/capture',deviceToken:deviceKey}):saved,setVariable:(k,v)=>{if(k==='inspiration_cloud_pending')saved=v;},getClipboardContent:()=> '公开文字',prompt:()=>'',uuidv4:()=>crypto.randomUUID(),executeShortcut:()=>result,showDialog:()=>dialog++,showToast:()=>toast++,abort:()=>{}};
  vm.runInNewContext(phoneCode(),ctx);assert.equal(toast,0);assert.equal(dialog,1);assert.equal(JSON.parse(saved).length,1);
 }
});

test('downloaded ZIP preserves shortcut ID and omits queue initialization on repeated merge',()=>{
 const config=deviceConfig('https://gateway.test/api/capture',deviceKey),pending=config.variables.find(v=>v.key==='inspiration_cloud_pending');
 assert.equal(pending.isExcludeValueFromExport,true);assert.equal(Object.hasOwn(pending,'value'),false);
 assert.equal(config.categories[0].shortcuts[0].id,'07d8e220-d3af-54db-baaa-87cf1add6008');
 assert(!config.variables.some(v=>v.key==='inspiration_poc_queue'));assert.equal(config.categories[0].shortcuts.length,4);
 const zip=configZip(config),view=new DataView(zip.buffer),size=view.getUint32(18,true),nameLength=view.getUint16(26,true);
 assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint16(8,true),0);
 assert.equal(new TextDecoder().decode(zip.slice(30,30+nameLength)),'shortcuts.json');
 assert.deepEqual(JSON.parse(new TextDecoder().decode(zip.slice(30+nameLength,30+nameLength+size))),config);
 assert.equal(view.getUint32(14,true),crc32(zip.slice(30+nameLength,30+nameLength+size)));
 assert.equal(view.getUint32(zip.length-22,true),0x06054b50);
 const transport=config.categories[0].shortcuts.find(s=>s.id==='7f3d6a81-18dc-45f2-81a5-7b403b503861');
 assert.equal(transport.timeout,60000);assert.equal(transport.followRedirects,false);assert.equal(transport.hidden,true);assert.equal(transport.excludeFromHistory,true);
});

test('local HTTP phone request -> gateway -> SQLite-backed writer -> simulated Notion and replay',async()=>{
 const f=await fixture();await addDevice(f);
 const serve=async handler=>{const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const out=await handler(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}: {})}));res.writeHead(out.status,Object.fromEntries(out.headers));res.end(Buffer.from(await out.arrayBuffer()));}catch{res.writeHead(500);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,origin:'http://127.0.0.1:'+server.address().port};};
 const privateSite=await serve(req=>{if(req.headers.get('OAI-Sites-Authorization')!=='Bearer simulated-platform-service')return new Response('platform denied',{status:403});return worker.fetch(req,f.env);});
 let drop=false;
 const gwEnv={UPSTREAM_ORIGIN:upstreamOrigin,ALLOWED_UPSTREAM_ORIGIN:upstreamOrigin,UPSTREAM_SERVICE_TOKEN:'simulated-platform-service',UPSTREAM_FETCH:async(u,o)=>{assert.equal(u,upstreamOrigin+'/api/capture');const r=await fetch(privateSite.origin+'/api/capture',o);if(drop){drop=false;await r.text();throw Error('lost gateway acknowledgement');}return r;}};
 const publicGateway=await serve(req=>gateway.fetch(req,gwEnv));
 const post=async(p,key=deviceKey)=>fetch(publicGateway.origin+'/api/capture',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(p)});
 try{
  let outbox='',toast='';const phone={getVariable:k=>k==='inspiration_cloud_auth'?JSON.stringify({endpoint:'https://gateway.test/api/capture',deviceToken:deviceKey}):outbox,setVariable:(k,v)=>{if(k==='inspiration_cloud_pending')outbox=v;},getClipboardContent:()=> 'https://example.com/phone-public-test',prompt:()=> '公开手机模拟评论',uuidv4:()=>crypto.randomUUID(),executeShortcut:()=>({status:'networkError'}),showDialog:()=>{},showToast:s=>toast=s,abort:()=>{}};
  vm.runInNewContext(phoneCode(),phone);const p=JSON.parse(outbox)[0];assert.equal(p.personalComment,'公开手机模拟评论');
  drop=true;assert.equal((await post(p)).status,502);assert.equal(f.pages.length,1);
  const recovered=await post(p),first=await recovered.json();assert.equal(recovered.status,200);assert.equal(first.state,'synced');
  phone.executeShortcut=(id,values)=>{assert.deepEqual(JSON.parse(values.inspiration_request_body),p);assert.equal(values.inspiration_request_token,deviceKey);return {status:'success',response:{statusCode:200,body:JSON.stringify(first)}};};
  vm.runInNewContext(phoneCode(true),phone);assert.equal(outbox,'[]');assert(toast.includes('已上传到 Notion'));
  assert.equal((await(await post(p)).json()).pageId,first.pageId);assert.equal(f.creates,1);
  const s={...payload(),raw:'模拟点点摘要',url:p.raw,isDiandian:true,personalComment:'补充评论'};
  assert.equal((await(await post(s)).json()).pageId,first.pageId);assert.equal(f.pages.length,1);assert(f.blocks.length>0);
  assert.equal((await post(payload(),'c'.repeat(64))).status,401);
  await f.env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind('now','phone-test').run();assert.equal((await post(payload())).status,401);
  assert.equal((await fetch(publicGateway.origin+'/api/events',{headers:{Authorization:'Bearer '+deviceKey}})).status,404);
  assert.equal(f.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM events').get().n,2);
 }finally{for(const s of [publicGateway.server,privateSite.server]){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}}
});

test('phone abort or failure to persist cannot send a request or discard old records',()=>{
 for(const canceled of [true,false]){
  let sends=0;const original='[]',ctx={getVariable:k=>k==='inspiration_cloud_auth'?JSON.stringify({endpoint:'https://gateway.test/api/capture',deviceToken:deviceKey}):original,setVariable:()=>{throw Error('disk full');},getClipboardContent:()=> '公开内容',prompt:()=>canceled?null:'公开评论',uuidv4:()=>crypto.randomUUID(),executeShortcut:()=>sends++,showDialog:()=>{},showToast:()=>assert.fail('cannot confirm'),abort:()=>{}};
  vm.runInNewContext(phoneCode(),ctx);assert.equal(sends,0);assert.equal(ctx.getVariable('inspiration_cloud_pending'),original);
 }
});

test('device throttling bounds new events while an original-id retry still works',async()=>{
 const f=await fixture();await addDevice(f);const h={Authorization:'Bearer '+deviceKey,'oai-authenticated-user-email':'',Origin:''};let first;
 for(let i=0;i<30;i++){const p={...payload(),raw:'公开测试文字 '+i};first??=p;assert.equal((await f.request(p,h)).status,200);}
 const r=await f.request(payload(),h);assert.equal(r.status,429);assert.equal((await r.json()).code,'rate_limit');
 assert.equal((await f.request(first,h)).status,200);assert.equal(f.pages.length,30);
});

test('owner configuration check exercises capture-only gateway with stable public fixtures',async()=>{
 const f=await fixture();await addDevice(f);f.env.CAPTURE_GATEWAY_URL='https://gateway.test';
 const gw={UPSTREAM_ORIGIN:upstreamOrigin,ALLOWED_UPSTREAM_ORIGIN:upstreamOrigin,UPSTREAM_SERVICE_TOKEN:'simulated-service',UPSTREAM_FETCH:(u,o)=>worker.fetch(new Request(u,o),f.env)};
 f.env.GATEWAY_FETCH=(u,o)=>gateway.fetch(new Request(u,o),gw);
 const d=f.env.DB.raw.prepare('SELECT id,created_at FROM devices').get();
 const first=await verifyDeviceGateway(f.env,d,deviceKey);assert.equal(first.ok,true);assert.equal(f.pages.length,1);assert.equal(f.creates,1);
 const blockCount=f.blocks.length,again=await verifyDeviceGateway(f.env,d,deviceKey);
 assert.equal(again.ok,true);assert.equal(again.id,first.id);assert.equal(again.pageId,first.pageId);assert.equal(f.blocks.length,blockCount);assert.equal(f.pages.length,1);
 assert.equal(f.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM events').get().n,2);
});

test('configuration check fails closed on a permissive or unreachable gateway',async()=>{
 const f=await fixture(),d={id:'public-device-test',created_at:'2026-10-23T13:00:00.000Z'};f.env.CAPTURE_GATEWAY_URL='https://gateway.test';
 f.env.GATEWAY_FETCH=async()=>Response.json({ok:true});assert.equal((await verifyDeviceGateway(f.env,d,deviceKey)).ok,false);
 f.env.GATEWAY_FETCH=async()=>{throw Error('network interrupted');};const result=await verifyDeviceGateway(f.env,d,deviceKey);assert.equal(result.ok,false);assert.equal(result.code,'gateway_network');assert.equal(f.pages.length,0);
});

test('device verification is owner-only, same-origin, and requires the unrevoked issued credential',async()=>{
 const f=await fixture();await addDevice(f);
 const call=(p,headers={})=>worker.fetch(new Request(ORIGIN+'/api/devices/check',{method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN,'oai-authenticated-user-email':OWNER,...headers},body:JSON.stringify(p)}),f.env);
 const p={id:'phone-test',deviceToken:deviceKey};
 assert.equal((await call(p,{'oai-authenticated-user-email':'',Authorization:'Bearer '+deviceKey})).status,403);
 assert.equal((await call(p,{Origin:'https://evil.test'})).status,403);
 assert.equal((await call({...p,deviceToken:'c'.repeat(64)})).status,401);
 await f.env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind('now','phone-test').run();assert.equal((await call(p)).status,401);
});

test('receipt repair updates scripts without importing credentials or an outbox value',async()=>{
 const c=deviceRepairConfig('https://gateway.test/api/capture');
 assert.deepEqual(c.variables.map(v=>v.key),['inspiration_cloud_receipt']);assert(!Object.hasOwn(c.variables[0],'value'));
 assert.equal(c.categories[0].shortcuts[0].id,'07d8e220-d3af-54db-baaa-87cf1add6008');
 const transport=c.categories[0].shortcuts.find(s=>s.executionType==='app');
 assert(transport.codeOnSuccess.includes('setVariable'));assert(transport.codeOnSuccess.includes('setResult'));assert(transport.codeOnFailure);
 const f=await fixture();f.env.CAPTURE_GATEWAY_URL='https://gateway.test';
 assert.equal((await worker.fetch(new Request(ORIGIN+'/api/devices/repair'),f.env)).status,403);
 const r=await worker.fetch(new Request(ORIGIN+'/api/devices/repair',{headers:{'oai-authenticated-user-email':OWNER}}),f.env);
 assert.equal(r.status,200);const data=await r.json();assert.deepEqual(data.config,c);
 assert.equal(f.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM devices').get().n,0);
});

test('explicit acknowledgement survives missing nested response and recovers both original queued ids',()=>{
 const queue=[{...payload(),id:'00000000-0000-4000-8000-000000000001'},payload()],sent=[];
 const vars={inspiration_cloud_auth:JSON.stringify({endpoint:'https://gateway.test/api/capture',deviceToken:deviceKey}),inspiration_cloud_pending:JSON.stringify(queue),inspiration_cloud_receipt:''};let toast;
 const helper=deviceRepairConfig('https://gateway.test/api/capture').categories[0].shortcuts.find(s=>s.executionType==='app');
 const context={getVariable:k=>vars[k],setVariable:(k,v)=>{vars[k]=v;},showDialog:s=>assert.fail(s),showToast:s=>toast=s,executeShortcut:(id,values)=>{
  const p=JSON.parse(values.inspiration_request_body);sent.push(p.id);
  const receipt={ok:true,state:'synced',id:p.id,pageId:'provider-page-'+p.id};let result;
  vm.runInNewContext(helper.codeOnSuccess,{response:{statusCode:200,body:JSON.stringify(receipt)},setVariable:context.setVariable,setResult:s=>result=s});
  assert.equal(JSON.parse(result).statusCode,200);
  // Some Android nested results fail to expose the HTTP response. The explicit
  // receipt is saved before returning and is sufficient only for this same id.
  return {status:'unknown',response:null,result:null};
 }};
 vm.runInNewContext(phoneCode(true),context);
 assert.deepEqual(sent,queue.map(p=>p.id));assert.equal(vars.inspiration_cloud_pending,'[]');assert(toast.includes('已上传到 Notion：2 条'));
});

test('persisted acknowledgement is reconciled even if nested result construction throws',()=>{
 const p=payload(),vars={inspiration_cloud_auth:JSON.stringify({endpoint:'https://gateway.test/api/capture',deviceToken:deviceKey}),inspiration_cloud_pending:JSON.stringify([p]),inspiration_cloud_receipt:''};let toast;
 const ctx={getVariable:k=>vars[k],setVariable:(k,v)=>vars[k]=v,showDialog:s=>assert.fail(s),showToast:s=>toast=s,executeShortcut:()=>{vars.inspiration_cloud_receipt=JSON.stringify({v:1,statusCode:200,body:JSON.stringify({ok:true,state:'synced',id:p.id,pageId:'confirmed-page'})});throw Error('nested response conversion failed');}};
 vm.runInNewContext(phoneCode(true),ctx);assert.equal(vars.inspiration_cloud_pending,'[]');assert(toast.includes('已上传'));
});

test('stale, wrong-id, rejected or malformed explicit receipts cannot remove pending items',()=>{
 for(const packet of [null,{v:1,statusCode:200,body:JSON.stringify({ok:true,state:'synced',id:'other-id',pageId:'p'})},{v:1,statusCode:401,body:JSON.stringify({ok:false,message:'已撤销'})},{v:1,statusCode:200,body:'not json'}]){
  const p=payload(),original=JSON.stringify([p]),vars={inspiration_cloud_auth:JSON.stringify({endpoint:'https://gateway.test/api/capture',deviceToken:deviceKey}),inspiration_cloud_pending:original,inspiration_cloud_receipt:JSON.stringify({v:1,statusCode:200,body:JSON.stringify({ok:true,state:'synced',id:p.id,pageId:'stale-page'})})};let dialog;
  const ctx={getVariable:k=>vars[k],setVariable:(k,v)=>vars[k]=v,showDialog:s=>dialog=s,showToast:()=>assert.fail('cannot confirm'),executeShortcut:()=>{if(packet)vars.inspiration_cloud_receipt=JSON.stringify(packet);return {status:'unknown',response:null};}};
  vm.runInNewContext(phoneCode(true),ctx);assert.equal(vars.inspiration_cloud_pending,original);assert(dialog.includes('回执检查 v2'));
 }
});
test('expired lock before any provider write remains safe to resume with the original id',async()=>{
 const f=await fixture(),p=payload(),n=normalize(p),key=await hash(canonical(n));
 await f.env.DB.prepare('INSERT INTO events(id,device_id,payload_hash,record_key,payload_json,state,updated_at) VALUES(?,?,?,?,?,?,?)').bind(p.id,'owner',await hash(JSON.stringify(n)),key,JSON.stringify(n),'prepared',p.createdAt).run();
 await f.env.DB.prepare('INSERT INTO locks(record_key,event_id,acquired_at) VALUES(?,?,?)').bind(key,p.id,Date.now()-130000).run();
 assert.equal((await f.request(p)).status,409);
 const r=await f.request(p);assert.equal(r.status,200);assert.equal(f.pages.length,1);assert.equal(f.creates,1);
});
test('a failed reconciliation read must never downgrade an uncertain write to safe-to-create',async()=>{
 const f=await fixture('timeout'),p=payload();assert.equal((await f.request(p)).status,502);assert.equal(f.creates,1);
 const original=f.env.NOTION_FETCH;let offline=true;
 f.env.NOTION_FETCH=async(u,o)=>{if(u.endsWith('/query')){if(offline)throw Error('read unavailable');return Response.json({results:[]});}return original(u,o);};
 assert.equal((await f.request(p)).status,502);
 assert.equal(f.env.DB.raw.prepare('SELECT state FROM events WHERE id=?').get(p.id).state,'uncertain');
 offline=false;assert.equal((await f.request(p)).status,409);assert.equal(f.creates,1);assert.equal(f.pages.length,1);
});
