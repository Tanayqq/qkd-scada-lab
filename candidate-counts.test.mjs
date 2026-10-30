import test from 'node:test';
import assert from 'node:assert/strict';
import {channelCandidateCounts,liveCandidateCounts,pulsePreviewCounts} from './dist/candidate-counts.mjs';
import {simulate} from './dist/engine.mjs';
import {createSession,act,advance,ROUND_MS} from './live/session.mjs';
test('channel candidate totals separate accepted, rejected and ineligible budgets',()=>{
  for(const protocol of ['BB84','B92']){
    const run=simulate({protocol,seed:42}),p=pulsePreviewCounts(run.trace);
    assert.equal(p.total,32);assert.equal(p.kept+p.discarded+p.lost,32);
    assert.equal(p.kept,run.audit.slice(0,32).filter(e=>e.conclusive).length);
    assert.ok(p.errors<=p.kept);assert.ok(p.disclosed<=p.kept);
  }
  const base={config:{requiredBits:128},finalBits:200,gainMismatch:false};
  const runs=['ACCEPT','ALERT','REJECT','INSUFFICIENT','UNSUPPORTED'].map(status=>({...base,status}));
  runs.push({...base,status:'ACCEPT',gainMismatch:true},{...base,status:'ALERT',finalBits:127});
  assert.deepEqual(channelCandidateCounts(runs),{total:7,accepted:2,rejected:2,other:3});
  assert.deepEqual(channelCandidateCounts([]),{total:0,accepted:0,rejected:0,other:0});
});
test('live counts distinguish rejected rounds and clean rounds held for recovery',()=>{
  const rounds=[{accepted:true,alarm:false},{accepted:false,alarm:true},{accepted:false,alarm:false},{accepted:true,alarm:false,compromised:true}];
  assert.deepEqual(liveCandidateCounts(rounds),{total:4,accepted:2,rejected:1,recovery:1});
  assert.deepEqual(liveCandidateCounts([]),{total:0,accepted:0,rejected:0,recovery:0});
  const session=createSession({protocol:'BB84',authenticated:true},0);
  act(session,'receiver',{action:'join'},0);act(session,'sender',{action:'start'},0);
  act(session,'attacker',{action:'attack',attack:'mitm'},0);advance(session,ROUND_MS);
  act(session,'attacker',{action:'attack',attack:'none'},ROUND_MS);advance(session,3*ROUND_MS);
  assert.deepEqual(liveCandidateCounts(session.rounds),{total:3,accepted:1,rejected:1,recovery:1});
});
