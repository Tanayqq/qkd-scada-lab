import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, compareProtocols, interceptionCurve, b92PhaseBound, binomialInterval, h2, qberUpper, expectedStats, detectionProbability, gllpRate } from './dist/engine.mjs';

const base = { protocol: 'BB84', pulses: 200_000, seed: 14102026, noise: 0, attack: 'none', source: 'ideal', lossDb: 0, efficiency: 1, darkCount: 0, sampleFraction: .25, eps: 1e-6, requiredBits: 128 };
const run = (options = {}) => simulate({ ...base, ...options });
test('photon replay records match actual small-run detection, sifting and error counts', () => {
  for(const protocol of ['BB84','B92'])for(const settings of [{noise:0},{attack:'ir'},{lossDb:10},{source:'wcp',attack:'pns',lossDb:0},{efficiency:0,darkCount:1}]) {
    const r=run({protocol,pulses:32,...settings});
    assert.equal(r.trace.length,32);
    assert.equal(r.trace.filter(e=>e.detected).length,r.detected);
    assert.equal(r.trace.filter(e=>e.conclusive).length,r.sifted);
    assert.equal(r.trace.filter(e=>e.error).length,r.counts.siftedErrors);
    for(const event of r.trace) {
      if(event.conclusive)assert.equal(event.error,event.aliceBit!==event.bobBit);
      if(!event.detected)assert.equal(event.bobOutcome,null);
    }
  }
  assert.equal(run({pulses:1000}).trace.length,32);
});
test('Monte Carlo audit reconstructs all small-run counts and actual disclosed samples', () => {
  for(const protocol of ['BB84','B92'])for(const sampleFraction of [0,.25,.9,1])for(const options of [{noise:0},{noise:.1},{attack:'ir'},{lossDb:8},{source:'wcp',mu:.8},{efficiency:0,darkCount:.4}]){
    const r=run({protocol,pulses:100,sampleFraction,...options});
    const kept=r.audit.filter(e=>e.conclusive),sampled=kept.filter(e=>e.sampled),remaining=kept.filter(e=>!e.sampled);
    assert.equal(r.audit.length,100);assert.deepEqual(r.trace,r.audit.slice(0,32));
    assert.equal(r.audit.filter(e=>e.detected).length,r.detected);
    assert.equal(kept.length,r.sifted);assert.equal(sampled.length,r.sample);assert.equal(remaining.length,r.keyBits);
    assert.equal(sampled.filter(e=>e.aliceBit!==e.bobBit).length,r.errors);
    assert.equal(r.qber,sampled.length?r.errors/sampled.length:0);
    assert.equal(new Set(sampled.map(e=>e.sampleOrder)).size,r.sample);
    for(const e of r.audit){
      for(const value of Object.values(e.draws))assert.ok(value>=0&&value<1);
      assert.equal(e.aliceBit,e.draws.aliceBit<.5?0:1);
      assert.equal(e.bobBasis,e.draws.bobBasis<.5?0:1);
      assert.equal(e.signal,e.draws.signal<e.signalProbability);
      assert.equal(e.noiseFlipped,e.signal&&e.draws.noise<r.config.noise);
      if(e.sampled){assert.ok(e.conclusive);assert.ok(e.samplingDraw>=0&&e.samplingDraw<1);}
    }
  }
  assert.equal(run({pulses:10000}).audit.length,128);
});

test('recorded budget reproduces the final estimate and preserves rejection checks', () => {
  for(const protocol of ['BB84','B92'])for(const options of [{noise:0},{noise:.005},{attack:'ir'},{efficiency:0},{source:'wcp'}]){
    const r=run({protocol,pulses:20000,...options}),b=r.budget;
    assert.equal(b.privacyBits,r.keyBits*b.privacyFraction);
    assert.equal(b.reconciliationLeakage,r.keyBits*1.16*h2(r.qber));
    assert.equal(b.rawBudget,r.keyBits*(b.privacyFraction-1.16*h2(r.qber))-r.finitePenalty-r.verification-r.authentication);
    assert.equal(b.beforeChecks,r.sample?Math.max(0,Math.floor(b.rawBudget)):0);
    assert.equal(r.finalBits,['REJECT','UNSUPPORTED'].includes(r.status)?0:b.beforeChecks);
  }
});

