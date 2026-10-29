// Educational prepare-and-measure model; no generated bits are cryptographic keys.
const DEFAULTS = {protocol:'BB84',pulses:10000,noise:.05,attack:'none',interception:1,lossDb:0,efficiency:1,darkCount:0,source:'ideal',mu:.5,sampleFraction:.25,seed:42,eps:1e-6,requiredBits:128};
export function normalize(input={}) {
  const c={...DEFAULTS,...input};
  for (const [key,values] of Object.entries({protocol:['BB84','B92'],attack:['none','ir','pns'],source:['ideal','wcp']}))
    if(!values.includes(c[key])) throw new RangeError(`Invalid ${key}`);
  for(const key of ['noise','interception','efficiency','darkCount','sampleFraction'])
    if(!Number.isFinite(c[key])||c[key]<0||c[key]>1) throw new RangeError(`${key} must be in [0,1]`);
  for(const key of ['pulses','seed','requiredBits']) if(!Number.isSafeInteger(c[key])) throw new RangeError(`${key} must be an integer`);
  if(c.pulses<1||c.pulses>1e6||c.requiredBits<0) throw new RangeError('pulses must be 1..1000000 and requiredBits nonnegative');
  if(!Number.isFinite(c.lossDb)||c.lossDb<0||c.lossDb>100) throw new RangeError('lossDb must be in [0,100]');
  if(!Number.isFinite(c.mu)||c.mu<=0||c.mu>5) throw new RangeError('mu must be in (0,5]');
  if(!Number.isFinite(c.eps)||c.eps<=0||c.eps>=1) throw new RangeError('eps must be in (0,1)');
  if(c.attack==='pns'&&c.source!=='wcp') throw new RangeError('PNS requires a weak coherent pulse source');
  return c;
}
function rng(seed,salt) {
  let state=(seed^salt)>>>0;
  return ()=>{state=(state+0x6D2B79F5)>>>0;let x=state;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};
}
export function h2(q) {if(q<=0||q>=1)return 0;return -q*Math.log2(q)-(1-q)*Math.log2(1-q);}
export function qberUpper(q,n,eps=1e-6) {
  if(n<=0||q>=.5)return .5;
  const target=Math.log(1/eps)/n;
  let low=q,high=.5;
  // Invert binary relative entropy in natural units (Chernoff/KL bound).
  for(let i=0;i<60;i++){const mid=(low+high)/2;const divergence=q===0?-Math.log1p(-mid):q*Math.log(q/mid)+(1-q)*Math.log((1-q)/(1-mid));if(divergence>target)high=mid;else low=mid;}
  return high;
}
export function gllpRate(q,delta=1,fec=1.16) {return delta<=0||q/delta>=.5?0:Math.max(0,delta*(1-h2(q/delta))-fec*h2(q));}

export function binomialInterval(successes, trials, eps=1e-6) {
  if(!Number.isSafeInteger(trials)||trials<1||!Number.isSafeInteger(successes)||successes<0||successes>trials||!(eps>0&&eps<1)) throw new RangeError('Invalid confidence interval');
  const q=successes/trials,budget=Math.log(2/eps)/trials;
  const kl=p=>(q===0?0:q*Math.log(q/p))+(q===1?0:(1-q)*Math.log((1-q)/(1-p)));
  let lo=0,hi=q;
  for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(kl(mid)>budget)lo=mid;else hi=mid;}
  const lower=q===0?0:lo;lo=q;hi=1;
  for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(kl(mid)>budget)hi=mid;else lo=mid;}
  return [lower,q===1?1:hi];
}

