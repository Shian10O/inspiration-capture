import assert from 'node:assert/strict';
import vm from 'node:vm';
import {deviceConfig,deviceRepairConfig} from '../dist/server/index.js';
import {configZip} from '../web/config-zip.js';
import {crc32} from 'node:zlib';

// Public fixtures only. No real credential is generated or exported here.
const config=deviceConfig('https://gateway.invalid/api/capture','0'.repeat(64));
const shortcuts=config.categories[0].shortcuts;
for(const s of shortcuts.filter(s=>s.executionType==='scripting')){
 assert(s.codeOnPrepare.length>1000);
 assert(!/__RETRY_ONLY__|__SUMMARY_MODE__|EMBED_PHONE/.test(s.codeOnPrepare));
 assert(!/OAI-Sites-Authorization|SITE_SERVICE_TOKEN|ntn_/.test(s.codeOnPrepare));
 new vm.Script(s.codeOnPrepare);
}
const transport=shortcuts.find(s=>s.executionType==='app');
assert.equal(transport.timeout,60000);
assert.equal(transport.url,'https://gateway.invalid/api/capture');
assert.equal(transport.bodyContent,'{{inspiration_request_body}}');
for(const code of [transport.codeOnSuccess,transport.codeOnFailure]){assert(code.includes('inspiration_cloud_receipt'));assert(code.includes('setResult'));new vm.Script(code);}
const repair=deviceRepairConfig('https://gateway.invalid/api/capture');
assert.deepEqual(repair.variables.map(v=>v.key),['inspiration_cloud_receipt']);
assert(!Object.hasOwn(repair.variables[0],'value'));
assert(!JSON.stringify(repair).includes('0'.repeat(64)));
const zip=configZip(config),v=new DataView(zip.buffer),n=v.getUint16(26,true),length=v.getUint32(18,true),bytes=zip.slice(30+n,30+n+length);
assert.equal(v.getUint32(14,true),crc32(bytes));
assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)),config);
assert(!Object.hasOwn(config.variables.find(v=>v.key==='inspiration_cloud_pending'),'value'));
console.log(JSON.stringify({compiledPhoneScripts:3,hiddenTransport:true,explicitReceipt:true,repairPreservesAuthAndQueue:true,zipValid:true,queueInitializationOmitted:true,bytes:zip.length,liveCredential:false}));
