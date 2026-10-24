import {configZip} from './config-zip.js';
const $=id=>document.getElementById(id);
async function api(path,body){const r=await fetch(path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});let d;try{d=await r.json();}catch{throw Error('服务器回执无效。');}if(!r.ok||d.ok===false)throw Error(d.message||'操作失败。');return d;}
async function refresh(){try{const s=await api('/api/setup');$('database').href=s.databaseUrl;$('status').textContent=s.configured?'已连接指定测试库，无需重新填写密钥。':'尚未连接 Notion。请先填写内部连接密钥。';$('pair').querySelector('button').disabled=!s.gatewayReady||!s.configured;$('pair-status').textContent=s.gatewayReady?'手机专用接口已就绪。':'手机专用接口尚未发布；当前请继续使用私有网页。';const d=await api('/api/devices');$('devices').replaceChildren();for(const row of d.devices){const p=document.createElement('p');p.textContent=row.label+' · '+(row.revoked_at?'已撤销':'有效')+' ';if(!row.revoked_at){const b=document.createElement('button');b.textContent='撤销这个入口';b.onclick=async()=>{b.disabled=true;try{await api('/api/devices/revoke',{id:row.id});await refresh();}catch(e){$('pair-status').textContent=e.message;b.disabled=false;}};p.append(b);}$('devices').append(p);}}catch(e){$('status').textContent=e.message;}}
$('setup').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;let value=$('token').value.trim();$('token').value='';$('status').textContent='正在核对测试库访问权限…';try{const result=await api('/api/setup',{token:value});value='';$('status').textContent=result.message;}catch(e){$('status').textContent=e.message;}finally{value='';b.disabled=false;}};
let lastURL,currentPair,busy=false;
async function checkCurrent(){
 if(!currentPair)return;
 $('check-gateway').hidden=false;$('check-gateway').disabled=true;
 $('check-result').replaceChildren();
 $('pair-status').textContent='配置已下载。正在通过公网网关测试真实 Notion 写入、同编号重试和总结补充，请稍候…';
 try{
  const auth=JSON.parse(currentPair.config.variables.find(v=>v.key==='inspiration_cloud_auth').value);
  const result=await api('/api/devices/check',{id:currentPair.id,deviceToken:auth.deviceToken}),v=result.verification;
  $('pair-status').textContent=v.ok?v.message+' 配置可导入 HTTP Shortcuts，选择“合并”。':'尚未通过：'+v.message+' 请保留这份配置，使用下方按钮重新检查，不要重复生成授权。';
  if(v.ok&&v.notionUrl){const link=document.createElement('a');link.href=v.notionUrl;link.target='_blank';link.rel='noreferrer';link.textContent='打开刚写入的公开测试记录';$('check-result').replaceChildren(link);}
 }catch(e){$('pair-status').textContent='尚未确认网关验证：'+e.message+' 请保留配置并点“重新检查这份配置”。';}
 finally{$('check-gateway').disabled=false;}
}
$('check-gateway').onclick=async()=>{if(busy)return;busy=true;try{await checkCurrent();}finally{busy=false;}};
$('pair').onsubmit=async e=>{
 e.preventDefault();if(busy)return;busy=true;const b=e.submitter;b.disabled=true;
 $('pair-status').textContent='正在创建可撤销的本机入口…';
 try{
  const r=await api('/api/devices',{label:$('label').value});currentPair=r;
  if(lastURL)URL.revokeObjectURL(lastURL);
  lastURL=URL.createObjectURL(new Blob([configZip(r.config)],{type:'application/zip'}));
  const a=document.createElement('a');a.href=lastURL;a.download='inspiration-'+r.id+'.zip';a.textContent='下载这份手机配置（不要转发）';
  $('download').replaceChildren(a);$('check-result').replaceChildren();a.click();
  await refresh();b.disabled=true;await checkCurrent();
 }catch(e){$('pair-status').textContent=e.message;}
 finally{busy=false;b.disabled=false;}
};
refresh();