test('interception graph uses exact protocol-specific analytic curves without random sweep data', () => {
  const [bb84,b92]=interceptionCurve({noise:0},20);
  assert.equal(bb84.points.length,21);
  assert.equal(bb84.points[0].qber,0);
  assert.equal(bb84.points.at(-1).qber,.25);
  assert.equal(b92.points.at(-1).qber,1/3);
  const noisy=interceptionCurve({noise:.05});
  assert.equal(noisy[0].points[0].qber,.05);
  assert.ok(Math.abs(noisy[1].points[0].qber-1/11)<1e-12);
  assert.throws(()=>interceptionCurve({},0),RangeError);
});
test('comparison uses matching settings and recommends only an eligible modeled BB84 budget', () => {
  const compared = compareProtocols({...base, pulses:10000, noise:.05, seed:42});
  assert.deepEqual(compared.results.map(r => r.config.protocol), ['BB84','B92']);
  assert.equal(compared.recommendation, 'BB84');
  for (const r of compared.results) {
    assert.equal(r.config.pulses,10000);
    assert.equal(r.config.seed,42);
    assert.equal(r.config.noise,.05);
    assert.deepEqual(r,simulate(r.config));
  }
  assert.equal(compared.results[1].finalBits,0);
});
test('comparison refuses to recommend a key under full interception, inadequate budgets, or absent detections', () => {
  for (const overrides of [{attack:'ir'}, {requiredBits:1000000}, {efficiency:0}]) {
    const compared = compareProtocols({...base,pulses:10000,...overrides});
    assert.equal(compared.recommendation,null);
  }
  assert.throws(() => compareProtocols({...base,pulses:-1}),RangeError);
});
function near(actual, expected, trials, label) {
  const tolerance = Math.max(1 / trials, 6 * Math.sqrt(expected * (1 - expected) / trials));
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual}, expected ${expected} ± ${tolerance}`);
}
function checkPhysics(options, conclusive, qber) {
  const result = run(options);
  near(result.sifted / result.detected, conclusive, result.detected, 'conclusive fraction');
  if (qber === 0) assert.equal(result.siftedQber, 0);
  else near(result.siftedQber, qber, result.sifted, 'sifted QBER');
  return result;
}

test('BB84 ideal: half the pulses survive sifting and no errors occur', () => {
  const r = checkPhysics({}, .5, 0);
  assert.equal(r.detected, base.pulses);
  assert.ok(r.finalBits >= 128);
});
test('BB84 full intercept-resend introduces 25% QBER', () => checkPhysics({ attack: 'ir', interception: 1 }, .5, .25));
test('BB84 partial interception and outcome noise combine correctly', () => checkPhysics({ attack: 'ir', interception: .4, noise: .05 }, .5, .14));
test('B92 ideal: one quarter conclusive and no errors', () => checkPhysics({ protocol: 'B92' }, .25, 0));
test('B92 full interception: 3/8 conclusive and 1/3 QBER', () => checkPhysics({ protocol: 'B92', attack: 'ir', interception: 1 }, .375, 1 / 3));
test('B92 noise-only follows 2e/(1+2e)', () => checkPhysics({ protocol: 'B92', noise: .05 }, .275, 1 / 11));
test('B92 partial interception and noise match the joint outcome model', () => {
  const p = .4, e = .05;
  const wrong = p / 8 + e * (.5 - p / 4);
  const conclusive = .25 + p / 8 + e * (.5 - p / 4);
  checkPhysics({ protocol: 'B92', attack: 'ir', interception: p, noise: e }, conclusive, wrong / conclusive);
});
test('B92 estimates positive output in a clean single-photon channel without claiming certification', () => {
  const r = run({ protocol: 'B92' });
  assert.ok(r.finalBits > 128);
  assert.ok(r.b92Bound.supported);
  assert.ok(r.b92Bound.phaseUpper < .5);
  assert.match(r.warnings.join(' '),/not a composable proof/);
});
test('B92 rejects interception and high noise and declines unsupported weak-coherent extraction', () => {
  for (const options of [{attack:'ir'},{noise:.2},{source:'wcp'}]) {
    const r=run({protocol:'B92',...options});
    assert.equal(r.finalBits,0);
    assert.ok(['REJECT','UNSUPPORTED','INSUFFICIENT'].includes(r.status));
  }
});
test('B92 witness respects known noiseless phase-error extrema and USD loss cutoff', () => {
  const n=10000000000,a=(1-1/Math.sqrt(2))/2,s=1/Math.sqrt(2);
  for (const loss of [0,.25,.5,.8]) {
    const sifted=Math.floor(n*(1-loss)/4);
    const bound=b92PhaseBound({pulses:n,detected:Math.floor(n*(1-loss)),sifted,sample:Math.floor(sifted/4),errors:0});
    const benchmark=loss<s?a/s*loss/(1-loss):.5;
    assert.ok(bound.phaseUpper+1e-8>=benchmark,`${loss}: ${bound.phaseUpper} < ${benchmark}`);
    if(loss===0)assert.ok(bound.phaseUpper<.02);
    if(loss>.7072)assert.equal(bound.phaseUpper,.5);
  }
});
test('B92 returned witness bounds phase expectation for independent six-state vectors', () => {
  const bound=b92PhaseBound({pulses:100000,detected:100000,sifted:25000,sample:6250,errors:0});
  const [le,lc,ll,la]=bound.witness.coefficients,a=(1-1/Math.sqrt(2))/2,b=1-a;
  for(let seed=1;seed<=100;seed++) {
    let v=Array.from({length:6},(_,j)=>Math.sin(seed*(j+1)+j*j));
    const norm=Math.hypot(...v);v=v.map(x=>x/norm);
    const con=a*(v[0]**2+v[2]**2)+b*(v[1]**2+v[3]**2);
    const error=((Math.sqrt(a)*v[0]-Math.sqrt(b)*v[3])**2+(Math.sqrt(b)*v[1]-Math.sqrt(a)*v[2])**2)/2;
    const phase=b*v[1]**2+a*v[2]**2,loss=v[4]**2+v[5]**2,alice=v[2]**2+v[3]**2+v[5]**2;
    assert.ok(phase-le*error-lc*con-ll*loss-la*alice<=bound.witness.identity+1e-9);
  }
});
test('binomial confidence intervals include endpoints and fail closed on invalid counts', () => {
  assert.equal(binomialInterval(0,100)[0],0);
  assert.equal(binomialInterval(100,100)[1],1);
  const interval=binomialInterval(25,100);
  assert.ok(interval[0]<.25&&interval[1]>.25);
  assert.throws(()=>binomialInterval(101,100),RangeError);
});
test('loss and efficiency reduce detections before sifting', () => {
  const r = run({ lossDb: 10, efficiency: .5 });
  near(r.gain, .05, base.pulses, 'gain');
  near(r.sifted / base.pulses, .025, base.pulses, 'sifted gain');
});
test('dark-only detections carry random bits', () => {
  const r = run({ efficiency: 0, darkCount: .2 });
  near(r.gain, .2, base.pulses, 'dark gain');
  near(r.siftedQber, .5, r.sifted, 'dark QBER');
  assert.equal(r.finalBits, 0);
});
test('zero detections fail closed without NaN', () => {
  const r = run({ efficiency: 0 });
  assert.equal(r.detected, 0);
  assert.equal(r.finalBits, 0);
  for (const value of [r.gain, r.qber, r.qUpper, r.delta]) assert.ok(Number.isFinite(value));
});
test('PNS at zero loss exposes a gain deficit without inducing QBER', () => {
  const r = run({ source: 'wcp', mu: .5, attack: 'pns' });
  assert.equal(r.gainMismatch, true);
  assert.equal(r.siftedQber, 0);
  near(r.gain, 1 - Math.exp(-.5) * 1.5, base.pulses, 'available multiphoton gain');
});
test('PNS can conceal its gain at high loss but yields no certified key', () => {
  const r = run({ source: 'wcp', mu: .5, attack: 'pns', lossDb: 15 });
  assert.equal(r.gainMismatch, false);
  near(r.gain, 1 - Math.exp(-.5 * 10 ** -1.5), base.pulses, 'concealed gain');
  assert.equal(r.siftedQber, 0);
  assert.equal(r.finalBits, 0);
});
test('WCP tagging uses source statistics and observed gain conservatively', () => {
  const plain = run({ source: 'wcp', mu: .5 });
  const attacked = run({ source: 'wcp', mu: .5, attack: 'pns' });
  const expectedDelta = 1 - (1 - 1.5 * Math.exp(-.5)) / plain.gain;
  assert.ok(Math.abs(plain.delta - expectedDelta) < 1e-12);
  assert.equal(attacked.delta, Math.max(0, 1 - (1 - 1.5 * Math.exp(-.5)) / attacked.gain));
  assert.equal(run({ source: 'wcp', lossDb: 15 }).delta, 0);
  assert.ok(plain.finalBits < run().finalBits);
});
test('sample bits are discarded and estimated key never exceeds remaining bits', () => {
  const r = run();
  assert.equal(r.keyBits + r.sample, r.sifted);
  assert.ok(r.finalBits <= r.keyBits);
  assert.ok(Number.isInteger(r.finalBits));
  assert.deepEqual(r.pipeline, { sent: base.pulses, detected: r.detected, sifted: r.sifted, sampled: r.sample, remaining: r.keyBits, final: r.finalBits });
});
test('seed replay is deterministic and different seeds alter observed counts', () => {
  assert.deepEqual(run(), run());
  assert.notDeepEqual(run().counts, run({ seed: 999 }).counts);
});
test('source and detection randomness remain comparable across protocols', () => {
  const bb84 = run({ source: 'wcp', lossDb: 5, noise: .05 });
  const b92 = run({ source: 'wcp', lossDb: 5, noise: .05, protocol: 'B92' });
  for (const key of ['emitted', 'vacuum', 'multiPhoton', 'detected']) assert.equal(bb84.counts[key], b92.counts[key], key);
});
test('baseline 5% noise is not rejected by the conservative QBER bound', () => {
  const r = run({ pulses: 10_000, noise: .05 });
  assert.ok(r.qUpper > r.qber);
  assert.notEqual(r.status, 'REJECT');
  assert.ok(r.finalBits >= 128 || r.status === 'INSUFFICIENT');
});
test('a loose finite bound cannot alone trigger operational rejection', () => {
  const r = run({ pulses: 1000, noise: .05, sampleFraction: .15 });
  assert.ok(r.qUpper > .11);
  assert.ok(r.qber < .11);
  assert.notEqual(r.status, 'REJECT');
});
test('an alarm cannot turn insufficient estimated key material into an accepted result', () => {
  const r = run({ noise: .07, requiredBits: 1_000_000 });
  assert.equal(r.status, 'INSUFFICIENT');
});
test('empty sampling and all-discarded samples fail closed', () => {
  for (const sampleFraction of [0, 1]) {
    const r = run({ sampleFraction });
    assert.equal(r.finalBits, 0);
    assert.equal(r.status, 'INSUFFICIENT');
  }
});
test('binary entropy handles endpoints, symmetry, and midpoint', () => {
  assert.equal(h2(0), 0);
  assert.equal(h2(1), 0);
  assert.equal(h2(.5), 1);
  assert.ok(Math.abs(h2(.1) - h2(.9)) < 1e-12);
});
test('finite bound is conservative and tightens with sample count and epsilon', () => {
  assert.ok(qberUpper(.05, 750) > .05);
  assert.ok(qberUpper(.05, 7500) < qberUpper(.05, 750));
  assert.ok(qberUpper(.05, 750, 1e-10) > qberUpper(.05, 750, 1e-6));
  assert.ok(qberUpper(0, 750) > 0);
  assert.ok(qberUpper(.5, 1) <= 1);
});
test('analytic prediction independently matches BB84 and B92 formulas', () => {
  for (const [protocol, conclusive, qber] of [['BB84', .5, .14], ['B92', .32, .07 / .32]]) {
    const stats = expectedStats({ ...base, protocol, attack: 'ir', interception: .4, noise: .05 });
    assert.ok(Math.abs(stats.qber - qber) < 1e-12);
    assert.ok(Math.abs(stats.conclusive - conclusive) < 1e-12);
  }
});
test('detection probability means threshold exceedance, including noisy channels', () => {
  assert.ok(Math.abs(detectionProbability(4, .25, 0) - (1 - .75 ** 4)) < 1e-12);
  assert.ok(Math.abs(detectionProbability(4, .5, .5) - 5 / 16) < 1e-12);
  assert.equal(detectionProbability(10, 0, .1), 0);
  assert.equal(detectionProbability(10, 1, .1), 1);
});
test('GLLP zero-leak limit and insecure phase ratio fail closed', () => {
  assert.equal(gllpRate(0, 1), 1);
  assert.equal(gllpRate(0, 0), 0);
  assert.equal(gllpRate(.1, .2), 0);
  assert.ok(gllpRate(.01, .5) < gllpRate(.01, 1));
});
test('invalid simulation inputs are rejected at the boundary', () => {
  for (const invalid of [{ pulses: 0 }, { pulses: 1.5 }, { noise: -.1 }, { noise: 1.1 }, { efficiency: -1 }, { darkCount: 2 }, { sampleFraction: -.1 }, { sampleFraction: 1.1 }, { eps: 0 }, { eps: 1 }, { protocol: 'unknown' }, { attack: 'unknown' }, { source: 'unknown' }, { mu: -1 }, { lossDb: -1 }, { interception: 2 }]) {
    assert.throws(() => run(invalid), JSON.stringify(invalid));
  }
});
