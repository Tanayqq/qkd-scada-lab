import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateScada, compareScada } from './dist/scada.mjs';

const qkd = { protocol: 'BB84', pulses: 10_000, noise: 0, source: 'ideal', attack: 'none', seed: 42, sampleFraction: .25, efficiency: 1, darkCount: 0, lossDb: 0, eps: 1e-6, requiredBits: 128 };
const healthy = { duration: 6, pulseRate: 100_000, postProcessingSec: .1, messageRate: 10, keyLifetime: 10, messagesPerKey: 50, keyBits: 128, poolCapacity: 100, deadlineSec: 2, networkDelaySec: .1, attack: 'none' };
const run = (options = {}, config = {}) => simulateScada({ ...healthy, ...options }, { ...qkd, ...config });
const delivered = r => r.messages.filter(m => m.status === 'DELIVERED');

test('protocol key supply versus SCADA demand changes heavy-load delivery performance', () => {
  const r=compareScada({duration:12,pulseRate:100000,messageRate:100,messagesPerKey:1,deadlineSec:.5},{...qkd,pulses:100000,noise:.005});
  const [bb84,b92]=r.results;
  assert.ok(bb84.summary.bitsPerSecond>bb84.summary.demandBitsPerSecond);
  assert.ok(b92.summary.bitsPerSecond<b92.summary.demandBitsPerSecond);
  assert.ok(bb84.summary.delivered>b92.summary.delivered);
  assert.equal(r.recommendation,'BB84');
});

