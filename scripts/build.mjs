import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const files={};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.zip':'application/zip'};
for(const name of await readdir(resolve(root,'web'))){
 const bytes=await readFile(resolve(root,'web',name));
 files['/'+name]={body:bytes.toString('base64'),type:types[extname(name)]||'application/octet-stream'};
}
let code=await readFile(resolve(root,'worker/index.js'),'utf8');
code=code.replace('/* EMBED_ASSETS */ {}',JSON.stringify(files));
code=code.replace('/* EMBED_PHONE_SCRIPT */ ""',JSON.stringify(await readFile(resolve(root,'worker/phone.js.txt'),'utf8')));
const manifest=await readFile(resolve(root,'.openai/hosting.json'),'utf8');
if(JSON.parse(manifest).static)throw Error('Worker manifest must not contain static');
await mkdir(resolve(root,'dist/server'),{recursive:true});
await mkdir(resolve(root,'dist/.openai'),{recursive:true});
await writeFile(resolve(root,'dist/server/index.js'),code);
await writeFile(resolve(root,'dist/.openai/hosting.json'),manifest);
const mod=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
if(typeof mod.default.fetch!=='function')throw Error('Missing Worker fetch');
console.log('Built Worker with preserved local prototype and protected cloud entry.');
