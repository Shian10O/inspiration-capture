import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../worker/gateway.js';
const url='https://gateway.test/api/capture';
const origin='https://capture.example.test';
const request=(body=JSON.stringify({id:'public-gateway-test-id'}),extra={})=>new Request(url,{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json',...extra},body});
test('gateway rejects missing device token, read requests, unrelated paths, and browser origins',async()=>{
 const request=(path,options={})=>gateway.fetch(new Request(path,options),{ALLOWED_UPSTREAM_ORIGIN:origin});
 assert.equal((await request(url,{method:'POST'})).status,401);
 assert.equal((await request(url)).status,404);
 assert.equal((await request('https://gateway.test/api/setup',{method:'POST'})).status,404);
 assert.equal((await request(url,{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'})).status,403);
});
test('gateway forwards service credential only upstream and returns a fixed safe schema',async()=>{
 const original=globalThis.fetch;let outgoing;
 globalThis.fetch=async(target,options)=>{outgoing={target,options};return Response.json({ok:false,code:'device_auth_required',message:'已撤销',internalToken:'must-not-return'},{status:401,headers:{'Set-Cookie':'must-not-forward'}});};
 try{const response=await gateway.fetch(request(undefined,{'oai-authenticated-user-email':'forged@example.com',Cookie:'fake-owner-cookie','OAI-Sites-Authorization':'Bearer forged-service'}),{UPSTREAM_ORIGIN:origin,ALLOWED_UPSTREAM_ORIGIN:origin,UPSTREAM_SERVICE_TOKEN:'server-only-test-value'});
 assert.equal(outgoing.target,origin+'/api/capture');assert.equal(outgoing.options.headers['OAI-Sites-Authorization'],'Bearer server-only-test-value');assert(!('Cookie' in outgoing.options.headers));assert(!('oai-authenticated-user-email' in outgoing.options.headers));assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.status,401);const text=await response.text();assert(!text.includes('server-only'));assert(!text.includes('must-not-return'));
 }finally{globalThis.fetch=original;}
});

test('gateway bounds payloads and fixes the upstream before sending service credentials',async()=>{
 let calls=0;const env={UPSTREAM_ORIGIN:origin,ALLOWED_UPSTREAM_ORIGIN:origin,UPSTREAM_SERVICE_TOKEN:'server-only',UPSTREAM_FETCH:()=>{calls++;throw Error('must not call');}};
 assert.equal((await gateway.fetch(request('x'.repeat(64001)),env)).status,413);
 assert.equal((await gateway.fetch(request('not json'),env)).status,400);
 assert.equal((await gateway.fetch(request('{}'),env)).status,400);
 assert.equal((await gateway.fetch(request(),{...env,UPSTREAM_ORIGIN:'https://evil.test'})).status,503);
 assert.equal(calls,0);
});

test('gateway never confirms a redirect, broken body or mismatched provider receipt',async()=>{
 for(const response of [new Response(null,{status:302,headers:{Location:'https://evil.test'}}),new Response('<html>login</html>'),Response.json({ok:true,state:'synced',id:'wrong-id',pageId:'p'}),Response.json({ok:true})]){
  const r=await gateway.fetch(request(),{UPSTREAM_ORIGIN:origin,ALLOWED_UPSTREAM_ORIGIN:origin,UPSTREAM_SERVICE_TOKEN:'server-only',UPSTREAM_FETCH:async(u,o)=>{assert.equal(o.redirect,'manual');assert(o.signal instanceof AbortSignal);return response;}});
  assert.equal(r.status,502);assert.equal((await r.json()).ok,false);
 }
});
