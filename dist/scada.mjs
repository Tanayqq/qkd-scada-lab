import {simulate,expectedStats,detectionProbability} from './engine.mjs';

export const SCADA_DEFAULTS={duration:60,pulseRate:10000,postProcessingSec:.1,messageRate:10,keyLifetime:10,messagesPerKey:50,keyBits:128,poolCapacity:100,deadlineSec:2,networkDelaySec:.02,attack:'none',attackStart:20,attackEnd:40,interception:1,attackNoise:.25,authenticated:true,recoveryRounds:2,alarmIncrease:.03,alarmProbability:.001};
const SCADA_TICK=.1;
function scadaOptions(input) {
  const c={...SCADA_DEFAULTS,...input};
  const ranges={duration:[1,600],pulseRate:[100,1e7],postProcessingSec:[0,60],messageRate:[.1,100],keyLifetime:[.1,600],messagesPerKey:[1,100000],poolCapacity:[1,1000],deadlineSec:[.1,60],networkDelaySec:[0,60],attackStart:[0,600],attackEnd:[0,600],interception:[0,1],attackNoise:[0,.5],recoveryRounds:[1,10],alarmIncrease:[0,.5],alarmProbability:[1e-9,.1]};
  for(const [name,[low,high]] of Object.entries(ranges))if(!Number.isFinite(c[name])||c[name]<low||c[name]>high)throw new RangeError(`${name} must be ${low}..${high}`);
  for(const name of ['messagesPerKey','poolCapacity','recoveryRounds'])if(!Number.isInteger(c[name]))throw new RangeError(`${name} must be an integer`);
  if(c.keyBits!==128)throw new RangeError('This SCADA model budgets 128-bit session keys');
  if(typeof c.authenticated!=='boolean')throw new RangeError('authenticated must be boolean');
  if(!['none','ir','pns','noise','mitm'].includes(c.attack))throw new RangeError('Unknown SCADA attack');
  if(c.attack!=='none'&&c.attackEnd<=c.attackStart)throw new RangeError('Attack end must follow its start');
  return c;
}

