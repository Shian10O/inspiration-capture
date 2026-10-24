import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{seal} from '../worker/index.js';
test('standalone never trusts a caller-supplied Sites owner header',async()=>{
 const headers={'oai-authenticated-user-email':'owner@example.com','Content-Type':'application/json',Origin:'https://capture.example.test'};
 const env={OWNER_EMAIL:'owner@example.com',IDENTITY_PROVIDER:'none'};
 assert.equal((await worker.fetch(new Request('https://capture.example.test/api/setup',{headers}),env)).status,403);
 assert.equal((await worker.fetch(new Request('https://capture.example.test/api/capture',{method:'POST',headers,body:'{}'}),env)).status,401);
});
test('portable encrypted configuration is bound to an explicitly configured data source',async()=>{
 const env={CONFIG_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')};
 await assert.rejects(()=>seal(env,'test'),/Notion/);
 const a=await seal({...env,NOTION_DATA_SOURCE_ID:'11111111-1111-4111-8111-111111111111'},'test');
 assert(!a.includes('test'));
});
