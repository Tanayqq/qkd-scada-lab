export function channelCandidateCounts(runs) {
  const counts={total:runs.length,accepted:0,rejected:0,other:0};
  for(const r of runs){
    if(r.status==='REJECT'||r.gainMismatch)counts.rejected++;
    else if(['ACCEPT','ALERT'].includes(r.status)&&r.finalBits>0&&r.finalBits>=r.config.requiredBits)counts.accepted++;
    else counts.other++;
  }
  return counts;
}
export function liveCandidateCounts(rounds) {
  const counts={total:rounds.length,accepted:0,rejected:0,recovery:0};
  for(const r of rounds){if(r.accepted)counts.accepted++;else if(r.alarm)counts.rejected++;else counts.recovery++;}
  return counts;
}
export function pulsePreviewCounts(events) {
  const total=events.length,kept=events.filter(e=>e.conclusive).length,lost=events.filter(e=>!e.detected).length;
  return {total,kept,discarded:total-kept-lost,lost,errors:events.filter(e=>e.conclusive&&e.error).length,disclosed:events.filter(e=>e.conclusive&&e.sampled).length};
}
