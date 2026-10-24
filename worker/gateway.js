// Authenticated ingress only. This deployment serves no owner UI or collection data.
// UPSTREAM_SERVICE_TOKEN is used exclusively by this server and is never returned.
const reply=(code,message,status)=>new Response(JSON.stringify({ok:false,code,message}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});

export default {async fetch(req,env){
 const u=new URL(req.url);
 let PRIVATE_ORIGIN;try{const configured=new URL(env.ALLOWED_UPSTREAM_ORIGIN);if(configured.protocol!=='https:'||configured.username||configured.password||configured.origin!==env.ALLOWED_UPSTREAM_ORIGIN)throw Error('invalid');PRIVATE_ORIGIN=configured.origin;}catch{return reply('not_ready','上游白名单未配置。',503);}
 if(u.pathname!=='/api/capture'||u.search||req.method!=='POST')return reply('not_found','此入口仅接收已授权的收集提交。',404);
 const auth=req.headers.get('Authorization')||'';
 if(!/^Bearer [a-f0-9]{64}$/.test(auth))return reply('device_auth_required','收集入口未授权。',401);
 if(!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return reply('json_required','需要 JSON 请求。',415);
 if(req.headers.has('Origin'))return reply('native_entry_only','请使用已授权的手机快捷入口；网页请使用私有收集页。',403);
 if(env.UPSTREAM_ORIGIN!==PRIVATE_ORIGIN||!env.UPSTREAM_SERVICE_TOKEN)return reply('not_ready','接口尚未就绪。',503);
 const reader=req.body?.getReader();if(!reader)return reply('empty_body','内容为空。',400);
 const chunks=[];let size=0;
 for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>64000){await reader.cancel();return reply('too_large','内容过长。',413);}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.length;}
 let parsed;try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply('invalid_json','提交内容格式错误。',400);}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||typeof parsed.id!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(parsed.id))return reply('invalid_id','缺少有效收集编号。',400);
 let res,data;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
 try{
  const options={method:'POST',redirect:'manual',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:auth,'OAI-Sites-Authorization':'Bearer '+env.UPSTREAM_SERVICE_TOKEN},body:bytes};
  res=env.UPSTREAM_FETCH?await env.UPSTREAM_FETCH(PRIVATE_ORIGIN+'/api/capture',options):await globalThis.fetch(PRIVATE_ORIGIN+'/api/capture',options);
  if(res.status>=300&&res.status<400)return reply('upstream_unconfirmed','服务跳转未被跟随；未确认上传，请保留原编号重试。',502);
  data=await res.json();
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid receipt');
  if(res.ok&&!(res.status===200&&data.ok===true&&data.state==='synced'&&data.id===parsed.id&&typeof data.pageId==='string'&&data.pageId))throw Error('invalid receipt');
 }catch{return reply('upstream_unconfirmed','网络中断或回执无效，尚未确认写入；请保留原收集编号重试。',502);}
 finally{clearTimeout(timer);}
 // Return a fixed, non-sensitive result schema. Never forward headers or arbitrary payloads.
 const output={ok:data.ok===true};
 for(const k of ['code','message','state','id','pageId','notionUrl'])if(typeof data[k]==='string')output[k]=data[k];
 if(Number.isFinite(data.retryAfter))output.retryAfter=data.retryAfter;
 return new Response(JSON.stringify(output),{status:res.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(res.headers.get('Retry-After')?{'Retry-After':res.headers.get('Retry-After')}:{})}});
}};
