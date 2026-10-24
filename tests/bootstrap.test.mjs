import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

test('offline fresh-install package imports into schema, encrypts credentials and prints no secrets',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capture-bootstrap-'));
 try{
  for(const sub of ['tools','dist/server','web'])mkdirSync(join(dir,sub),{recursive:true});
  for(const file of ['tools/prepare-self-host.mjs','dist/server/index.js','web/config-zip.js'])copyFileSync(new URL('../'+file,import.meta.url),join(dir,file));
  const input={dataSource:'11111111-1111-4111-8111-111111111111',notionToken:'ntn_test_secret_never_in_client',endpoint:'https://capture.example.test/api/capture'};
  const result=spawnSync(process.execPath,[join(dir,'tools/prepare-self-host.mjs')],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  const sql=readFileSync(join(dir,'.private/bootstrap.sql'),'utf8'),secrets=JSON.parse(readFileSync(join(dir,'.private/runtime-secrets.json'),'utf8'));
  assert(!sql.includes(input.notionToken));assert(!result.stdout.includes(input.notionToken));assert(!result.stdout.includes(secrets.CONFIG_ENCRYPTION_KEY));
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0000_absurd_gabe_jones.sql',import.meta.url),'utf8'));db.exec(sql);
  const crypt=JSON.parse(db.prepare("SELECT value FROM config WHERE key='notion'").get().value);
  const key=await crypto.subtle.importKey('raw',Buffer.from(secrets.CONFIG_ENCRYPTION_KEY,'base64'),'AES-GCM',false,['decrypt']);
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(crypt.iv,'base64'),additionalData:new TextEncoder().encode(input.dataSource)},key,Buffer.from(crypt.cipher,'base64'));
  assert.equal(new TextDecoder().decode(decrypted),input.notionToken);
  const zip=readFileSync(join(dir,'.private/phone-import.zip'));assert.equal(zip.readUInt32LE(0),0x04034b50);
  const start=30+zip.readUInt16LE(26)+zip.readUInt16LE(28),config=JSON.parse(zip.subarray(start,start+zip.readUInt32LE(18)));
  const auth=JSON.parse(config.variables.find(v=>v.key==='inspiration_cloud_auth').value);
  assert.equal(auth.endpoint,input.endpoint);assert(!JSON.stringify(config).includes(input.notionToken));
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(auth.deviceToken))).toString('hex');
  assert.equal(db.prepare('SELECT token_hash FROM devices').get().token_hash,digest);db.close();
 }finally{
  const target=resolve(dir),parent=resolve(tmpdir());
  if(!target.startsWith(parent)||!target.slice(parent.length).match(/^[\\/]capture-bootstrap-[A-Za-z0-9]+$/))throw Error('Unsafe cleanup target');
  rmSync(target,{recursive:true,force:true});
 }
});
