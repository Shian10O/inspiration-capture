const $=id=>document.getElementById(id),KEY='inspiration-live-verification-v1';let busy=false;
function display(s){const p=document.createElement('p');p.textContent=s;$('results').append(p);}
function load(){return JSON.parse(localStorage.getItem(KEY)||'null');}
function save(s){localStorage.setItem(KEY,JSON.stringify(s));}
function fixture(kind){const id=crypto.randomUUID(),url='https://example.com/inspiration-'+kind+'?test='+id;return {id,raw:url,url,personalComment:'公开测试：'+(kind==='duplicate'?'同编号重复提交':'请求中断后使用原编号重试'),createdAt:new Date().toISOString(),isDiandian:false};}
async function submit(p,signal){const controller=signal?null:new AbortController(),timer=controller?setTimeout(()=>controller.abort(),45000):null;try{const r=await fetch('/api/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p),signal:signal||controller.signal});let d;try{d=await r.json();}catch(e){if(e.name==='AbortError')throw e;throw Error('未收到有效回执；测试编号已保留。');}if(!r.ok||d.ok!==true||d.state!=='synced'||d.id!==p.id||!d.pageId){const e=Error(d.message||'尚未确认写入。');e.retryable=['in_progress','retry_later'].includes(d.code);throw e;}return d;}finally{if(timer)clearTimeout(timer);}}
async function retryOriginal(p){for(let i=0;i<4;i++){try{return await submit(p);}catch(e){if(!e.retryable||i===3)throw e;await new Promise(r=>setTimeout(r,2000));}}}
async function run(continuing){if(busy)return;busy=true;$('run').disabled=true;$('resume').disabled=true;$('results').replaceChildren();try{
 let s=load();if(!s){if(continuing)throw Error('本机还没有这轮测试，请先运行公开测试。');s={duplicate:fixture('duplicate'),interrupted:fixture('interrupted')};save(s);}
 $('state').textContent='正在核对同编号重复提交…';
 const a=await retryOriginal(s.duplicate);s.duplicatePage=a.pageId;save(s);
 const b=await retryOriginal(s.duplicate);if(a.pageId!==b.pageId)throw Error('重复请求返回了不同页面，未通过。');
 display('通过：同编号两次提交返回同一页面。收集编号 '+s.duplicate.id);s.duplicatePassed=true;save(s);
 if(!s.interruptionAttempted){
  $('state').textContent='正在主动中止一次网络请求…';s.interruptionAttempted=true;save(s);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),100);
  try{await submit(s.interrupted,controller.signal);s.cancellationObserved=false;display('请求在中止前已完成，本次没有观察到中断，不能算中断验证通过。');}
  catch(e){s.cancellationObserved=e.name==='AbortError';display(s.cancellationObserved?'已观察到请求中止；原编号仍保存在本机。':'中断尝试未获得确定结果；将用原编号核对。');}
  finally{clearTimeout(timer);save(s);}
 }
 $('state').textContent='正在用原编号恢复提交并核对回执…';const c=await retryOriginal(s.interrupted);s.interruptedPage=c.pageId;s.recoveryConfirmed=true;save(s);
 display('通过：原编号已收到 Notion 保存回执。收集编号 '+s.interrupted.id);
 $('state').textContent=s.cancellationObserved?'两项公开验证通过。请回复此结果，由助手回读 Notion 核对只有两条测试记录。':'重复提交通过；恢复提交已确认，但本次未观察到请求中止，不能声明中断场景通过。';
 }catch(e){$('state').textContent='尚未全部通过：'+e.message+' 请保留本页测试，稍后点“继续核对原测试”，不要另建编号。';}finally{busy=false;$('run').disabled=false;$('resume').disabled=false;}}
$('run').onclick=()=>run(false);$('resume').onclick=()=>run(true);try{const s=load();if(s)$('state').textContent='本机已有这一轮测试，将继续使用原编号。';}catch{$('state').textContent='本机测试状态无法读取，请保留原数据并反馈，暂不覆盖。';$('run').disabled=true;$('resume').disabled=true;}