// Source-replacement dual witness for the standard B92 filter (gamma=beta).
// Each witness is an operator upper bound, so incomplete minimization only
// reduces yield. IID confidence intervals are NOT a coherent-attack proof.
export function b92PhaseBound({source='ideal',pulses,detected,sifted,errors,sample,eps=1e-6}) {
  if(source!=='ideal')return {supported:false,phaseUpper:.5,reason:'B92 weak-coherent-source security requires additional tagging/decoy analysis.'};
  if(!sample||!sifted)return {supported:false,phaseUpper:.5,reason:'Insufficient B92 observations.'};
  const a=(1-1/Math.sqrt(2))/2,b=1-a,ab=Math.sqrt(a*b);
  const conclusive=binomialInterval(sifted,pulses,eps/3),loss=binomialInterval(pulses-detected,pulses,eps/3);
  const qInterval=binomialInterval(errors,sample,eps/3),errorUpper=qInterval[1]*conclusive[1];
  const eigen=(u,v,z)=>(u+v)/2+Math.hypot((u-v)/2,z);
  function witness(coefficients) {
    const [le,lc,ll,la]=coefficients,z=le*ab/2;
    const identity=Math.max(
      eigen(-lc*a-le*a/2,-lc*b-la-le*b/2,z),
      eigen(b-lc*b-le*b/2,a-lc*a-la-le*a/2,z),-ll,-ll-la
    )+1e-11*(1+coefficients.reduce((sum,x)=>sum+Math.abs(x),0));
    return {joint:identity+le*errorUpper+lc*conclusive[lc>=0?1:0]+ll*loss[ll>=0?1:0]+la*a,identity};
  }
  let best={joint:Infinity};
  // Bounded deterministic convex coordinate search; no optimum is asserted.
  for(const initial of [[4,0,1,0],[16,-2,4,-1],[64,-8,16,0]]) {
    let coefficients=[...initial];
    for(let round=0;round<16;round++)for(let axis=0;axis<4;axis++) {
      let lo=axis===0?0:-256,hi=256;
      for(let step=0;step<38;step++) {
        const x=lo+(hi-lo)/3,y=hi-(hi-lo)/3;
        const cx=[...coefficients],cy=[...coefficients];cx[axis]=x;cy[axis]=y;
        if(witness(cx).joint<witness(cy).joint)hi=y;else lo=x;
      }
      const next=[...coefficients];next[axis]=(lo+hi)/2;
      if(witness(next).joint<witness(coefficients).joint)coefficients=next;
    }
    const candidate=witness(coefficients);
    if(candidate.joint<best.joint)best={...candidate,coefficients};
  }
  // Refine coupled coefficients: coordinate search alone can stall on the
  // nondifferentiable eigenvalue envelope. Every returned point is still a witness.
  const score=c=>c[0]<0||c.some(x=>!Number.isFinite(x)||Math.abs(x)>1e6)?Infinity:witness(c).joint;
  let simplex=[best.coefficients,...best.coefficients.map((_,axis)=>best.coefficients.map((x,i)=>x+(i===axis?Math.max(1,Math.abs(x)*.2):0)))];
  for(let iteration=0;iteration<1000;iteration++) {
    simplex.sort((x,y)=>score(x)-score(y));
    const center=simplex[0].map((_,axis)=>simplex.slice(0,4).reduce((sum,c)=>sum+c[axis],0)/4);
    const point=f=>center.map((x,axis)=>x+f*(center[axis]-simplex[4][axis]));
    const reflected=point(1),value=score(reflected);
    if(value<score(simplex[0])){const expanded=point(2);simplex[4]=score(expanded)<value?expanded:reflected;}
    else if(value<score(simplex[3]))simplex[4]=reflected;
    else {
      const contracted=value<score(simplex[4])?point(.5):point(-.5);
      if(score(contracted)<Math.min(value,score(simplex[4])))simplex[4]=contracted;
      else simplex=simplex.map((c,i)=>i?c.map((x,axis)=>(x+simplex[0][axis])/2):c);
    }
  }
  simplex.sort((x,y)=>score(x)-score(y));
  if(score(simplex[0])<best.joint)best={...witness(simplex[0]),coefficients:simplex[0]};
  if(best.joint < -1e-8)return {supported:false,phaseUpper:.5,reason:'Observed intervals are inconsistent with the assumed B92 qubit model.'};
  const joint=Math.max(0,best.joint),phaseUpper=conclusive[0]>0?Math.min(.5,joint/conclusive[0]):.5;
  return {supported:true,phaseUpper,phaseJointUpper:joint,conclusiveInterval:conclusive,lossInterval:loss,errorJointUpper:errorUpper,witness:{coefficients:best.coefficients,identity:best.identity},confidenceFailure:eps,model:'IID single-photon B92 operator witness'};
}

