import {liveCandidateCounts} from '/candidate-counts.mjs';
const el=id=>document.getElementById(id);
// Re-enter the role when a participant opens a different invitation in this tab.
window.addEventListener('hashchange',()=>location.reload());
const params=new URLSearchParams(location.hash.slice(1));
const credentials={id:params.get('room'),role:params.get('role'),token:params.get('token')};
let state=null,busy=false,offset=0,pollTimer,closed=false,receivedFile=null;
const names={sender:'Alice · Sender',receiver:'Bob · Receiver',attacker:'Eve · Attacker'};
function error(message){el('error').textContent=message;el('error').hidden=!message;}
async function api(data){
  const response=await fetch('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok){const failure=new Error(result.error||'Unable to connect.');failure.status=response.status;throw failure;}return result;
}
function lock(value){busy=value;document.querySelectorAll('button').forEach(b=>b.disabled=value);}
async function update(action='poll',extra={}){
  if(busy||closed)return;
  lock(true);
  try{const result=await api({...credentials,action,...extra});state=result;offset=result.now-Date.now();error('');el('connection').textContent='Connected · updates every 3 s';await verifyReceivedFile();render();}
  catch(e){closed=[403,404,410].includes(e.status);error(e.message);el('connection').textContent=closed?'Session unavailable':'Disconnected · retrying';el('channel').classList.remove('running');el('key-id').textContent='Unavailable';el('key-preview').textContent='Key validity cannot be confirmed while disconnected.';el('alert').classList.add('danger');el('alert').textContent='Shared state unavailable. Wait for reconnection before trusting the displayed round history.';}
  finally{lock(false);clearTimeout(pollTimer);if(!closed)pollTimer=setTimeout(()=>update(),3000);}
}
el('create').addEventListener('submit',async event=>{
  event.preventDefault();lock(true);error('');
  try{
    const room=await api({action:'create',protocol:el('live-protocol').value,authenticated:el('authenticated').checked});
    el('lobby').hidden=true;el('invitations').hidden=false;
    for(const role of Object.keys(names)){
      const url=new URL('/live.html',location.origin);url.hash=new URLSearchParams({room:room.id,role,token:room.tokens[role]}).toString();
      const card=document.createElement('article');card.className='invite';
      const h=document.createElement('h2');h.textContent=names[role];
      const field=document.createElement('input');field.readOnly=true;field.value=url.href;field.setAttribute('aria-label',`${role} invitation link`);
      const copy=document.createElement('button');copy.textContent='Copy link';copy.onclick=async()=>{try{await navigator.clipboard.writeText(url.href);copy.textContent='Copied';}catch{field.select();error('Select and copy the invitation link.');}};
      const open=document.createElement('a');open.href=url.href;open.target='_blank';open.rel='noopener';open.className='role-link';open.textContent=`Open ${role} ↗`;
      card.append(h,field,copy,open);el('links').append(card);
    }
  }catch(e){error(e.message);}finally{lock(false);}
});
el('start').onclick=()=>update('start');el('stop').onclick=()=>update('stop');el('join').onclick=()=>update('join');
el('apply-attack').onclick=()=>update('attack',{attack:el('live-attack').value});
el('upload-file').onclick=async()=>{
  const file=el('telemetry-file').files[0];
  if(!file||file.size<1||file.size>24576){error('Choose a telemetry file between 1 byte and 24 KiB.');return;}
  const bytes=new Uint8Array(await file.arrayBuffer());
  await update('upload',{name:file.name,data:btoa(String.fromCharCode(...bytes))});
};
async function verifyReceivedFile(){
  const t=state.transfer;
  if(credentials.role!=='receiver'||!t||t.delivered!==t.size){receivedFile=null;return;}
  const bytes=Uint8Array.from(atob(t.data),c=>c.charCodeAt(0));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==t.size||hash!==t.sha256){receivedFile=null;throw new Error('Received file does not match the sender. Download blocked.');}
  receivedFile={bytes,name:t.name};
  if(!t.verified)state=await api({...credentials,action:'receipt',sha256:hash});
}
el('download-file').onclick=()=>{
  if(!receivedFile)return;
  const url=URL.createObjectURL(new Blob([receivedFile.bytes],{type:'application/octet-stream'}));
  const a=document.createElement('a');a.href=url;a.download=receivedFile.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function phase(){
  if(!state)return;
  const p=state.rounds.length===30?1:state.running?Math.max(0,Math.min(1,(Date.now()+offset-(state.next-state.roundMs))/state.roundMs)):0;
  el('progress').value=p;
  el('phase').textContent=state.rounds.length===30?`${state.protocol} · 30 rounds complete`:!state.running?'Session paused':p<.7?'1 · Sending and measuring quantum states':p<.85?'2 · Sifting measurement results':p<1?'3 · Testing errors and authenticating':'Awaiting server result…';
  el('progress-label').textContent=state.rounds.length===30?'All 30 rounds finished. See the file receipt and protocol outcome below.':state.running?`${Math.min(100000,Math.floor(p/.7*100000)).toLocaleString()} / 100,000 illustrative pulses · round ends in ${Math.max(0,Math.ceil((state.next-Date.now()-offset)/1000))} s`:state.rounds.length?'Experiment paused. The sender can resume; received chunks are retained.':'Join the receiver, then start from the sender screen.';
  el('channel').classList.toggle('running',state.running&&p<.7&&el('connection').textContent.startsWith('Connected'));
  el('data-channel').classList.toggle('running',!!state.transfer&&state.running&&!state.quarantine&&!!state.key&&state.transfer.delivered<state.transfer.size&&el('connection').textContent.startsWith('Connected'));
}
function render(){
  const s=state,last=s.rounds.at(-1),eve=credentials.role==='attacker';
  const candidateCounts=liveCandidateCounts(s.rounds);
  for(const [key,value] of Object.entries(candidateCounts))el('candidate-'+key).textContent=value;
  el('round-label').textContent=`${s.protocol} · ${s.rounds.length} completed / 30`;
  el('join').hidden=s.joined;
  el('telemetry-file').disabled=s.running||s.rounds.length>0;
  el('upload-file').hidden=s.running||s.rounds.length>0;
  el('start').hidden=s.running||s.rounds.length===30;
  el('stop').hidden=!s.running;
  el('alert').classList.toggle('danger',s.quarantine||!s.authenticated);
  el('alert').textContent=s.quarantine?(last?.authFailed?'Identity verification failed. Current key revoked.':'Disturbance or insufficient private-key budget detected. Current key rejected.')+` Communication blocked; ${s.clean}/2 clean recovery rounds completed.`:
    !s.authenticated?'Authentication is OFF: matching keys and low QBER do not verify who you are communicating with.':
    s.key?`Key ${s.key.id} accepted. Both endpoints have the same demo marker.`:s.joined?'Receiver joined. Ready for key generation.':'Waiting for receiver to join.';
  el('qber').textContent=last?`${(last.qber*100).toFixed(2)}%`:'—';el('bits').textContent=last?last.bits.toLocaleString():'—';
  el('key-id').textContent=s.key?.id||'None';el('key-preview').textContent=s.key?.preview||(eve?'No shared key visible to attacker':'No accepted key available');
  el('attack-state').textContent=eve?`Applied mode: ${s.attack}. Changes affect only the remaining part of the round, not past pulses.`:'';
  el('wire-label').textContent=eve&&s.attack!=='none'?'Interference applied':'Quantum channel';
  el('session-note').textContent=`Room expires ${new Date(s.expires).toLocaleTimeString()}. ${s.protocol}: 30 rounds × 12 seconds = 6 minutes of active experiment time. Two accepted clean rounds restore service after a rejection. This transfers a telemetry file, not live SCADA commands to real equipment.`;
  el('history').replaceChildren();
  for(const r of [...s.rounds].reverse()){
    const item=document.createElement('li');item.textContent=`Round ${r.id} · ${r.status} · QBER ${(r.qber*100).toFixed(2)}% · ${r.bits} estimated bits${r.keyId?` · ${r.keyId}`:''} · ${r.sentBytes||0} file bytes released${eve?` · Mode: ${r.attack}${r.compromised?' · New demo key compromised (unauthenticated MITM)':''}`:''}`;el('history').append(item);
  }
  el('trace').replaceChildren();
  if(eve)el('trace').textContent='Endpoint bits are private to their role in this teaching view. Eve cannot read accepted keys through the receiver link.';
  else for(const [i,t] of (last?.trace||[]).entries()){
    const bit=document.createElement('span');bit.textContent=`${i+1}: ${t.bit??'—'} / ${t.basis??'—'} · ${t.status}`;if(t.status==='error')bit.className='bad';el('trace').append(bit);
  }
  renderTransfer();drawChart(s.rounds);phase();
}
function renderTransfer(){
  const s=state,t=s.transfer;
  el('file-panel').hidden=!t;el('transfer-results').hidden=!t;
  if(!t)return;
  const complete=t.delivered===t.size,accepted=s.rounds.filter(r=>r.accepted).length,rejected=s.rounds.filter(r=>r.alarm).length;
  const blocked=s.rounds.filter(r=>r.transferBlocked).length;
  el('file-title').textContent=`${s.protocol} → control center → substation`;
  el('file-description').textContent=`${t.name} · ${t.size.toLocaleString()} bytes · ${Math.ceil(t.size/t.chunkSize)} chunks`;
  el('file-progress').value=t.delivered/t.size;
  el('file-status').textContent=`${t.delivered.toLocaleString()} / ${t.size.toLocaleString()} bytes released (${(100*t.delivered/t.size).toFixed(1)}%). ${blocked} blocked delivery rounds.`;
  el('data-state').textContent=complete?'All chunks released':s.quarantine?'BLOCKED · no accepted key':s.key?'Key accepted · releasing chunks':'Waiting for accepted key';
  el('receipt-status').textContent=t.verified?'Receiver confirmed: complete file received; SHA-256 matches.':complete?'All chunks ready. Waiting for the receiver to connect and verify the full file.':'Receiver is collecting file chunks. Download becomes available after full-file verification.';
  el('download-file').hidden=credentials.role!=='receiver'||!receivedFile;
  el('file-hash').textContent=t.sha256?`Sender's SHA-256: ${t.sha256}`:`Simulated exposure: ${t.exposed||0} bytes released with unauthenticated MITM keys.`;
  const outcome=t.finished?(t.verdict==='FILE TRANSFERRED'?'telemetry file received and verified':t.verdict==='TRANSFER INCOMPLETE'?'transfer incomplete':'awaiting receiver verification'):'experiment in progress';
  el('outcome-title').textContent=`${s.protocol} ${t.finished?'experiment complete':'experiment'} — ${outcome}`;
  const keyBits=s.rounds.filter(r=>r.accepted).reduce((sum,r)=>sum+r.bits,0);
  el('outcome-summary').textContent=`${s.protocol} produced ${accepted} accepted key rounds (${keyBits.toLocaleString()} estimated bits), with ${rejected} rejected rounds. These results released ${t.delivered.toLocaleString()} of ${t.size.toLocaleString()} telemetry bytes. ${t.finished&& !complete?`${t.size-t.delivered} bytes were not delivered within 30 rounds.`:t.verified?'The substation verified the exact sender file.':'Final success requires all bytes and receiver verification.'}`;
  el('outcome-security').textContent=`${t.security}. Delivery success and confidentiality are different: matching SHA-256 confirms file integrity, not a quantum security proof. ${s.protocol} key generation is modeled; actual file transport uses HTTPS.`;
  el('progress-chart-title').textContent=`${s.protocol} · cumulative file delivery (%)`;
  el('budget-chart-title').textContent=`${s.protocol} · estimated key bits per round`;
  transferChart('delivery-chart',s.rounds.map(r=>100*(r.deliveredBytes||0)/t.size),100,true);
  transferChart('throughput-chart',s.rounds.map(r=>r.sentBytes||0),1024,false);
  transferChart('budget-chart',s.rounds.map(r=>r.bits),Math.max(128,...s.rounds.map(r=>r.bits)),false);
}
function transferChart(id,values,max,line){
  const chart=el(id);chart.replaceChildren();
  const width=Math.max(280,Math.min(720,chart.clientWidth||720)),span=width-80;
  chart.setAttribute('viewBox',`0 0 ${width} 180`);
  function node(tag,attrs,text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;chart.append(n);}
  const y=v=>150-125*v/max;
  for(const value of [0,max/2,max]){node('line',{x1:55,y1:y(value),x2:width-20,y2:y(value),stroke:'#dae1d6'});node('text',{x:0,y:y(value)+4,fill:'#63756a','font-size':12},Math.round(value).toLocaleString());}
  if(line&&values.length)node('polyline',{points:values.map((v,i)=>`${60+i*span/29},${y(v)}`).join(' '),fill:'none',stroke:'#49775a','stroke-width':3});
  values.forEach((v,i)=>{const r=state.rounds[i],fill=r.alarm?'#b94435':r.accepted?'#49775a':'#b88223';if(line)node('circle',{cx:60+i*span/29,cy:y(v),r:3,fill});else node('rect',{x:58+i*span/29,y:y(v||0),width:Math.min(12,span/40),height:Math.max(2,125*v/max),fill});});
  node('text',{x:55,y:175,fill:'#63756a','font-size':12},'Round 1');node('text',{x:width-75,y:175,fill:'#63756a','font-size':12},'Round 30');
}
function drawChart(rounds){
  const chart=el('live-chart');chart.replaceChildren();
  const width=Math.max(280,Math.min(720,chart.clientWidth||720)),span=width-75;
  chart.setAttribute('viewBox',`0 0 ${width} 180`);
  function node(tag,attrs,text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;chart.append(n);}
  const y=q=>150-Math.min(.5,q)/.5*125;
  for(const q of [0,.11,.25,.5]){node('line',{x1:45,y1:y(q),x2:width-20,y2:y(q),stroke:q===.11?'#be694f':'#dae1d6','stroke-dasharray':q===.11?'5 5':'0'});node('text',{x:0,y:y(q)+4,fill:'#63756a','font-size':12},`${q*100}%`);}
  if(rounds.length)node('polyline',{points:rounds.map((r,i)=>`${50+i*span/29},${y(r.qber)}`).join(' '),fill:'none',stroke:'#49775a','stroke-width':2});
  rounds.forEach((r,i)=>node('circle',{cx:50+i*span/29,cy:y(r.qber),r:4,fill:r.alarm?'#b94435':'#49775a'}));
  node('text',{x:45,y:175,fill:'#63756a','font-size':12},'Round 1');node('text',{x:width-75,y:175,fill:'#63756a','font-size':12},'Round 30');
}
if(credentials.id){
  if(!names[credentials.role]||!/^[a-f0-9]{48}$/.test(credentials.id)||!/^[a-f0-9]{48}$/.test(credentials.token||''))error('Invalid invitation link. Ask the room creator for the full link.');
  else{
    el('lobby').hidden=true;el('room').hidden=false;el(`${credentials.role}-controls`).hidden=false;
    el('role-label').textContent='SHARED QKD EXPERIMENT';el('role-title').textContent=names[credentials.role];
    el('role-help').textContent={sender:'Control center: choose a telemetry file, then start BB84 or B92 key generation. Accepted rounds release file chunks to the substation. Watch the protocol outcome after 30 rounds.',receiver:'Substation: join the room and collect telemetry chunks released by accepted key rounds. Once the whole file matches the sender’s SHA-256, download your received copy.',attacker:'Introduce simulated interference during the smart-grid file experiment. Rejected key rounds block new chunks. Alerts depend on measured results and authentication, not your button press.'}[credentials.role];
    update();setInterval(phase,200);
  }
}
