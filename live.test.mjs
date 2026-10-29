import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,authorize,advance,act,project,ROUND_MS} from './live/session.mjs';
const room=(authenticated=true,protocol='BB84')=>createSession({authenticated,protocol},0);
function start(s){act(s,'receiver',{action:'join'},0);act(s,'sender',{action:'start'},0);}
test('role links authorize only their role; projections hide capabilities and endpoint bits',()=>{
  const s=room();assert.ok(authorize(s,'sender',s.tokens.sender));assert.equal(authorize(s,'sender',s.tokens.attacker),false);
  assert.equal(authorize(s,'sender','é'.repeat(48)),false);
  assert.throws(()=>act(s,'attacker',{action:'start'},0));assert.throws(()=>act(s,'receiver',{action:'attack',attack:'ir'},0));
  start(s);advance(s,ROUND_MS);
  const a=project(s,'sender'),b=project(s,'receiver'),e=project(s,'attacker');
  assert.deepEqual(a.key,b.key);assert.ok(a.key);assert.equal(e.key,null);assert.equal(e.rounds[0].trace.length,0);
  assert.equal(a.tokens,undefined);assert.equal(a.attack,undefined);assert.equal(a.rounds[0].attack,undefined);
});
test('receiver must join; repeated start does not postpone current round',()=>{
  const s=room();assert.throws(()=>act(s,'sender',{action:'start'},0));start(s);act(s,'sender',{action:'start'},1000);assert.equal(s.next,ROUND_MS);
});
test('IR revokes accepted key; alerts appear only after completed round; two clean rounds recover',()=>{
  const s=room();start(s);advance(s,ROUND_MS);assert.ok(s.key);
  act(s,'attacker',{action:'attack',attack:'ir'},ROUND_MS);assert.equal(project(s,'sender').quarantine,false);
  advance(s,ROUND_MS*2);assert.equal(s.key,null);assert.ok(s.quarantine);assert.ok(s.rounds[1].qber>.2);
  act(s,'attacker',{action:'attack',attack:'none'},ROUND_MS*2);
  advance(s,ROUND_MS*3);assert.equal(s.key,null);assert.equal(s.clean,1);
  advance(s,ROUND_MS*4);assert.ok(s.key);assert.equal(s.quarantine,false);
});
test('authenticated MITM rejected even at low QBER; unauthenticated MITM is not magically detected',()=>{
  for(const authenticated of [true,false]){
    const s=room(authenticated);start(s);act(s,'attacker',{action:'attack',attack:'mitm'},0);advance(s,ROUND_MS);
    assert.ok(s.rounds[0].qber<.02);
    assert.equal(s.rounds[0].authFailed,authenticated);
    if(authenticated)assert.equal(s.key,null);
    else {assert.ok(s.key.compromised);assert.equal(project(s,'sender').key.compromised,undefined);assert.ok(project(s,'attacker').key);}
  }
});
test('late pulse attacks do not alter past photons; MITM covers the classical phase',()=>{
  const s=room();start(s);act(s,'attacker',{action:'attack',attack:'ir'},10000);advance(s,ROUND_MS);assert.ok(s.rounds[0].qber<.02);
  const m=room();start(m);act(m,'attacker',{action:'attack',attack:'mitm'},10000);advance(m,ROUND_MS);assert.ok(m.rounds[0].authFailed);
});
test('noise rejects, B92 supports healthy supply, and stop clears marker',()=>{
  const n=room();start(n);act(n,'attacker',{action:'attack',attack:'noise'},0);advance(n,ROUND_MS);assert.ok(n.quarantine);
  const s=room(true,'B92');start(s);advance(s,ROUND_MS);assert.ok(s.key);act(s,'sender',{action:'stop'},ROUND_MS);assert.equal(s.key,null);assert.equal(s.next,null);
});
test('catch-up is bounded to thirty rounds and invalid settings are refused',()=>{
  const s=room();start(s);advance(s,3600000);assert.equal(s.rounds.length,30);assert.equal(s.running,false);
  assert.throws(()=>act(s,'sender',{action:'start'},3600001));assert.throws(()=>createSession({protocol:'other',authenticated:true}));
});
test('BB84 and B92 release the exact file and require receiver verification for final success',()=>{
  for(const protocol of ['BB84','B92']){
    const s=room(true,protocol),bytes=Buffer.from('SCADA voltage,frequency\n230,50\n'.repeat(90));
    act(s,'sender',{action:'upload',name:'telemetry.csv',data:bytes.toString('base64')},0);
    start(s);advance(s,ROUND_MS);
    const partial=project(s,'receiver').transfer;
    assert.deepEqual(Buffer.from(partial.data,'base64'),bytes.subarray(0,1024));
    assert.equal(project(s,'sender').transfer.data,undefined);assert.equal(project(s,'attacker').transfer.data,undefined);
    assert.throws(()=>act(s,'receiver',{action:'receipt',sha256:s.transfer.sha256}));
    advance(s,30*ROUND_MS);
    assert.equal(project(s,'receiver').transfer.verdict,'AWAITING RECEIVER VERIFICATION');
    assert.deepEqual(Buffer.from(project(s,'receiver').transfer.data,'base64'),bytes);
    assert.throws(()=>act(s,'attacker',{action:'receipt',sha256:s.transfer.sha256}));
    assert.throws(()=>act(s,'receiver',{action:'receipt',sha256:'bad'}));
    act(s,'receiver',{action:'receipt',sha256:s.transfer.sha256});
    assert.equal(project(s,'sender').transfer.verdict,'FILE TRANSFERRED');
    assert.equal(s.rounds.reduce((n,r)=>n+r.sentBytes,0),bytes.length);
  }
});
test('continuous attacks block file delivery; recovery resumes without duplicates; paused rounds deliver nothing',()=>{
  const s=room();start(s);advance(s,ROUND_MS);
  act(s,'attacker',{action:'attack',attack:'ir'},ROUND_MS);advance(s,3*ROUND_MS);
  assert.equal(s.transfer.delivered,1024);
  act(s,'attacker',{action:'attack',attack:'none'},3*ROUND_MS);advance(s,4*ROUND_MS);assert.equal(s.transfer.delivered,1024);
  advance(s,5*ROUND_MS);assert.equal(s.transfer.delivered,2048);
  act(s,'sender',{action:'stop'},5*ROUND_MS);advance(s,10*ROUND_MS);assert.equal(s.transfer.delivered,2048);
  const blocked=room();start(blocked);act(blocked,'attacker',{action:'attack',attack:'mitm'},0);advance(blocked,30*ROUND_MS);
  assert.equal(blocked.transfer.delivered,0);assert.equal(project(blocked,'receiver').transfer.verdict,'TRANSFER INCOMPLETE');
});
test('unauthenticated MITM delivery is recorded as exposed, separate from successful receipt',()=>{
  const s=room(false);start(s);act(s,'attacker',{action:'attack',attack:'mitm'},0);advance(s,30*ROUND_MS);
  assert.equal(s.transfer.exposed,s.transfer.size);act(s,'receiver',{action:'receipt',sha256:s.transfer.sha256});
  assert.equal(project(s,'receiver').transfer.verdict,'FILE TRANSFERRED');
  assert.match(project(s,'receiver').transfer.security,/not authenticated/);
  assert.equal(project(s,'receiver').transfer.exposed,undefined);
});
test('file uploads validate boundaries, role and immutable experiment input',()=>{
  const s=room(),upload={action:'upload',name:'data.csv',data:'eA=='};
  for(const name of ['../data.csv','bad\\file','', 'x'.repeat(121),'bad\nfile'])assert.throws(()=>act(s,'sender',{...upload,name}));
  for(const data of ['', '%%%',Buffer.alloc(24577).toString('base64')])assert.throws(()=>act(s,'sender',{...upload,data}));
  assert.throws(()=>act(s,'receiver',upload));assert.throws(()=>act(s,'attacker',upload));
  act(s,'sender',{...upload,data:Buffer.alloc(24576,123).toString('base64')});assert.equal(s.transfer.size,24576);
  start(s);assert.throws(()=>act(s,'sender',upload));advance(s,ROUND_MS);act(s,'sender',{action:'stop'});assert.throws(()=>act(s,'sender',upload));
});