test('healthy SCADA delivers authenticated traffic in both directions', () => {
  const r = run();
  assert.ok(r.summary.delivered > 0);
  assert.equal(r.summary.compromisedDelivered, 0);
  assert.equal(r.summary.authFailures, 0);
  assert.ok(delivered(r).some(m => m.direction === 'uplink'));
  assert.ok(delivered(r).some(m => m.direction === 'downlink'));
  assert.equal(r.summary.delivered, delivered(r).length);
});
test('every delivery obeys key direction, lifetime, and message deadline', () => {
  const r = run({ keyLifetime: .8, messagesPerKey: 2 });
  const keys = new Map(r.keys.map(k => [k.id, k]));
  assert.ok(r.summary.delivered > 0);
  for (const m of delivered(r)) {
    const key = keys.get(m.keyId);
    assert.ok(key, 'delivery must reference an issued key');
    assert.equal(key.direction, m.direction);
    assert.ok(m.sentAt >= key.createdAt - 1e-9);
    assert.ok(m.sentAt < key.expiresAt + 1e-9);
    assert.ok(m.deliveredAt <= key.expiresAt + 1e-9);
    assert.ok(m.deliveredAt <= m.deadlineAt + 1e-9);
    assert.ok(m.deliveredAt >= m.sentAt);
  }
  for (const key of r.keys) assert.ok(key.uses <= 2, 'key message limit must never be exceeded');
});
test('directional key IDs and counters are not reused', () => {
  const r = run();
  const seen = new Set();
  for (const message of r.messages.filter(m => m.sentAt !== null && m.sentAt !== undefined)) {
    const nonce = `${message.keyId}:${message.nonceCounter}`;
    assert.ok(!seen.has(nonce), `counter reuse ${nonce}`);
    seen.add(nonce);
  }
  for (const key of r.keys) {
    const directions = new Set(r.messages.filter(m => m.keyId === key.id).map(m => m.direction));
    assert.ok(directions.size <= 1, 'one key must not serve both directions');
  }
});
test('scarce QKD throughput causes queued messages to miss deadlines', () => {
  const r = run({ pulseRate: 100, deadlineSec: .3 });
  assert.equal(r.summary.delivered, 0);
  assert.ok(r.messages.some(m => m.status === 'DROPPED'));
  assert.ok(r.summary.deadlineMisses > 0);
  assert.ok(r.snapshots.some(s => s.queue > 0));
});
test('zero detections cannot produce keys or deliver traffic', () => {
  const r = run({}, { efficiency: 0 });
  assert.equal(r.summary.estimatedBits, 0);
  assert.equal(r.summary.keysGenerated, 0);
  assert.equal(r.summary.delivered, 0);
});
test('the ready-key pool never exceeds its configured capacity', () => {
  const r = run({ poolCapacity: 2, messageRate: 1 });
  assert.ok(r.keys.length > 0);
  assert.ok(r.snapshots.every(s => s.poolKeys <= 2));
});
test('key lifetime begins at creation and short lifetimes trigger expiration', () => {
  const r = run({ keyLifetime: .3, messageRate: 1 });
  assert.ok(r.summary.keyExpirations > 0);
  for (const key of r.keys) assert.ok(Math.abs(key.expiresAt - key.createdAt - .3) < 1e-8);
});
test('message usage limits rotate active keys', () => {
  const r = run({ messagesPerKey: 1 });
  assert.ok(r.summary.keyRotations > 0);
  assert.ok(r.keys.some(k => k.status === 'EXHAUSTED'));
  assert.ok(r.keys.every(k => k.uses <= 1));
});
test('network arrival after key expiry is dropped', () => {
  const r = run({ keyLifetime: .3, networkDelaySec: .5 });
  assert.equal(r.summary.delivered, 0);
  assert.ok(r.messages.some(m => m.status === 'DROPPED' && m.keyId));
});
test('network delay cannot deliver messages past their deadlines', () => {
  const r = run({ networkDelaySec: .8, deadlineSec: .3 });
  assert.equal(r.summary.delivered, 0);
  assert.ok(r.summary.deadlineMisses > 0);
});
test('intercept-resend alarms revoke keys and clear in-flight traffic', () => {
  const r = run({ attack: 'ir', attackStart: 1, attackEnd: 4, recoveryRounds: 2 });
  const alarmRounds = r.rounds.filter(round => round.alarm);
  assert.ok(alarmRounds.length > 0);
  assert.ok(r.summary.alarms > 0);
  assert.ok(r.keys.some(k => k.status === 'REVOKED'));
  for (const alarm of alarmRounds) {
    for (const message of delivered(r)) {
      const key = r.keys.find(k => k.id === message.keyId);
      assert.ok(!(message.sentAt < alarm.end - 1e-9 && message.deliveredAt > alarm.end + 1e-9), 'an alarm must clear in-flight traffic');
      assert.ok(!(key.createdAt < alarm.end - 1e-9 && message.sentAt > alarm.end + 1e-9), 'revoked keys must never be reused');
    }
  }
});
test('recovery waits for the configured number of clean rounds', () => {
  const r = run({ attack: 'ir', attackStart: 1, attackEnd: 2, recoveryRounds: 3 });
  const alarms = r.rounds.filter(round => round.alarm);
  assert.ok(alarms.length > 0);
  const lastAlarm = alarms.at(-1);
  const cleanRounds = r.rounds.filter(round => round.start >= lastAlarm.end - 1e-9 && !round.alarm);
  assert.ok(cleanRounds.length >= 3);
  const earliestRecovery = cleanRounds[2].end;
  for (const m of delivered(r).filter(m => m.sentAt > lastAlarm.end + 1e-9)) assert.ok(m.sentAt >= earliestRecovery - 1e-9);
  assert.ok(delivered(r).some(m => m.sentAt >= earliestRecovery));
});
test('authenticated MITM causes authentication failure without compromised delivery', () => {
  const r = run({ attack: 'mitm', attackStart: 1, attackEnd: 4, authenticated: true });
  assert.ok(r.summary.authFailures > 0);
  assert.equal(r.summary.compromisedDelivered, 0);
  assert.ok(r.rounds.some(round => round.authFailed));
});
test('a channel-noise window triggers monitoring without claiming an identified attacker', () => {
  const r = run({ attack: 'noise', attackNoise: .25, attackStart: 1, attackEnd: 4 });
  assert.ok(r.summary.alarms > 0);
  assert.ok(r.rounds.some(round => round.alarm && round.qber > round.baselineQber));
});
test('PNS cannot conceal a lossless weak-coherent-source gain deficit', () => {
  const r = run({ attack: 'pns', attackStart: 1, attackEnd: 4 }, { source: 'wcp', mu: .5 });
  assert.ok(r.summary.alarms > 0);
  assert.ok(r.rounds.some(round => round.attack === 'pns' && round.alarm));
});
test('unauthenticated MITM can compromise traffic while QBER stays low', () => {
  const r = run({ attack: 'mitm', attackStart: 0, attackEnd: 5, authenticated: false });
  assert.ok(r.summary.compromisedDelivered > 0);
  const compromisedRounds = r.rounds.filter(round => round.compromised);
  assert.ok(compromisedRounds.length > 0);
  assert.ok(compromisedRounds.every(round => round.qber < .05));
  assert.ok(delivered(r).some(m => m.compromised));
});
test('fixed configuration reproduces lifecycle, counters, and delivery exactly', () => {
  assert.deepEqual(run({ attack: 'ir', attackStart: 1, attackEnd: 2 }), run({ attack: 'ir', attackStart: 1, attackEnd: 2 }));
});
test('summary accounting conserves messages and counts modeled key output', () => {
  const r = run({ attack: 'ir', attackStart: 1, attackEnd: 2, poolCapacity: 2 });
  assert.equal(r.summary.generated, r.messages.length);
  assert.equal(r.summary.generated, r.summary.delivered + r.summary.dropped + r.summary.pending);
  assert.equal(r.summary.dropped, r.messages.filter(m => m.status === 'DROPPED').length);
  assert.equal(r.summary.pending, r.messages.filter(m => ['QUEUED', 'IN_FLIGHT'].includes(m.status)).length);
  assert.ok(r.summary.keysGenerated >= r.keys.length);
  assert.equal(r.summary.keysGenerated - r.summary.overflowKeys, r.keys.length);
  assert.ok(r.summary.availability >= 0 && r.summary.availability <= 1);
  assert.doesNotThrow(() => JSON.stringify(r));
});
test('delayed first QKD completion raises message latency relative to healthy supply', () => {
  const fast = run(), slow = run({ pulseRate: 10_000 });
  assert.ok(slow.summary.delivered > 0);
  assert.ok(slow.summary.meanLatencySec > fast.summary.meanLatencySec);
  assert.ok(slow.generationSec > fast.generationSec);
});
test('invalid lifecycle parameters are rejected', () => {
  for (const options of [{ duration: 0 }, { duration: NaN }, { pulseRate: 0 }, { postProcessingSec: -1 }, { messageRate: -1 }, { messageRate: Infinity }, { keyLifetime: 0 }, { messagesPerKey: 0 }, { messagesPerKey: 1.5 }, { poolCapacity: -1 }, { deadlineSec: 0 }, { networkDelaySec: -1 }, { keyBits: 0 }, { recoveryRounds: 0 }, { attack: 'unknown' }, { authenticated: 'false' }]) assert.throws(() => run(options), JSON.stringify(options));
});
test('comparison contains two independent protocol lifecycle runs', () => {
  const comparison = compareScada(healthy, qkd);
  const runs = Array.isArray(comparison) ? comparison : comparison.results;
  assert.equal(runs.length, 2);
  assert.deepEqual(new Set(runs.map(r => r.qkdConfig.protocol)), new Set(['BB84', 'B92']));
});