export function simulateScada(input={},qkdInput={}) {
  const o=scadaOptions(input);
  const config={protocol:'BB84',pulses:10000,noise:.01,seed:42,...qkdInput,attack:'none',requiredBits:128};
  const baseline=expectedStats(config); // Validates QKD parameters before advancing time.
  const generationSec=Math.max(SCADA_TICK,Math.ceil((config.pulses/o.pulseRate+o.postProcessingSec)/SCADA_TICK-1e-9)*SCADA_TICK);
  const roundCount=Math.floor(o.duration/generationSec+1e-9);
  if(roundCount>600||roundCount*config.pulses>1e7)throw new RangeError('Reduce duration/pulse rate or increase block size: limit 600 QKD rounds and 10 million simulated pulses');
  if(o.attack==='pns'&&config.source!=='wcp')throw new RangeError('SCADA PNS requires a weak-coherent source in the QKD controls');
  const snapshots=[],rounds=[],keys=[],messages=[],events=[],pool=[],active={uplink:null,downlink:null},hadActive={uplink:false,downlink:false},pending=[],inFlight=[];
  const totals={generated:0,delivered:0,dropped:0,pending:0,compromisedDelivered:0,authenticatedDelivered:0,deadlineMisses:0,estimatedBits:0,keysGenerated:0,keysActivated:0,keyExpirations:0,keyRotations:0,alarms:0,authFailures:0,blockedSec:0,expiredPoolKeys:0,overflowKeys:0,revokedKeys:0};
  let keySequence=0,roundId=0,roundStart=0,nextRound=generationSec,nextArrival=0,blocked=false,cleanRounds=0,lastQber=null,latencyTotal=0,maxLatency=0;
  const event=(time,type,message,extra={})=>events.push({time,type,message,...extra});
  event(0,'START',`SCADA starts with no session keys; QKD takes ${generationSec.toFixed(2)} s per block.`);
  event(0,'QKD_STARTED',`Generating ${config.pulses} pulses plus post-processing; first block completes at ${generationSec.toFixed(2)} s.`);
  if(!o.authenticated)event(0,'AUTHENTICATION_DISABLED','No authenticated classical channel: low QBER cannot establish endpoint identity.');
  function drop(message,time,reason) {
    message.status='DROPPED';message.reason=reason;message.droppedAt=time;totals.dropped++;
    if(reason==='DEADLINE')totals.deadlineMisses++;
  }
  function endKey(key,time,status) {
    if(!key||!['READY','ACTIVE'].includes(key.status))return;
    key.status=status;key.endedAt=time;
    if(status==='EXPIRED')totals.keyExpirations++;
    if(status==='REVOKED')totals.revokedKeys++;
    if(key.direction)event(time,`KEY_${status}`,`${key.id} ${status.toLowerCase()} after ${key.uses} messages.`,{keyId:key.id});
  }
  function quarantine(time,reason) {
    totals.alarms++;if(!blocked)event(time,'TRAFFIC_PAUSED',`Traffic paused: ${reason}`);
    blocked=true;cleanRounds=0;
    for(const key of pool)endKey(key,time,'REVOKED');pool.length=0;
    for(const direction of ['uplink','downlink']){endKey(active[direction],time,'REVOKED');active[direction]=null;}
    for(const message of inFlight)drop(message,time,'SECURITY_QUARANTINE');inFlight.length=0;
    event(time,'REKEY_REQUIRED','All modeled session keys revoked; fresh clean QKD rounds required.');
  }
  function completeRound(time) {
    const exposedDuration=o.attack==='mitm'?generationSec:config.pulses/o.pulseRate;
    const overlap=o.attack==='none'?0:Math.max(0,Math.min(roundStart+exposedDuration,o.attackEnd)-Math.max(roundStart,o.attackStart));
    const exposure=Math.min(1,overlap/exposedDuration),attackConfig={...config,seed:(config.seed+roundId*104729)>>>0};
    if(o.attack==='ir'&&exposure){attackConfig.attack='ir';attackConfig.interception=o.interception*exposure;}
    if(o.attack==='noise'&&exposure)attackConfig.noise=config.noise*(1-exposure)+o.attackNoise*exposure;
    // A partially exposed PNS block is conservatively modeled as fully exposed.
    if(o.attack==='pns'&&exposure)attackConfig.attack='pns';
    const r=simulate(attackConfig),authFailed=o.attack==='mitm'&&exposure>0&&o.authenticated;
    const compromised=o.attack==='mitm'&&exposure>0&&!o.authenticated;
    const baselineQber=baseline.qber;
    const pValue=r.sample&&r.errors?detectionProbability(r.sample,baselineQber,(r.errors-1)/r.sample):1;
    const anomaly=r.sample>0&&r.qber>baselineQber+o.alarmIncrease&&pValue<o.alarmProbability;
    const alarm=authFailed||anomaly||r.status==='REJECT'||r.gainMismatch;
    const round={id:++roundId,start:roundStart,end:time,generationSec,attackExposure:exposure,attack:o.attack,qber:r.sample?r.qber:null,baselineQber,sample:r.sample,errors:r.errors,finalBits:r.finalBits,status:r.status,alarm,anomaly,pValue,authFailed,compromised,keysAdded:0};
    lastQber=round.qber;rounds.push(round);
    event(time,'QKD_COMPLETE',`Block ${round.id}: ${r.finalBits} estimated bits; ${r.sample?`${(r.qber*100).toFixed(2)}% QBER`:'no disclosed sample'}.`,{roundId:round.id});
    if(authFailed){totals.authFailures++;event(time,'AUTH_FAILURE','Modeled authentication rejects impersonation despite potentially normal QBER.',{roundId:round.id});}
    if(anomaly)event(time,'QBER_ANOMALY','QBER rose above the calibrated baseline; disturbance detected, cause not proven.',{roundId:round.id});
    if(r.gainMismatch)event(time,'GAIN_ANOMALY','Observed gain differs from the honest channel model.',{roundId:round.id});
    if(alarm)quarantine(time,authFailed?'authentication failed':r.gainMismatch?'gain mismatch':'abnormal QBER / rejected block');
    const eligible=['ACCEPT','ALERT'].includes(r.status)&&r.finalBits>=128&&!alarm;
    if(!eligible){if(blocked)cleanRounds=0;if(!alarm)event(time,'NO_KEY_OUTPUT','Block cannot supply a usable modeled 128-bit session key.',{roundId:round.id});}
    else {
      if(blocked){cleanRounds++;event(time,'RECOVERY_CHECK',`Clean block ${cleanRounds}/${o.recoveryRounds}.`,{roundId:round.id});if(cleanRounds>=o.recoveryRounds){blocked=false;event(time,'TRAFFIC_RESUMED','Fresh clean blocks passed; key distribution resumes.');}}
      if(!blocked) {
        totals.estimatedBits+=r.finalBits;
        const produced=Math.floor(r.finalBits/o.keyBits),stored=Math.min(produced,o.poolCapacity-pool.length);
        totals.keysGenerated+=produced;totals.overflowKeys+=produced-stored;round.keysAdded=stored;
        for(let i=0;i<stored;i++) {
          const key={id:`${config.protocol}-K${++keySequence}`,roundId:round.id,createdAt:time,expiresAt:time+o.keyLifetime,activatedAt:null,endedAt:null,status:'READY',direction:null,uses:0,compromised};
          keys.push(key);pool.push(key);
        }
        event(time,'KEY_BATCH_READY',`${stored} session keys added (${produced-stored} discarded at pool capacity).`,{roundId:round.id,count:stored});
      }
    }
    roundStart=time;nextRound=time+generationSec;
    if(time<o.duration)event(time,'QKD_STARTED',`Next QKD block starts; expected completion ${nextRound.toFixed(2)} s.`);
  }
  const ticks=Math.ceil(o.duration/SCADA_TICK);
  for(let tick=0;tick<=ticks;tick++) {
    const time=Math.min(o.duration,Number((tick*SCADA_TICK).toFixed(8)));
    for(let i=pool.length-1;i>=0;i--)if(pool[i].expiresAt<=time+1e-8){endKey(pool[i],time,'EXPIRED');pool.splice(i,1);totals.expiredPoolKeys++;}
    for(const direction of ['uplink','downlink'])if(active[direction]?.expiresAt<=time+1e-8){endKey(active[direction],time,'EXPIRED');active[direction]=null;}
    // Purge stale pool entries before filling; security checks still precede delivery.
    if(time+1e-8>=nextRound)completeRound(time);
    for(let i=inFlight.length-1;i>=0;i--) {
      const message=inFlight[i];if(message.arrivesAt>time+1e-8)continue;
      const key=message.key;
      if(message.arrivesAt>=key.expiresAt-1e-8)drop(message,time,'KEY_EXPIRED_IN_TRANSIT');
      else if(message.arrivesAt>message.deadlineAt+1e-8)drop(message,time,'DEADLINE');
      else {
        message.status='DELIVERED';message.deliveredAt=message.arrivesAt;totals.delivered++;
        if(message.compromised)totals.compromisedDelivered++;
        if(o.authenticated&&!message.compromised)totals.authenticatedDelivered++;
        const latency=message.deliveredAt-message.generatedAt;latencyTotal+=latency;maxLatency=Math.max(maxLatency,latency);
      }
      delete message.key;inFlight.splice(i,1);
    }
    while(nextArrival<o.duration-1e-8&&nextArrival<=time+1e-8) {
      const id=++totals.generated,command=id%10===0;
      const message={id,direction:command?'downlink':'uplink',kind:command?'CONTROL_COMMAND':'TELEMETRY',generatedAt:nextArrival,deadlineAt:nextArrival+o.deadlineSec,sentAt:null,deliveredAt:null,keyId:null,nonceCounter:null,status:'QUEUED',reason:null,compromised:false,payload:command?{breaker:'CLOSED',setpointKw:100+id%20}:{voltageV:Number((230+2*Math.sin(nextArrival)).toFixed(2)),frequencyHz:Number((50+.05*Math.sin(nextArrival/3)).toFixed(3))}};
      messages.push(message);pending.push(message);nextArrival=totals.generated/o.messageRate;
    }
    for(let i=0;i<pending.length;) {
      const message=pending[i];
      if(time+o.networkDelaySec>message.deadlineAt+1e-8){drop(message,time,'DEADLINE');pending.splice(i,1);continue;}
      if(blocked){i++;continue;}
      let key=active[message.direction];
      if(key&&(key.uses>=o.messagesPerKey||time+o.networkDelaySec>=key.expiresAt-1e-8)) {
        endKey(key,time,key.uses>=o.messagesPerKey?'EXHAUSTED':'RETIRED');active[message.direction]=null;key=null;
      }
      if(!key&&pool.length) {
        key=pool.shift();key.status='ACTIVE';key.activatedAt=time;key.direction=message.direction;active[message.direction]=key;totals.keysActivated++;
        if(hadActive[message.direction])totals.keyRotations++;hadActive[message.direction]=true;
        event(time,'KEY_ACTIVATED',`${key.id} activated for ${message.direction}; expires at ${key.expiresAt.toFixed(2)} s.`,{keyId:key.id});
      }
      if(!key){i++;continue;}
      // Per-direction key and monotonic counter are metadata, not real AES operations.
      message.keyId=key.id;message.nonceCounter=key.uses++;message.sentAt=time;message.arrivesAt=time+o.networkDelaySec;message.compromised=key.compromised;message.status='IN_FLIGHT';message.key=key;
      inFlight.push(message);pending.splice(i,1);
    }
    const state=blocked?'QUARANTINED':!o.authenticated?'UNAUTHENTICATED':pending.length?'WAITING_FOR_KEYS':'ACTIVE';
    const waiting=blocked||pending.length>0||!pool.length&&!Object.values(active).some(key=>key&&key.uses<o.messagesPerKey&&time+o.networkDelaySec<key.expiresAt-1e-8);
    if(tick<ticks&&waiting)totals.blockedSec+=Math.min(SCADA_TICK,o.duration-time);
    snapshots.push({time,state,queue:pending.length,poolKeys:pool.length,activeKeys:Object.values(active).filter(Boolean).length,delivered:totals.delivered,generatedBits:totals.estimatedBits,lastQber});
  }
  // Export identifiers rather than live key object references.
  for(const message of messages)delete message.key;
  totals.pending=messages.filter(m=>m.status==='QUEUED'||m.status==='IN_FLIGHT').length;
  const meanLatencySec=totals.delivered?latencyTotal/totals.delivered:null;
  const commandRate=o.messageRate/10,telemetryRate=o.messageRate-commandRate;
  const demandKeysPerSec=Math.max(1/o.keyLifetime,commandRate/o.messagesPerKey)+Math.max(1/o.keyLifetime,telemetryRate/o.messagesPerKey);
  return {options:o,qkdConfig:config,resolutionSec:SCADA_TICK,generationSec,summary:{...totals,bitsPerSecond:totals.estimatedBits/o.duration,keysPerSecond:totals.keysGenerated/o.duration,qkdRounds:rounds.length,meanLatencySec,maxLatencySec:totals.delivered?maxLatency:null,availability:Math.max(0,1-totals.blockedSec/o.duration),demandBitsPerSecond:128*demandKeysPerSec,deliveryFraction:totals.generated?totals.delivered/totals.generated:0},snapshots,rounds,keys,messages,events,limitations:[
    'Discrete 100 ms simulation; pulse rate and post-processing time are configurable assumptions, not hardware benchmarks.',
    'Session keys are 128-bit budget units with IDs; no secret bytes, AES encryption, real signatures, or live SCADA connections are performed.',
    'An ideal authentication checker and bootstrap trust are assumed when enabled; authentication-cost bits are already deducted in QKD estimates.',
    'IR/noise exposure is averaged over the pulse-transmission part of each QKD block; MITM covers the whole exchange. A partially exposed PNS block is modeled conservatively as fully exposed.',
    'QBER alerts indicate disturbance, not proof of attack. Unauthenticated MITM may retain normal QBER; compromised-message labels use simulator ground truth.',
    'Nominal demand is a two-direction steady-state estimate; actual rotations, pool expiry, overflow, and attack overhead can require more key material.',
    'Availability measures time without a key-resource/security stall; delivery fraction and deadline misses separately measure traffic performance.',
    'MITM compromises newly negotiated keys only; existing uncompromised session keys remain private until rotation. QBER baseline is calibrated from the configured honest-channel model, not inferred from live hardware.',
    'Security checks precede delivery at each 100 ms tick; an alarm conservatively cancels all in-flight traffic in that tick.'
  ]};
}

export function compareScada(options={},qkdConfig={}) {
  const results=['BB84','B92'].map(protocol=>simulateScada(options,{...qkdConfig,protocol}));
  const ranked=results.filter(r=>r.options.authenticated&&r.summary.authenticatedDelivered>0&&r.summary.compromisedDelivered===0).sort((a,b)=>b.summary.authenticatedDelivered-a.summary.authenticatedDelivered);
  const tied=ranked.length===2&&ranked[0].summary.authenticatedDelivered===ranked[1].summary.authenticatedDelivered;
  return {mode:'scada-comparison',results,recommendation:ranked.length&&!tied?ranked[0].qkdConfig.protocol:null,reason:tied?'Both protocols delivered the same number of authenticated modeled messages within deadline. Compare delays, key supply and outage duration.':ranked.length?`${ranked[0].qkdConfig.protocol} delivered more eligible modeled messages within deadline. This ranks this scenario’s availability, not intrinsic key security.`:'Neither run supplies authenticated modeled communication; review key supply, channel conditions and classical-channel authentication.'};
}
