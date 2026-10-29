import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { simulate } from '../dist/engine.mjs';

export const ROUND_MS = 12000;
const roles = ['sender', 'receiver', 'attacker'];
const attacks = ['none', 'ir', 'noise', 'mitm'];
const token = () => randomBytes(24).toString('hex');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fileTransfer(name,bytes) {
  return {name,data:bytes.toString('base64'),size:bytes.length,sha256:digest(bytes),delivered:0,exposed:0,verified:false,chunkSize:1024};
}
function defaultTransfer(){
  const header='time_seconds,voltage_V,frequency_Hz\n';
  const rows=Array.from({length:1000},(_,i)=>`${i},${(230+Math.sin(i)).toFixed(2)},50.00\n`).join('');
  return fileTransfer('grid-telemetry.csv',Buffer.from(header+rows));
}
export function createSession(input = {}, now = Date.now()) {
  if (!['BB84', 'B92'].includes(input.protocol) || typeof input.authenticated !== 'boolean') throw new Error('Choose a valid protocol and authentication setting.');
  return {id:token(), tokens:Object.fromEntries(roles.map(r=>[r,token()])), created:now, expires:now+3600000,
    protocol:input.protocol, authenticated:input.authenticated, running:false, joined:false, next:null,
    rounds:[], changes:[{at:now, attack:'none'}], key:null, quarantine:false, clean:0, revision:0,transfer:defaultTransfer()};
}
export function authorize(s, role, credential) {
  if (!roles.includes(role) || typeof credential !== 'string' || !/^[a-f0-9]{48}$/.test(credential)) return false;
  return timingSafeEqual(Buffer.from(s.tokens[role]), Buffer.from(credential));
}
function exposure(s, start, end, mode) {
  let total=0;
  for(let i=0;i<s.changes.length;i++) {
    const c=s.changes[i], until=s.changes[i+1]?.at ?? end;
    if(c.attack===mode) total+=Math.max(0,Math.min(end,until)-Math.max(start,c.at));
  }
  return total/(end-start);
}
export function advance(s, now=Date.now()) {
  // ponytail: bounded classroom sessions (30 rounds); use a job queue for long-running experiments.
  while(s.running && s.next<=now && s.rounds.length<30) {
    const end=s.next,start=end-ROUND_MS,pulseEnd=start+ROUND_MS*.7;
    const ir=exposure(s,start,pulseEnd,'ir'),noise=exposure(s,start,pulseEnd,'noise'),mitm=exposure(s,start,end,'mitm')>0;
    const seed=randomBytes(4).readUInt32LE();
    const r=simulate({protocol:s.protocol,pulses:100000,noise:.005+noise*.245,attack:ir?'ir':'none',interception:ir,seed});
    const authFailed=mitm&&s.authenticated;
    const alarm=authFailed || r.qber>.11 || r.finalBits<128;
    if(alarm) {s.key=null;s.quarantine=true;s.clean=0;}
    else if(s.quarantine) {s.clean++;if(s.clean>=2)s.quarantine=false;}
    const accepted=!alarm&&!s.quarantine;
    const id=s.rounds.length+1;
    if(accepted) s.key={id:`K-${String(id).padStart(3,'0')}`, preview:randomBytes(8).toString('hex'), compromised:mitm&&!s.authenticated};
    const t=s.transfer;
    const sent=t&&accepted?Math.min(t.chunkSize,t.size-t.delivered):0;
    if(t){t.delivered+=sent;if(accepted&&s.key.compromised)t.exposed+=sent;}
    s.rounds.push({id,start,end,qber:r.qber,bits:r.finalBits,accepted,alarm,authFailed,
      status:authFailed?'AUTHENTICATION FAILED':alarm?'KEY REJECTED':s.quarantine?'RECOVERY CHECK':'KEY READY',
      keyId:accepted?s.key.id:null,compromised:accepted&&s.key.compromised,
      sentBytes:sent,deliveredBytes:t?.delivered??0,transferBlocked:!!t&&t.delivered<t.size&&!accepted,
      trace:r.trace.slice(0,12).map(t=>({aliceBit:t.aliceBit,aliceBasis:t.aliceBasis,bobBit:t.bobBit,bobBasis:t.bobBasis,status:t.status})),
      attack:mitm?'mitm':ir?'ir':noise?'noise':'none'});
    s.next+=ROUND_MS;s.revision++;
    if(s.rounds.length===30){s.running=false;s.next=null;}
  }
  return s;
}
export function act(s,role,input,now=Date.now()) {
  const action=input.action;
  if(action==='join'&&role==='receiver') s.joined=true;
  else if(action==='upload'&&role==='sender') {
    if(s.running||s.rounds.length)throw new Error('File cannot change after generation starts. Create another room.');
    if(typeof input.name!=='string'||input.name.length<1||input.name.length>120||/[\x00-\x1f\\/]/.test(input.name)||typeof input.data!=='string'||input.data.length>32768||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))throw new Error('Invalid file. Choose a file between 1 byte and 24 KiB.');
    const bytes=Buffer.from(input.data,'base64');
    if(!bytes.length||bytes.length>24576)throw new Error('Invalid file. Choose a file between 1 byte and 24 KiB.');
    s.transfer=fileTransfer(input.name,bytes);
  } else if(action==='receipt'&&role==='receiver') {
    const t=s.transfer;
    if(!t||t.delivered!==t.size||input.sha256!==t.sha256)throw new Error('File verification failed or transfer is incomplete.');
    t.verified=true;
  }
  else if(action==='start'&&role==='sender') {
    if(!s.joined) throw new Error('Ask the receiver to join first.');
    if(s.rounds.length>=30) throw new Error('Session complete. Create another room.');
    if(!s.running){s.running=true;s.next=now+ROUND_MS;}
  } else if(action==='stop'&&role==='sender') {s.running=false;s.next=null;s.key=null;}
  else if(action==='attack'&&role==='attacker') {
    if(!attacks.includes(input.attack)) throw new Error('Unknown attack.');
    if(s.changes.length>=200) throw new Error('Session control limit reached. Create another room.');
    if(s.changes.at(-1).attack!==input.attack)s.changes.push({at:now,attack:input.attack});
  } else throw new Error('This role cannot perform that action.');
  s.revision++;
}
export function project(s,role,now=Date.now()) {
  const t=s.transfer,finished=s.rounds.length===30;
  const transfer=t?{name:t.name,size:t.size,sha256:role==='attacker'?undefined:t.sha256,delivered:t.delivered,verified:t.verified,chunkSize:t.chunkSize,
    finished,verdict:!finished?'IN PROGRESS':t.delivered<t.size?'TRANSFER INCOMPLETE':!t.verified?'AWAITING RECEIVER VERIFICATION':'FILE TRANSFERRED',
    security:s.authenticated?'Authentication enabled':'Identity not authenticated; confidentiality cannot be assured',
    ...(role==='attacker'?{exposed:t.exposed}:{}),
    ...(role==='receiver'?{data:Buffer.from(t.data,'base64').subarray(0,t.delivered).toString('base64')}:{})}:null;
  const rounds=s.rounds.map(({trace,attack,compromised,...r})=>({...r,
    ...(role==='attacker'?{attack,compromised}:{}),
    trace:role==='attacker'?[]:trace.map(t=>role==='sender'?{bit:t.aliceBit,basis:t.aliceBasis,status:t.status}:{bit:t.bobBit,basis:t.bobBasis,status:t.status})}));
  return {id:s.id,role,protocol:s.protocol,authenticated:s.authenticated,expires:s.expires,now,
    running:s.running,joined:s.joined,next:s.next,roundMs:ROUND_MS,rounds,quarantine:s.quarantine,clean:s.clean,revision:s.revision,transfer,
    key:role==='attacker'?(s.key?.compromised?{...s.key}:null):(s.key?{id:s.key.id,preview:s.key.preview}:null),
    ...(role==='attacker'?{attack:s.changes.at(-1).attack}:{})};
}
