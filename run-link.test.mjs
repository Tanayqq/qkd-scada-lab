import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from './dist/engine.mjs';
import {runFragment,readRunFragment} from './dist/run-link.mjs';

test('simulation-to-dashboard links carry settings only and reproduce both protocols',()=>{
  for(const protocol of ['BB84','B92'])for(const attack of ['none','ir','pns']) {
    const original=simulate({protocol,attack,source:attack==='pns'?'wcp':'ideal',pulses:1000,seed:34567,noise:.017,interception:.45,lossDb:2,efficiency:.8,darkCount:.001,mu:.7,sampleFraction:.4,eps:1e-5,requiredBits:64});
    const hash=runFragment(original.config),settings=readRunFragment(hash);
    assert.deepEqual(settings,original.config);
    assert.deepEqual(simulate(settings),original);
    assert.equal(Object.hasOwn(settings,'finalBits'),false);
    assert.equal(Object.hasOwn(settings,'counts'),false);
  }
});
test('shared configuration rejects malformed and out-of-range input and ignores supplied results',()=>{
  assert.equal(readRunFragment('#results'),null);
  for(const value of ['%','null','[]',JSON.stringify({noise:2}),JSON.stringify({pulses:1000001}),JSON.stringify({protocol:'other'})])assert.throws(()=>readRunFragment('#qkd='+encodeURIComponent(value)));
  const settings=readRunFragment('#qkd='+encodeURIComponent(JSON.stringify({seed:42,finalBits:999999})));
  assert.equal(settings.finalBits,undefined);
  assert.equal(simulate(settings).finalBits,649);
});
