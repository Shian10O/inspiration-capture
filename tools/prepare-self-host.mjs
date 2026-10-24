// Offline operator packaging only. It does not deploy or contact Notion.
// Read secrets from private stdin, never command-line arguments or output.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {seal,hash,deviceConfig} from '../dist/server/index.js';
import {configZip} from '../web/config-zip.js';
if(process.stdin.isTTY)throw Error('Use a private JSON file through stdin; never put credentials in arguments. See README.');
const parts=[];for await(const chunk of process.stdin)parts.push(chunk);
const p=JSON.parse(Buffer.concat(parts).toString());
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.dataSource||''))throw Error('Invalid dataSource UUID');
if(!/^(ntn_|secret_)[a-zA-Z0-9_-]{20,200}$/.test(p.notionToken||''))throw Error('Invalid internal connection token');
const url=new URL(p.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/api/capture'||url.search||url.hash)throw Error('Use your HTTPS /api/capture endpoint');
const env={NOTION_DATA_SOURCE_ID:p.dataSource,CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('base64')},deviceToken=randomBytes(32).toString('hex'),id=randomUUID(),date=new Date().toISOString();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const encrypted=await seal(env,p.notionToken);
const sql="INSERT INTO config(key,value) VALUES('notion',"+quote(encrypted)+");\nINSERT INTO devices(id,label,token_hash,created_at) VALUES("+[id,p.label||'My Android',await hash(deviceToken),date].map(quote).join(',')+");\n";
const dir=new URL('../.private/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});
await writeFile(new URL('bootstrap.sql',dir),sql,{mode:0o600});
await writeFile(new URL('runtime-secrets.json',dir),JSON.stringify({CONFIG_ENCRYPTION_KEY:env.CONFIG_ENCRYPTION_KEY}),{mode:0o600});
await writeFile(new URL('phone-import.zip',dir),configZip(deviceConfig(url.href,deviceToken)),{mode:0o600});
await writeFile(new URL('device.json',dir),JSON.stringify({id,label:p.label||'My Android',createdAt:date},null,2),{mode:0o600});
console.log(JSON.stringify({prepared:true,deviceId:id,files:['.private/bootstrap.sql','.private/runtime-secrets.json','.private/phone-import.zip','.private/device.json'],deployed:false}));
