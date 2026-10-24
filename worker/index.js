// The private Site is the owner console. Only the narrow, authenticated capture API
// may be called by its server-side gateway. Platform credentials never reach clients.
const ASSETS=/* EMBED_ASSETS */ {};
const PHONE_SCRIPT=/* EMBED_PHONE_SCRIPT */ "";
export const DATA_SOURCE='11111111-1111-4111-8111-111111111111';
export const DATABASE_URL='https://app.notion.com/p/22222222222242228222222222222222';
const VERSION='2026-03-11',enc=new TextEncoder();
function sourceID(env){const id=env.NOTION_DATA_SOURCE_ID;if(typeof id!=='string'||!/^[-0-9a-f]{36}$/i.test(id))fail(503,'source_not_configured','请配置自己的 Notion 数据源。');return id;}
const databaseURL=env=>env.NOTION_DATABASE_URL||'https://www.notion.so/';
class Problem extends Error {constructor(status,code,message,extra={}){super(message);Object.assign(this,{status,code,extra});}}
const fail=(s,c,m,e)=>{throw new Problem(s,c,m,e);};
export async function hash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const one=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
const run=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).run();
const now=()=>new Date().toISOString();
function isOwner(req,env){return env.IDENTITY_PROVIDER==='sites'&&!!env.OWNER_EMAIL&&req.headers.get('oai-authenticated-user-email')?.toLowerCase()===env.OWNER_EMAIL.toLowerCase();}
function requireOwner(req,env){if(!isOwner(req,env))fail(403,'owner_required','请使用站点所有者账号登录。');}
function requireOrigin(req){if(req.headers.get('Origin')!==new URL(req.url).origin)fail(403,'origin_denied','请从本站页面提交。');}
async function body(req){
 if(!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))fail(415,'json_required','需要 JSON 请求。');
 const reader=req.body?.getReader();if(!reader)fail(400,'empty_body','内容为空。');
 const chunks=[];let n=0;for(;;){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>64000){await reader.cancel();fail(413,'too_large','内容过长，未提交。');}chunks.push(r.value);}
 const bytes=new Uint8Array(n);let i=0;for(const x of chunks){bytes.set(x,i);i+=x.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'invalid_json','请求内容格式错误。');}
}
export function normalize(p){
 if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'invalid_input','内容格式错误。');
 if(typeof p.id!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(p.id))fail(400,'invalid_id','缺少有效收集编号。');
 for(const k of ['raw','personalComment','url','title'])if(p[k]!==undefined&&typeof p[k]!=='string')fail(400,'invalid_input','内容格式错误。');
 const raw=(p.raw||'').trim(),personalComment=p.personalComment||'';
 if(!raw||raw.length>16000||personalComment.length>4000)fail(400,'invalid_length','原始内容需为 1–16000 字，评论最多 4000 字。');
 if(p.isDiandian!==undefined&&typeof p.isDiandian!=='boolean')fail(400,'invalid_input','总结标记格式错误。');
 const url=(p.url||raw.match(/https?:\/\/[^\s<>"“”]+/i)?.[0]||'').trim();let source='文字';
 if(url){let u;try{u=new URL(url);}catch{fail(400,'invalid_url','链接格式错误。');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||url.length>2000)fail(400,'invalid_url','仅支持不含账号密码的 HTTP/HTTPS 链接，最多 2000 字。');
  source=/(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.com$/.test(u.hostname)?'小红书':u.hostname;
 }
 const date=p.createdAt===undefined?now():p.createdAt;
 if(typeof date!=='string'||!Number.isFinite(Date.parse(date))||date.length>40)fail(400,'invalid_date','收集时间无效。');
 return {id:p.id,raw,url,personalComment,isDiandian:p.isDiandian===true,createdAt:new Date(date).toISOString(),source,title:(p.title||'').slice(0,180)};
}
export function canonical(p){
 if(!p.url)return 'text:'+p.id;const u=new URL(p.url),m=u.pathname.match(/\/(?:explore|discovery\/item)\/([0-9a-f]{24})(?:\/|$)/i);
 if(/(^|\.)xiaohongshu\.com$/.test(u.hostname)&&m)return 'xhs:'+m[1].toLowerCase();
 u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(spm|fbclid|gclid)$/.test(k))u.searchParams.delete(k);u.searchParams.sort();return 'url:'+u;
}
function rich(s){const a=[];for(let i=0;i<s.length;i+=1800)a.push({type:'text',text:{content:s.slice(i,i+1800)}});return a;}
const para=s=>({object:'block',type:'paragraph',paragraph:{rich_text:rich(s)}});
export function pagePayload(p,rootID,source=DATA_SOURCE){return {parent:{type:'data_source_id',data_source_id:source},properties:{
 '标题':{title:rich(p.title||(p.url?new URL(p.url).hostname:p.raw.replace(/\s+/g,' ').slice(0,80)))},
 '原始链接':{url:p.url||null},'原始内容':{rich_text:rich(p.raw)},'我的个人评论':{rich_text:rich(p.personalComment)},
 '来源':{rich_text:rich(p.source)},'内容类型':{select:{name:p.isDiandian?'点点总结':p.url?'链接':'文字'}},
 '收集时间':{date:{start:p.createdAt}},'含点点已有总结':{checkbox:p.isDiandian},'处理状态':{select:{name:'收件箱'}},
 '点点总结':{rich_text:rich(p.isDiandian?p.raw:'')},'入口记录ID':{rich_text:rich(rootID)}
 },children:[para('本人主动收集。个人评论按本人输入保存；本系统未调用 AI。')]};}
async function cryptKey(env){if(!env.CONFIG_ENCRYPTION_KEY)fail(503,'server_config_missing','服务端安全配置未就绪。');return crypto.subtle.importKey('raw',Uint8Array.from(atob(env.CONFIG_ENCRYPTION_KEY),c=>c.charCodeAt(0)),'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(env,s){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(sourceID(env))},await cryptKey(env),enc.encode(s)));return JSON.stringify({v:1,iv:btoa(String.fromCharCode(...iv)),cipher:btoa(String.fromCharCode(...cipher))});}
async function unseal(env,s){const p=JSON.parse(s);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(p.iv),c=>c.charCodeAt(0)),additionalData:enc.encode(sourceID(env))},await cryptKey(env),Uint8Array.from(atob(p.cipher),c=>c.charCodeAt(0))));}
async function token(env){const r=await one(env,"SELECT value FROM config WHERE key='notion'");if(!r)fail(503,'notion_not_configured','尚未连接 Notion；内容保留待重试。');return unseal(env,r.value);}
async function notion(env,path,method='GET',data,override){
 let res,out;const secret=override||await token(env),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try{const options={method,redirect:'manual',signal:controller.signal,headers:{Authorization:'Bearer '+secret,'Notion-Version':VERSION,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})};res=env.NOTION_FETCH?await env.NOTION_FETCH('https://api.notion.com/v1'+path,options):await globalThis.fetch('https://api.notion.com/v1'+path,options);out=await res.json();}
 catch(e){const detail=String(e?.message||'unknown').replaceAll(secret,'[REDACTED]').replace(/(?:ntn_|secret_)[a-zA-Z0-9_-]+/g,'[REDACTED]').slice(0,300);console.warn(JSON.stringify({event:'notion_transport_failure',name:e?.name||'Error',detail,method,path}));throw new Problem(502,'notion_network','服务端连接 Notion 中断，未确认写入。',{uncertain:method!=='GET'&&!path.endsWith('/query')});}
 finally{clearTimeout(timer);}
 if(!res.ok)throw new Problem([401,403,404].includes(res.status)?503:res.status===429?429:502,'notion_'+res.status,[401,403,404].includes(res.status)?'Notion 授权或测试库访问失败，请检查连接。':res.status===429?'Notion 请求限流，请稍后重试。':'Notion 暂未确认保存，请稍后查看状态。',{uncertain:res.status>=500&&method!=='GET'&&!path.endsWith('/query'),retryAfter:Number(res.headers.get('Retry-After')||0)});
 return out;
}
async function auth(req,env){
 // An explicit device credential must never inherit an upstream owner's identity.
 const v=req.headers.get('Authorization')||'';if(!v&&isOwner(req,env))return {id:'owner',browser:true};
 if(!/^Bearer [a-f0-9]{64}$/.test(v))fail(401,'device_auth_required','收集入口未授权或已撤销。');
 const d=await one(env,'SELECT id FROM devices WHERE token_hash=? AND revoked_at IS NULL',await hash(v.slice(7)));
 if(!d)fail(401,'device_auth_required','收集入口未授权或已撤销。');return {id:d.id,browser:false};
}
async function writeEvent(env,id,state,pageID=null,error=null,retryAt=null){await run(env,'UPDATE events SET state=?,page_id=COALESCE(?,page_id),error_code=?,retry_at=?,updated_at=? WHERE id=?',state,pageID,error,retryAt,now(),id);}
async function findPage(env,root){const r=await notion(env,'/data_sources/'+sourceID(env)+'/query','POST',{filter:{property:'入口记录ID',rich_text:{equals:root}},page_size:2});if(r.results?.length>1)fail(409,'duplicate_provider','测试库已有重复记录，需要人工核对。');return r.results?.[0];}
async function appendEvidence(env,pageID,p,uncertain){
 const marker='收集补充 '+p.id;let cursor;
 do{const list=await notion(env,'/blocks/'+pageID+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));
  if(list.results?.some(b=>b.type==='paragraph'&&b.paragraph?.rich_text?.map(x=>x.plain_text??x.text?.content??'').join('')===marker))return;
  cursor=list.has_more?list.next_cursor:null;
 }while(cursor);
 if(uncertain)fail(409,'uncertain','上次补充的结果尚未确认，暂不重复追加；内容仍保留，请稍后用原编号重试。');
 await notion(env,'/blocks/'+pageID+'/children','PATCH',{children:[para(marker),para(p.isDiandian?'点点已有总结（本人粘贴）':'后续补充的原始内容'),para(p.raw),para('我的追加评论：'+(p.personalComment||'（未填写）')),para('收集时间：'+p.createdAt)]});
}
async function sync(env,event){
 const id=event.id,p=JSON.parse(event.payload_json);
 const lock=await run(env,'INSERT OR IGNORE INTO locks(record_key,event_id,acquired_at) VALUES(?,?,?)',event.record_key,id,Date.now());
 if(!lock.meta?.changes){const l=await one(env,'SELECT * FROM locks WHERE record_key=?',event.record_key);if(l&&Date.now()-l.acquired_at>120000){await run(env,"UPDATE events SET state='uncertain',error_code='interrupted',updated_at=? WHERE id=? AND state='inflight'",now(),l.event_id);await run(env,'DELETE FROM locks WHERE record_key=? AND acquired_at=?',event.record_key,l.acquired_at);}fail(409,'in_progress','上一笔尚在确认，请使用原编号稍后重试。');}
 let mutating=false;
 try{
  event=await one(env,'SELECT * FROM events WHERE id=?',id);if(event.state==='synced')return receipt(event);
  if(event.retry_at&&event.retry_at>Date.now())fail(429,'retry_later','请等待 Notion 限流结束后重试。',{retryAfter:Math.ceil((event.retry_at-Date.now())/1000)});
  await run(env,'INSERT OR IGNORE INTO records(record_key,root_event_id,created_at) VALUES(?,?,?)',event.record_key,id,p.createdAt);
  let record=await one(env,'SELECT * FROM records WHERE record_key=?',event.record_key);
  if(!record.page_id){const found=await findPage(env,record.root_event_id);if(found){await run(env,'UPDATE records SET page_id=?,notion_url=? WHERE record_key=?',found.id,found.url,event.record_key);record={...record,page_id:found.id,notion_url:found.url};}}
  const isRoot=record.root_event_id===id;
  if(isRoot&&record.page_id){await writeEvent(env,id,'synced',record.page_id);return receipt({...event,page_id:record.page_id,state:'synced'},record.notion_url);}
  if(!record.page_id&&!isRoot)fail(409,'parent_unconfirmed','同链接的首条记录尚未确认，请先重试首条。');
  if(!record.page_id){
   if(['inflight','uncertain'].includes(event.state))fail(409,'uncertain','上一笔结果尚不明确；已查询但未找到回执，暂不重复创建，请稍后再核对。');
   await writeEvent(env,id,'inflight');mutating=true;const page=await notion(env,'/pages','POST',pagePayload(p,id,sourceID(env)));
   if(page.object!=='page'||!page.id)throw new Problem(502,'notion_response','Notion 回执无效。',{uncertain:true});
   await run(env,'UPDATE records SET page_id=?,notion_url=? WHERE record_key=?',page.id,page.url,event.record_key);await writeEvent(env,id,'synced',page.id);return receipt({...event,page_id:page.id,state:'synced'},page.url);
  }
  await writeEvent(env,id,'inflight');mutating=true;await appendEvidence(env,record.page_id,p,['inflight','uncertain'].includes(event.state));
  if(p.isDiandian)await notion(env,'/pages/'+record.page_id,'PATCH',{properties:{'含点点已有总结':{checkbox:true}}});
  await writeEvent(env,id,'synced',record.page_id);return receipt({...event,page_id:record.page_id,state:'synced'},record.notion_url);
 }catch(e){
  const wasUncertain=['inflight','uncertain'].includes(event.state);
  if(e instanceof Problem){if(['uncertain','in_progress','parent_unconfirmed','retry_later','duplicate_provider'].includes(e.code))throw e;await writeEvent(env,id,e.extra.uncertain||wasUncertain?'uncertain':'failed',null,e.code,e.extra.retryAfter?Date.now()+e.extra.retryAfter*1000:null);throw e;}
  await writeEvent(env,id,mutating||wasUncertain?'uncertain':'failed',null,'internal_failure').catch(()=>{});throw new Problem(503,'internal_failure','服务暂时中断，未确认保存；请保留原编号重试。');
 }finally{await run(env,'DELETE FROM locks WHERE record_key=? AND event_id=?',event.record_key,id).catch(()=>{});}
}
function receipt(e,url){return {ok:true,state:'synced',id:e.id,pageId:e.page_id,notionUrl:url||'https://www.notion.so/'+e.page_id?.replaceAll('-',''),message:'已写入 Notion'};}
async function capture(req,env,actor){
 if(actor.browser)requireOrigin(req);const p=normalize(await body(req)),existing=await one(env,'SELECT * FROM events WHERE id=?',p.id),fingerprint=await hash(JSON.stringify(p));
 if(existing){if(existing.device_id!==actor.id||existing.payload_hash!==fingerprint)fail(409,'id_conflict','这个编号已对应另一笔内容，请勿改动待重试记录。');return json(existing.state==='synced'?receipt(existing):await sync(env,existing));}
 const recent=await one(env,'SELECT COUNT(*) AS n FROM events WHERE device_id=? AND updated_at>?',actor.id,new Date(Date.now()-60000).toISOString());if(recent.n>=30)fail(429,'rate_limit','提交过快，请稍后重试。',{retryAfter:60});
 const key=await hash(canonical(p));await run(env,'INSERT OR IGNORE INTO events(id,device_id,payload_hash,record_key,payload_json,state,updated_at) VALUES(?,?,?,?,?,?,?)',p.id,actor.id,fingerprint,key,JSON.stringify(p),'prepared',now());
 const saved=await one(env,'SELECT * FROM events WHERE id=?',p.id);if(saved.payload_hash!==fingerprint||saved.device_id!==actor.id)fail(409,'id_conflict','收集编号冲突。');return json(await sync(env,saved));
}
export function deviceConfig(endpoint,deviceToken){
 const shortcut=(id,name,retry,trigger,summary=false)=>({id,name,executionType:'scripting',description:'主动提交并确认 Notion 回执；失败保留本机待重试。',codeOnPrepare:PHONE_SCRIPT.replaceAll('__RETRY_ONLY__',String(retry)).replaceAll('__SUMMARY_MODE__',String(summary)),secondaryLauncherShortcut:trigger,quickSettingsTileShortcut:false,launcherShortcut:trigger,runInForegroundService:false,runOnAppStart:false,excludeFromHistory:true,excludeFromFileSharing:true,responseHandling:{successOutput:'none',failureOutput:'detailed',uiType:'dialog'}});
 // sendHttpRequest has a fixed 10s default. A hidden native HTTP shortcut can
 // wait for the gateway without changing the sidebar's clipboard/prompt flow.
 const bridge="(function(){var hasResponse=typeof response!=='undefined'&&response;var packet=JSON.stringify({v:1,statusCode:hasResponse?response.statusCode:0,body:hasResponse?response.body:JSON.stringify({ok:false,code:'phone_network',message:'手机请求未收到服务端回执，请保留原编号重试。'})});setVariable('inspiration_cloud_receipt',packet);setResult(packet);})();";
 const transport={id:'7f3d6a81-18dc-45f2-81a5-7b403b503861',name:'灵感上传（内部）',hidden:true,executionType:'app',method:'POST',url:endpoint,timeout:60000,followRedirects:false,acceptCookies:false,requestBodyType:'custom_text',contentType:'application/json',bodyContent:'{{inspiration_request_body}}',headers:[{key:'Authorization',value:'Bearer {{inspiration_request_token}}'}],codeOnSuccess:bridge,codeOnFailure:bridge,secondaryLauncherShortcut:false,quickSettingsTileShortcut:false,launcherShortcut:false,runInForegroundService:false,excludeFromHistory:true,excludeFromFileSharing:true,responseHandling:{successOutput:'none',failureOutput:'none',uiType:'dialog'}};
 return {version:90,compatibilityVersion:90,categories:[{id:'fe7abab1-19bb-5dfd-8e48-d09215cd31e2',name:'灵感入口·交互测试',shortcuts:[shortcut('07d8e220-d3af-54db-baaa-87cf1add6008','收下链接＋一句话',false,true),shortcut('d3cad976-f743-4d3f-8fd2-60d299922b35','重试待上传灵感',true,false),shortcut('d39cc759-0df0-485f-beb5-9e4e28b6c4f1','补充点点总结',false,false,true),transport]}],variables:[
  {id:'eec440a1-b848-4d44-bdab-b0640fbd4bc4',key:'inspiration_cloud_auth',type:'constant',value:JSON.stringify({endpoint,deviceToken}),isExcludeValueFromExport:true,isSecret:true,urlEncode:false,jsonEncode:false},
  // HTTP Shortcuts preserves an existing excluded variable when value is omitted.
  // A new variable starts empty; the script treats that as an empty outbox.
  {id:'b427ff70-00f4-4e33-a85c-1dbeb6840607',key:'inspiration_cloud_pending',type:'constant',isExcludeValueFromExport:true,urlEncode:false,jsonEncode:false},
  {id:'06af020d-14db-411d-9e7c-bfcb2ae96ead',key:'inspiration_cloud_receipt',type:'constant',isExcludeValueFromExport:true,urlEncode:false,jsonEncode:false}
 ]};
}
export function deviceRepairConfig(endpoint){const config=deviceConfig(endpoint,'');config.variables=config.variables.filter(v=>v.key==='inspiration_cloud_receipt');return config;}
export async function verifyDeviceGateway(env,device,key){
 const origin=env.CAPTURE_GATEWAY_URL;
 const call=async(path,method,payload,credential)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  try{const options={method,redirect:'manual',signal:controller.signal,headers:{...(payload?{'Content-Type':'application/json'}:{}),...(credential?{Authorization:'Bearer '+credential}:{})},...(payload?{body:JSON.stringify(payload)}:{})};
   const res=env.GATEWAY_FETCH?await env.GATEWAY_FETCH(origin+path,options):await globalThis.fetch(origin+path,options);
   let data;try{data=await res.json();}catch{throw new Problem(502,'gateway_invalid_response','手机网关未返回有效回执。');}
   return {status:res.status,data};
  }finally{clearTimeout(timer);}
 };
 const id='device-check-'+device.id,summaryId='device-summary-'+device.id,url='https://example.com/inspiration-mobile-gateway?device='+device.id;
 const p={id,raw:url,url,personalComment:'公开模拟测试：手机接口开通验证',createdAt:device.created_at,isDiandian:false};
 try{
  const denied=await call('/api/capture','POST',p);
  const noQuery=await call('/api/events','GET');
  if(denied.status!==401||noQuery.status!==404)throw new Problem(502,'gateway_access_check','手机网关权限检查未通过，暂不要正式使用。');
  const first=await call('/api/capture','POST',p,key),again=await call('/api/capture','POST',p,key);
  const valid=(r,event)=>r.status===200&&r.data?.ok===true&&r.data.state==='synced'&&r.data.id===event&&r.data.pageId;
  if(!valid(first,id)||!valid(again,id)||first.data.pageId!==again.data.pageId)throw new Problem(502,first.data?.code||again.data?.code||'gateway_write_check','手机网关尚未确认测试写入或重复提交。请保留这份配置并重新检查。');
  const summary=await call('/api/capture','POST',{...p,id:summaryId,raw:'模拟点点总结：用于验证手机接口后续追加，不代表真实 AI 输出。',personalComment:'',isDiandian:true},key);
  if(!valid(summary,summaryId)||summary.data.pageId!==first.data.pageId)throw new Problem(502,summary.data?.code||'gateway_summary_check','测试链接已保存，总结补充尚未确认。请沿用这份配置重新检查。');
  return {ok:true,id,summaryId,pageId:first.data.pageId,notionUrl:first.data.notionUrl,message:'公网网关验证通过：拒绝未授权及查询请求；已真实写入 Notion，重复提交同页，总结追加同页。'};
 }catch(e){const code=e instanceof Problem?e.code:'gateway_network';console.warn(JSON.stringify({event:'gateway_verification_failed',code,id}));return {ok:false,id,summaryId,code,message:e instanceof Problem?e.message:'连接手机网关中断，未确认测试写入。请保留本页配置，点击重新检查。'};}
}
async function handle(req,env){
 const u=new URL(req.url),path=u.pathname;
 if(path==='/api/capture'&&req.method==='POST')return capture(req,env,await auth(req,env));
 if(path.startsWith('/api/')){
  requireOwner(req,env);if(req.method!=='GET')requireOrigin(req);
  if(path==='/api/setup'&&req.method==='GET')return json({configured:!!await one(env,"SELECT key FROM config WHERE key='notion'"),databaseUrl:databaseURL(env),dataSource:sourceID(env),gatewayReady:!!env.CAPTURE_GATEWAY_URL});
  if(path==='/api/setup'&&req.method==='POST'){
   const p=await body(req);if(typeof p.token!=='string'||!/^(ntn_|secret_)[a-zA-Z0-9_-]{20,200}$/.test(p.token))fail(400,'invalid_token','请填写内部连接的 API 密钥。');
   const source=await notion(env,'/data_sources/'+sourceID(env),'GET',undefined,p.token),expected={'标题':'title','原始链接':'url','原始内容':'rich_text','我的个人评论':'rich_text','来源':'rich_text','内容类型':'select','收集时间':'date','含点点已有总结':'checkbox','处理状态':'select','点点总结':'rich_text','入口记录ID':'rich_text'};
   if(source.id!==sourceID(env)||Object.entries(expected).some(([k,v])=>source.properties?.[k]?.type!==v))fail(409,'schema_mismatch','测试库字段与预期不一致，未保存密钥。');
   await run(env,"INSERT INTO config(key,value) VALUES('notion',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",await seal(env,p.token));return json({ok:true,message:'已连接指定测试库；密钥已在服务端加密保存。'});
  }
  if(path==='/api/devices'&&req.method==='GET')return json({devices:(await env.DB.prepare('SELECT id,label,created_at,revoked_at FROM devices ORDER BY created_at DESC LIMIT 50').all()).results});
  if(path==='/api/devices/repair'&&req.method==='GET'){
   if(!env.CAPTURE_GATEWAY_URL)fail(503,'gateway_not_ready','手机接口尚未配置。');
   return json({ok:true,config:deviceRepairConfig(env.CAPTURE_GATEWAY_URL+'/api/capture')});
  }
  if(path==='/api/devices'&&req.method==='POST'){
   if(!env.CAPTURE_GATEWAY_URL)fail(503,'gateway_not_ready','手机专用接口尚未发布；网页收集可先使用。');const p=await body(req),label=typeof p.label==='string'?p.label.trim():'';if(!label||label.length>50)fail(400,'invalid_label','请填写设备名称，最多 50 字。');
   const count=await one(env,'SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL');if(count.n>=20)fail(409,'too_many_devices','有效入口超过 20 个，请先撤销不用的入口。');
   const id=crypto.randomUUID(),key=random(),created_at=now();await run(env,'INSERT INTO devices(id,label,token_hash,created_at) VALUES(?,?,?,?)',id,label,await hash(key),created_at);return json({ok:true,id,config:deviceConfig(env.CAPTURE_GATEWAY_URL+'/api/capture',key),...(p.verify===true?{verification:await verifyDeviceGateway(env,{id,created_at},key)}:{})});
  }
  if(path==='/api/devices/check'&&req.method==='POST'){
   const p=await body(req);if(typeof p.id!=='string'||typeof p.deviceToken!=='string'||!/^[a-f0-9]{64}$/.test(p.deviceToken))fail(400,'invalid_device','缺少这份配置的设备授权。');
   const d=await one(env,'SELECT id,created_at FROM devices WHERE id=? AND token_hash=? AND revoked_at IS NULL',p.id,await hash(p.deviceToken));if(!d)fail(401,'device_auth_required','这份入口已撤销或无效。');
   return json({ok:true,verification:await verifyDeviceGateway(env,d,p.deviceToken)});
  }
  if(path==='/api/devices/revoke'&&req.method==='POST'){const p=await body(req);if(typeof p.id!=='string')fail(400,'invalid_id','缺少入口编号。');await run(env,'UPDATE devices SET revoked_at=? WHERE id=?',now(),p.id);return json({ok:true});}
  if(path==='/api/events'&&req.method==='GET')return json({events:(await env.DB.prepare('SELECT id,state,page_id,error_code,updated_at FROM events ORDER BY updated_at DESC LIMIT 30').all()).results});
  fail(404,'not_found','接口不存在。');
 }
 if(!['GET','HEAD'].includes(req.method))fail(405,'method_not_allowed','不支持此操作。');
 if(['/setup','/setup.html','/verify','/verify.html','/phone-repair','/phone-repair.html','/','/cloud.html'].includes(path))requireOwner(req,env);
 if(path==='/local/')return Response.redirect(u.origin+'/local',302);
 const key=path==='/'?'/cloud.html':path==='/setup'?'/setup.html':path==='/verify'?'/verify.html':path==='/phone-repair'?'/phone-repair.html':path==='/phone-test'?'/phone-test.html':path==='/local'?'/index.html':path,asset=ASSETS[key];
 if(!asset)return new Response('未找到页面',{status:404});
 return new Response(req.method==='HEAD'?null:Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",...(asset.type==='application/zip'?{'Content-Disposition':'attachment'}:{})}});
}
export default {async fetch(req,env){try{return await handle(req,env);}catch(e){if(e instanceof Problem)return json({ok:false,code:e.code,message:e.message,...(e.extra.retryAfter?{retryAfter:e.extra.retryAfter}:{})},e.status,e.extra.retryAfter?{'Retry-After':String(e.extra.retryAfter)}:{});return json({ok:false,code:'server_error',message:'服务暂时不可用，未确认写入。'},503);}}};