// Exact binomial upper tail, summed outward from its mode to avoid factorial overflow.
export function detectionProbability(n,p,threshold=0) {
  if(!Number.isSafeInteger(n)||n<0||!Number.isFinite(p)||p<0||p>1||!Number.isFinite(threshold)||threshold<0||threshold>1) throw new RangeError('Invalid binomial parameters');
  const k=Math.floor(n*threshold);
  if(n===0||k>=n||p===0)return 0;if(p===1)return 1;
  if(k===0)return -Math.expm1(n*Math.log1p(-p));
  const mode=Math.floor((n+1)*p);
  if(k>=mode) {
    const first=k+1,terms=Math.min(first,n-first);
    let logChoose=0;
    for(let i=1;i<=terms;i++)logChoose+=Math.log(n-terms+i)-Math.log(i);
    const logMass=logChoose+first*Math.log(p)+(n-first)*Math.log1p(-p);
    let relative=1,sum=1;
    for(let i=first;i<n;i++){relative*=(n-i)/(i+1)*p/(1-p);sum+=relative;if(relative<sum*1e-16)break;}
    return Math.min(1,Math.exp(logMass)*sum);
  }
  let total=1,tail=mode>k?1:0,weight=1;
  for(let i=mode;i>0;i--){weight*=i/(n-i+1)*(1-p)/p;total+=weight;if(i-1>k)tail+=weight;if(weight<total*1e-16)break;}
  weight=1;
  for(let i=mode;i<n;i++){weight*=(n-i)/(i+1)*p/(1-p);total+=weight;if(i+1>k)tail+=weight;if(weight<total*1e-16)break;}
  return Math.min(1,Math.max(0,tail/total));
}
export function expectedStats(input={}) {
  const c=normalize(input),t=10**(-c.lossDb/10),p=c.attack==='ir'?c.interception:0,e=c.noise;
  const conclusive=c.protocol==='BB84'?.5:.25+p/8+e*(.5-p/4);
  const qber=c.protocol==='BB84'?e+p/4-e*p/2:(p/8+e/2-e*p/4)/conclusive;
  const signal=c.source==='ideal'?t*c.efficiency:1-Math.exp(-c.mu*t*c.efficiency);
  const honestGain=signal+(1-signal)*c.darkCount;
  // PNS keeps one photon; surviving photons reach Bob over Eve's lossless link.
  let capacity=0,prob=Math.exp(-c.mu);
  for(let n=1;n<100;n++){prob*=c.mu/n;if(n>=2)capacity+=prob*(1-(1-c.efficiency)**(n-1));}
  const forward=c.attack==='pns'?(capacity?Math.min(1,signal/capacity):0):1;
  const actualSignal=c.attack==='pns'?capacity*forward:signal;
  const gain=actualSignal+(1-actualSignal)*c.darkCount;
  const darkShare=gain?(1-actualSignal)*c.darkCount/gain:0;
  const observedConclusive=(1-darkShare)*conclusive+darkShare*.5;
  const observedQber=observedConclusive?((1-darkShare)*conclusive*qber+darkShare*.25)/observedConclusive:0;
  return {qber:observedQber,conclusive:observedConclusive,gain,honestGain,signal,capacity,forward,multiPhotonProbability:1-Math.exp(-c.mu)*(1+c.mu)};
}
export function compareProtocols(input={}) {
  const results = ['BB84', 'B92'].map(protocol => simulate({...input, protocol}));
  const eligible = results.filter(r=>['ACCEPT','ALERT'].includes(r.status)&&r.finalBits>0&&r.finalBits>=r.config.requiredBits&&!r.gainMismatch);
  eligible.sort((a,b)=>b.finalBits-a.finalBits);
  const winner=eligible[0],tied=winner&&eligible[1]?.finalBits===winner.finalBits;
  return {
    mode: 'comparison', results,
    recommendation: winner&&!tied?winner.config.protocol:null,
    reason: tied?'Both protocols meet the modeled target with equal estimated output; no yield winner.' : winner
      ? `${winner.config.protocol} has the larger eligible estimated key budget (${winner.finalBits} bits). This compares modeled yield, not proof that its key is more secure. Both are instructional estimates; review each bound and its assumptions.`
      : 'Neither protocol passes the modeled key-budget and channel checks. Increase the signal count, reduce noise/loss, or review source assumptions; no key is recommended.'
  };
}
export function interceptionCurve(input={},steps=20) {
  if(!Number.isInteger(steps)||steps<1||steps>100)throw new RangeError('Curve steps must be 1..100');
  return ['BB84','B92'].map(protocol=>({protocol,points:Array.from({length:steps+1},(_,i)=>{
    const fraction=i/steps;
    return {fraction,qber:expectedStats({...input,protocol,attack:'ir',interception:fraction}).qber};
  })}));
}
export function simulate(input={}) {
  const c=normalize(input),expected=expectedStats(c);
  const source=rng(c.seed,0x243f6a88),channel=rng(c.seed,0x85a308d3),bob=rng(c.seed,0x13198a2e),eve=rng(c.seed,0x03707344),sampling=rng(c.seed,0xa4093822);
  const t=10**(-c.lossDb/10),bits=[],trace=[],audit=[],counts={pulses:c.pulses,emitted:0,vacuum:0,multiPhoton:0,detected:0,sifted:0,sample:0,keyBits:0,errors:0,siftedErrors:0};
  for(let i=0;i<c.pulses;i++) {
    let photons=1;
    if(c.source==='wcp'){photons=-1;let product=1;do{photons++;product*=source();}while(product>Math.exp(-c.mu));}
    if(photons)counts.emitted++;else counts.vacuum++;
    if(photons>1)counts.multiPhoton++;
    const aliceDraw=source(),aliceBit=aliceDraw<.5?0:1,basisDraw=source(),aliceBasis=c.protocol==='BB84'?(basisDraw<.5?0:1):aliceBit;
    const signalDraw=channel(),darkDraw=channel(),noiseDraw=channel();
    const bobBasisDraw=bob(),bobBasis=bobBasisDraw<.5?0:1,bobDraw=bob();
    const eveForward=eve(),eveIntercept=eve(),eveBasisDraw=eve(),eveBasis=eveBasisDraw<.5?0:1,eveDraw=eve();
    let stateBasis=aliceBasis,stateBit=c.protocol==='BB84'?aliceBit:0;
    let signalProbability=1-(1-t*c.efficiency)**photons;
    if(c.attack==='pns') signalProbability=photons>=2&&eveForward<expected.forward?1-(1-c.efficiency)**(photons-1):0;
    const signal=signalDraw<signalProbability,dark=darkDraw<c.darkCount;
    // Keep a bounded audit from the same trials; recording makes no extra RNG calls.
    const event=i<128?{pulse:i+1,photons,aliceBit,aliceBasis,bobBasis,bobOutcome:null,bobBit:null,signal,darkOnly:!signal&&dark,detected:signal||dark,conclusive:false,error:false,sampled:false,status:'lost',signalProbability,noiseFlipped:signal&&noiseDraw<c.noise,draws:{aliceBit:aliceDraw,aliceBasis:basisDraw,bobBasis:bobBasisDraw,bobOutcome:bobDraw,signal:signalDraw,dark:darkDraw,noise:noiseDraw,eveInterception:eveIntercept,eveBasis:eveBasisDraw,eveOutcome:eveDraw,eveForward},eveAction:c.attack==='pns'?(photons>=2&&eveForward<expected.forward?'split':'block'):c.attack==='ir'&&eveIntercept<c.interception&&signal?'intercept':'none'}:null;
    if(event){audit.push(event);if(i<32)trace.push(event);}
    if(!signal&&!dark)continue;
    counts.detected++;
    if(c.attack==='ir'&&eveIntercept<c.interception){stateBit=eveBasis===stateBasis?stateBit:(eveDraw<.5?0:1);stateBasis=eveBasis;}
    let measured=signal?(bobBasis===stateBasis?stateBit:(bobDraw<.5?0:1)):(bobDraw<.5?0:1);
    if(signal&&noiseDraw<c.noise)measured^=1;
    const conclusive=c.protocol==='BB84'?bobBasis===aliceBasis:measured===1;
    if(event)Object.assign(event,{bobOutcome:measured,conclusive,status:conclusive?'kept':'discarded'});
    if(!conclusive)continue;
    const inferred=c.protocol==='BB84'?measured:1-bobBasis;
    if(event)Object.assign(event,{bobBit:inferred,siftedIndex:bits.length,error:inferred!==aliceBit,status:inferred!==aliceBit?'error':'kept'});
    const wrong=Number(inferred!==aliceBit);bits.push(wrong);counts.siftedErrors+=wrong;
  }
  counts.sifted=bits.length;counts.sample=Math.floor(bits.length*c.sampleFraction);
  // Track only audited positions through the actual sample shuffle, not another sample.
  const tracked=new Map(audit.filter(e=>e.conclusive).map(e=>[e.siftedIndex,e]));
  for(let i=0;i<counts.sample;i++){
    const draw=sampling(),j=i+Math.floor(draw*(bits.length-i));
    const disclosed=tracked.get(j),moved=tracked.get(i);
    if(disclosed)Object.assign(disclosed,{sampled:true,samplingDraw:draw,sampleOrder:i+1});
    tracked.delete(i);tracked.delete(j);if(moved&&i!==j)tracked.set(j,moved);
    [bits[i],bits[j]]=[bits[j],bits[i]];counts.errors+=bits[i];
  }
  counts.keyBits=counts.sifted-counts.sample;
  const qber=counts.sample?counts.errors/counts.sample:0,qUpper=qberUpper(qber,counts.sample,c.eps),gain=counts.detected/c.pulses;
  const delta=c.source==='wcp'?(gain?Math.max(0,1-expected.multiPhotonProbability/gain):0):1;
  const gainMismatch=Math.abs(gain-expected.honestGain)>Math.sqrt(Math.log(2/c.eps)/(2*c.pulses));
  const finitePenalty=2*Math.log2(1/c.eps),verification=34,authentication=64;
  const privateFraction=delta>0&&qUpper/delta<.5?delta*(1-h2(qUpper/delta)):0;
  const b92Bound=c.protocol==='B92'?b92PhaseBound({source:c.source,pulses:c.pulses,detected:counts.detected,sifted:counts.sifted,errors:counts.errors,sample:counts.sample,eps:c.eps}):null;
  const privacy=c.protocol==='B92'?(b92Bound.supported?1-h2(b92Bound.phaseUpper):0):privateFraction;
  const rawBudget=counts.keyBits*(privacy-1.16*h2(qber))-finitePenalty-verification-authentication;
  const budget={privacyFraction:privacy,privacyBits:counts.keyBits*privacy,reconciliationLeakage:counts.keyBits*1.16*h2(qber),rawBudget,beforeChecks:counts.sample?Math.max(0,Math.floor(rawBudget)):0};
  let finalBits=budget.beforeChecks;
  let status='ACCEPT';const warnings=['Educational simulation only; no cryptographic keys or security certification.'];
  if(c.protocol==='BB84'&&counts.sample&&qber>=.05)status='ALERT';
  if(!counts.sample||!counts.keyBits||finalBits<c.requiredBits)status='INSUFFICIENT';
  if(c.protocol==='BB84'&&counts.sample&&qber>.11){status='REJECT';finalBits=0;}
  if(c.protocol==='B92') {
    if(!b92Bound.supported){status=counts.sample?'UNSUPPORTED':'INSUFFICIENT';finalBits=0;warnings.push(b92Bound.reason);}
    if(counts.sample&&qber>.15){status='REJECT';finalBits=0;}
    warnings.push('B92 uses a single-photon IID phase-error witness with sampling intervals. Its finite-bit budget is instructional, not a composable proof against arbitrary coherent attacks.');
    warnings.push('B92 detector losses are modeled as erasure; dark-only clicks as random qubit replacement. An illustrative 15% error alarm is additional to the key-budget check.');
  }
  if(c.attack==='pns')warnings.push('PNS blocks single photons and forwards multiphoton pulses; channel loss is replaced by a lossless Eve-to-Bob link.');
  if(gainMismatch)warnings.push('Observed detection gain differs from the honest channel expectation.');
  if(c.source==='wcp')warnings.push('No decoy states: all multiphoton emissions are conservatively tagged as compromised.');
  if(c.darkCount)warnings.push('Dark-only detections produce random outcomes; simultaneous signal and dark clicks use the signal outcome.');
  return {config:c,counts,trace,audit,budget,detected:counts.detected,sifted:counts.sifted,sample:counts.sample,keyBits:counts.keyBits,errors:counts.errors,qber,siftedQber:counts.sifted?counts.siftedErrors/counts.sifted:0,qUpper,b92Bound,expectedQber:expected.qber,expectedConclusive:expected.conclusive,gain,expectedGain:expected.honestGain,attackExpectedGain:expected.gain,gainMismatch,delta,finalBits,status,warnings,finitePenalty,verification,authentication,pipeline:{sent:c.pulses,detected:counts.detected,sifted:counts.sifted,sampled:counts.sample,remaining:counts.keyBits,final:finalBits},detectionProbability:detectionProbability(counts.sample,expected.qber,c.protocol==='BB84'?.11:.15)};
}
