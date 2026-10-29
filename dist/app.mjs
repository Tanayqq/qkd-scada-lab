import { simulate, compareProtocols, interceptionCurve, h2 } from './engine.mjs';
import {mountScada} from './scada-ui.mjs';

const $ = id => document.getElementById(id);
const form = $('experiment');
const history = [];
let result;
let comparison;
let traceIndex=0,tracePlaying=false,traceEpoch=0;
const count = value => Number(value || 0).toLocaleString('en-US');
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'No sample';
const attackNames = { none: 'No attack', ir: 'Intercept & resend', pns: 'Photon splitting' };
function config() {
  return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, ['protocol', 'attack', 'source'].includes(key) ? value : Number(value)]));
}
function syncControls() {
  $('noise-value').value = `${Math.round(Number($('noise').value) * 1000) / 10}%`;
  $('interception-value').value = `${Math.round(Number($('interception').value) * 100)}%`;
  $('mu').disabled = $('source').value !== 'wcp';
  $('interception').disabled = $('attack').value !== 'ir';
}
function getConfig() {
  // Disabled controls retain model defaults in the exported experiment.
  return { ...config(), mu: Number($('mu').value), interception: Number($('interception').value) };
}
function barRow(label, value, max, extra = '') {
  const row = document.createElement('div');
  row.className = 'pipeline-row';
  const text = document.createElement('span'); text.textContent = label;
  const track = document.createElement('div'); track.className = 'bar-track';
  const bar = document.createElement('div'); bar.className = 'bar'; bar.style.width = `${Math.min(100, Math.max(0, value / Math.max(max, 1) * 100))}%`;
  track.append(bar);
  const amount = document.createElement('b'); amount.textContent = count(value) + extra;
  row.append(text, track, amount);
  return row;
}
function render(r) {
  resetTrace();
  const c = r.config;
  $('run-description').textContent = `RUN ${String(history.length).padStart(2, '0')} / ${c.protocol} / ${count(c.pulses)} pulses / seed ${c.seed}`;
  $('metric-qber').textContent = r.counts.sample ? percent(r.qber) : 'No sample';
  $('metric-bound').textContent = percent(r.qUpper);
  $('metric-bits').textContent = count(r.finalBits);
  $('metric-target').textContent = `Target: ${count(c.requiredBits)} bits · estimate only`;
  $('metric-status').textContent = ({ ACCEPT: 'Target reached', ALERT: 'Elevated errors', INSUFFICIENT: 'Insufficient bits', REJECT: 'Rejected', UNSUPPORTED: 'Unsupported source' })[r.status] || r.status;
  $('metric-status-note').textContent = c.protocol === 'B92' ? 'IID instructional key-length estimate' : r.status === 'ALERT' ? 'At least 5% sampled errors' : r.status === 'REJECT' ? 'Above 11% sampled errors' : 'Not a security certificate';
  $('protocol-label').textContent = c.protocol;
  $('gain').textContent = percent(r.gain);
  $('expected-gain').textContent = `${percent(r.expectedGain)}${r.gainMismatch ? ' · mismatch' : ''}`;
  $('delta').textContent = c.source === 'wcp' ? percent(r.delta) : '100% · ideal source';
  $('source-label').textContent = c.source === 'ideal' ? 'Single photon' : `Coherent · μ ${c.mu}`;
  $('expected-qber').textContent = percent(r.expectedQber);
  $('eve-bg').setAttribute('fill', c.attack === 'none' ? '#e7ece5' : '#f1ddca');
  $('eve-title').textContent = c.attack === 'none' ? 'EVE ABSENT' : 'EVE ACTIVE';
  $('eve-caption').textContent = c.attack === 'none' ? 'unobserved channel' : c.attack === 'ir' ? 'intercept & resend' : 'photon splitting';
  $('channel-desc').textContent = `${c.protocol}: Alice prepares photons for Bob. ${attackNames[c.attack]}. Detection gain ${percent(r.gain)}.`;
  const stages = [['Sent', 'sent'], ['Detected', 'detected'], ['Sifted', 'sifted'], ['Disclosed', 'sampled'], ['Remaining', 'remaining'], ['Final estimate', 'final']];
  $('pipeline').replaceChildren(...stages.map(([label, key]) => barRow(label, r.pipeline[key], c.pulses)));
  const chart = $('error-chart'); chart.replaceChildren();
  for (const [label, value] of [['Expected QBER', r.expectedQber], ['Sample QBER', r.counts.sample ? r.qber : null], ['Upper confidence bound', r.qUpper]]) {
    const row = document.createElement('div'); row.className = 'error-row';
    const caption = document.createElement('div'); caption.className = 'error-caption';
    const name = document.createElement('span'); name.textContent = label;
    const val = document.createElement('strong'); val.textContent = percent(value);
    caption.append(name, val);
    const track = document.createElement('div'); track.className = 'bar-track';
    const bar = document.createElement('div'); bar.className = 'bar'; bar.style.width = `${Number.isFinite(value) ? Math.max(0, Math.min(100, value * 100)) : 0}%`;
    track.append(bar); row.append(caption, track); chart.append(row);
  }
  const axis = document.createElement('div'); axis.className = 'error-axis';
  const zero = document.createElement('span'); zero.textContent = '0%'; const full = document.createElement('span'); full.textContent = '100%'; axis.append(zero, full); chart.append(axis);
  $('error-explanation').textContent = `${count(r.counts.errors)} errors across ${count(r.counts.sample)} disclosed bits. A small sample widens the confidence bound. The bound uses ε = ${c.eps}; this is only the parameter-estimation failure probability.`;
  $('thresholds').textContent = c.protocol === 'BB84' ? 'Operational thresholds: warn at ≥5% sampled QBER; reject above 11%. Reaching the bit target is not a security proof.' : 'B92 output uses its own phase-error bound and key-budget check. The additional 15% sampled-error alarm is illustrative, not a security threshold.';
  $('b92-bound').hidden = c.protocol !== 'B92';
  if (r.b92Bound) $('b92-bound').textContent = r.b92Bound.supported ? `B92 phase-error upper bound: ${percent(r.b92Bound.phaseUpper)}. Single-photon IID operator witness; conclusive-rate interval ${percent(r.b92Bound.conclusiveInterval[0])}–${percent(r.b92Bound.conclusiveInterval[1])}. Three confidence-interval families share ε = ${c.eps}. The finite-bit deduction is instructional, not a composable security certificate.` : r.b92Bound.reason;
  $('detection-probability').textContent = `P(sample QBER exceeds operational reject threshold): ${r.detectionProbability > 0 && r.detectionProbability < 0.0001 ? (r.detectionProbability * 100).toExponential(2) + '%' : percent(r.detectionProbability)}. Exact binomial estimate at the model’s expected error rate and this run’s sample size; it does not identify an attacker.`;
  const reconciliation = Math.ceil(r.counts.keyBits * 1.16 * h2(r.qber));
  $('leakage').textContent = `Modeled costs: reconciliation ≈ ${count(reconciliation)} bits (1.16 × remaining bits × h₂(sample QBER)); finite-size penalty ${r.finitePenalty.toFixed(1)} bits; verification ${r.verification} bits; authentication ${r.authentication} bits. Privacy reduction uses ${c.protocol === 'B92' ? 'the B92 phase-error witness' : 'the QBER bound and untagged fraction'}.`;
  $('warnings').replaceChildren(...(r.warnings || []).map(message => { const p = document.createElement('p'); p.textContent = message; return p; }));
  const maxBits = Math.max(1, ...history.slice(-6).map(item => item.finalBits));
  $('history').replaceChildren(...[...history].reverse().slice(0, 6).map((item, index) => {
    const card = document.createElement('article'); card.className = 'history-card';
    const title = document.createElement('div'); title.className = 'history-title';
    const protocol = document.createElement('span'); protocol.textContent = `${item.config.protocol} · ${attackNames[item.config.attack]}`;
    const order = document.createElement('span'); order.textContent = `#${history.length - index}`;
    title.append(protocol, order);
    const bits = document.createElement('strong'); bits.textContent = `${count(item.finalBits)} estimated bits`;
    const track = document.createElement('div'); track.className = 'bar-track'; const bar = document.createElement('div'); bar.className = 'bar'; bar.style.width = `${item.finalBits / maxBits * 100}%`; track.append(bar);
    const detail = document.createElement('p'); detail.textContent = `Sample QBER ${item.counts.sample ? percent(item.qber) : 'unavailable'} · ${count(item.config.pulses)} pulses · noise ${percent(item.config.noise)} · seed ${item.config.seed}`;
    card.append(title, bits, track, detail); return card;
  }));
  renderEvidence(r);
  $('stale').hidden = true; $('download').disabled = false;
  $('announcement').textContent = `Experiment complete. ${r.status}. ${count(r.finalBits)} estimated final bits. Sample QBER ${r.counts.sample ? percent(r.qber) : 'unavailable'}.`;
}
function renderEvidence(r) {
  const records=r.audit,kept=records.filter(e=>e.conclusive),disclosed=kept.filter(e=>e.sampled),remaining=kept.filter(e=>!e.sampled);
  const bits=(events,key)=>events.length?events.map(e=>e[key]).join(''):'No bits in this preview';
  $('evidence-run').textContent=`${r.config.protocol} · seed ${r.config.seed} · ${count(r.config.pulses)} Monte Carlo trials · ${count(r.finalBits)} estimated final bits`;
  $('evidence-check').textContent='Repeat this seed to check that the same trials reproduce the displayed result. The buttons use this displayed run’s settings.';
  $('evidence-scope').textContent=`First ${records.length} of ${count(r.config.pulses)} actual pulse trials: ${kept.length} retained, ${disclosed.length} disclosed and ${remaining.length} remaining raw bits. Full-run totals below include every trial.`;
  for(const [id,value] of [['alice',bits(records,'aliceBit')],['sifted-alice',bits(kept,'aliceBit')],['sifted-bob',bits(kept,'bobBit')],['disclosed',bits(disclosed,'aliceBit')],['remaining-alice',bits(remaining,'aliceBit')],['remaining-bob',bits(remaining,'bobBit')]])$('evidence-'+id).textContent=value;
  const decimal=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:3});
  const b=r.budget;
  const calculation=[
    `${count(r.config.pulses)} sampled pulse trials produced ${count(r.detected)} detections and ${count(r.sifted)} retained bits.`,
    `QBER = ${count(r.errors)} disagreements / ${count(r.sample)} disclosed test bits${r.sample?` = ${percent(r.qber)}`:'; no QBER sample is available'}. These are observed counts, not the expected-QBER reference.`,
    `${count(r.sifted)} retained − ${count(r.sample)} disclosed = ${count(r.keyBits)} remaining raw bits.`,
    `The ${r.config.protocol==='B92'?'B92 phase-error bound':'BB84 error bound and source tagging'} gives a modeled privacy fraction of ${decimal(b.privacyFraction)}: ${count(r.keyBits)} × ${decimal(b.privacyFraction)} = ${decimal(b.privacyBits)} bits before other costs.`,
    `Subtract modeled reconciliation ${decimal(b.reconciliationLeakage)}, finite-size ${decimal(r.finitePenalty)}, verification ${r.verification} and authentication ${r.authentication} bits. Raw budget: ${decimal(b.rawBudget)}.`,
    `Round down and clamp at zero: ${count(b.beforeChecks)} bits before channel checks. Final checked estimate: ${count(r.finalBits)} bits (${r.status}).${r.status==='UNSUPPORTED'?' This source is outside the implemented privacy-bound model.':r.status==='REJECT'?' The operational error check rejects this run.':''}`
  ];
  $('evidence-calculation').replaceChildren(...calculation.map(value=>{const li=document.createElement('li');li.textContent=value;return li;}));
  $('evidence-table-caption').textContent=`${r.config.protocol}, seed ${r.config.seed}: first ${records.length} pulse trials from the displayed run`;
  const draw=value=>Number(value).toFixed(8);
  $('evidence-trials').replaceChildren(...records.map(e=>{
    const row=document.createElement('tr');
    const state=r.config.protocol==='B92'?(e.aliceBit?'|+⟩':'|0⟩'):e.aliceBasis?(e.aliceBit?'|−⟩':'|+⟩'):(e.aliceBit?'|1⟩':'|0⟩');
    const decision=!e.detected?'Not detected':!e.conclusive?'Discarded':`${e.sampled?'Disclosed test bit':'Remaining raw bit'}${e.error?' · disagreement':''}`;
    row.className=e.sampled?'evidence-sampled':e.error?'evidence-error':'';
    const values=[e.pulse,`${e.aliceBit} / ${state}`,draw(e.draws.aliceBit),`${e.bobBasis?'X':'Z'} / ${draw(e.draws.bobBasis)}`,e.detected?`${e.bobOutcome} / ${e.conclusive?e.bobBit:'discard'}`:'No detection',`${draw(e.draws.signal)} / ${draw(e.draws.noise)}`,decision];
    for(const value of values){const td=document.createElement('td');td.textContent=String(value);row.append(td);}return row;
  }));
}
function renderComparison() {
  renderGraphs();
  $('comparison').hidden = !comparison;
  if (!comparison) return;
  $('comparison-verdict').textContent = `${comparison.recommendation ? `Modeled choice: ${comparison.recommendation}. ` : 'No yield winner. '}${comparison.reason}`;
  $('comparison-detail').textContent = `The detailed results below show ${result.config.protocol}. Both runs use identical inputs and seed; shared source and channel random streams support comparison.`;
  $('comparison-cards').replaceChildren(...comparison.results.map(item => {
    const card = document.createElement('article'); card.className = 'comparison-card';
    const title = document.createElement('h3'); title.textContent = item.config.protocol;
    const stats = document.createElement('dl');
    const rows = [
      ['Sifted bits', count(item.sifted)],
      ['Disclosed sample', count(item.sample)],
      ['Sample QBER', item.sample ? percent(item.qber) : 'No sample'],
      ['QBER upper bound', percent(item.qUpper)],
      ['Detection gain', percent(item.gain)],
      ['Remaining bits', count(item.keyBits)],
      ['Estimated final bits', item.status === 'UNSUPPORTED' ? 'Unsupported source model' : count(item.finalBits)],
      ['Privacy bound', item.config.protocol === 'B92' ? (item.b92Bound.supported ? `Phase error ≤ ${percent(item.b92Bound.phaseUpper)}` : 'Unsupported') : `QBER ≤ ${percent(item.qUpper)}`],
      ['Outcome', item.status],
      ['Gain check', item.gainMismatch ? 'Mismatch' : 'Within model tolerance']
    ];
    for (const [label, value] of rows) {
      const term = document.createElement('dt'); term.textContent = label;
      const definition = document.createElement('dd'); definition.textContent = value;
      stats.append(term, definition);
    }
    const button = document.createElement('button'); button.type = 'button'; button.className = 'inspect-button';
    button.textContent = `Inspect ${item.config.protocol}`;
    button.setAttribute('aria-pressed', String(result.config.protocol === item.config.protocol));
    button.addEventListener('click', () => {
      const wasStale = !$('stale').hidden;
      result = item; render(item); renderComparison(); $('stale').hidden = !wasStale;
    });
    card.append(title, stats, button); return card;
  }));
}
function svgNode(tag,attributes={},text) {
  const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  if(text!==undefined)node.textContent=text;
  return node;
}
function graphFrame(id,title,maxY,format) {
  const svg=svgNode('svg',{viewBox:'0 0 380 260',role:'img','aria-label':title,class:'plot'});
  svg.append(svgNode('title',{},title));
  const y=value=>210-value/maxY*180;
  for(let tick=0;tick<=4;tick++) {
    const value=maxY*tick/4;
    svg.append(svgNode('line',{x1:58,y1:y(value),x2:360,y2:y(value),stroke:'#dce2d5'}));
    svg.append(svgNode('text',{x:50,y:y(value)+4,'text-anchor':'end',class:'plot-label'},format(value)));
  }
  $(id).replaceChildren(svg);return {svg,y};
}
function renderGraphs() {
  const runs=comparison?comparison.results:[result];
  const maximum=Math.max(result.config.requiredBits,...runs.map(r=>r.finalBits),1)*1.2;
  const output=graphFrame('key-graph','Estimated final bits versus target',maximum,v=>Math.round(v).toLocaleString('en-US'));
  output.svg.append(svgNode('line',{x1:58,x2:360,y1:output.y(result.config.requiredBits),y2:output.y(result.config.requiredBits),stroke:'#5a676d','stroke-dasharray':'5 4'}));
  for(let i=0;i<runs.length;i++) {
    const r=runs[i],x=58+(i+.5)*302/runs.length;
    output.svg.append(svgNode('rect',{x:x-35,y:output.y(r.finalBits),width:70,height:210-output.y(r.finalBits),rx:4,fill:r.config.protocol==='BB84'?'#267b65':'#ba6a32'}));
    output.svg.append(svgNode('text',{x,y:output.y(r.finalBits)-9,'text-anchor':'middle',class:'plot-value'},count(r.finalBits)));
    output.svg.append(svgNode('text',{x,y:235,'text-anchor':'middle',class:'plot-label'},r.config.protocol));
  }
  $('key-graph-caption').textContent=`Dashed line: ${count(result.config.requiredBits)}-bit target. ${runs.map(r=>`${r.config.protocol}: ${count(r.finalBits)} estimated bits${r.status==='UNSUPPORTED'?' (unsupported source)':''}`).join('; ')}. ${comparison?'Same settings and seed.':'Select Compare BB84 and B92 for paired output.'}`;
  const curves=interceptionCurve(result.config),maxQ=Math.max(.4,...curves.flatMap(series=>series.points.map(p=>p.qber)))*1.12;
  const sensitivity=graphFrame('sensitivity-graph','Expected QBER versus fraction of pulses intercepted',maxQ,v=>`${Math.round(v*100)}%`);
  sensitivity.svg.append(svgNode('text',{x:90,y:17,fill:'#267b65',class:'plot-value'},'BB84'));
  sensitivity.svg.append(svgNode('text',{x:195,y:17,fill:'#ba6a32',class:'plot-value'},'B92'));
  for(const series of curves) {
    const color=series.protocol==='BB84'?'#267b65':'#ba6a32';
    const points=series.points.map(p=>`${58+p.fraction*302},${sensitivity.y(p.qber)}`).join(' ');
    sensitivity.svg.append(svgNode('polyline',{points,fill:'none',stroke:color,'stroke-width':3}));
  }
  for(const fraction of [0,.25,.5,.75,1])sensitivity.svg.append(svgNode('text',{x:58+fraction*302,y:235,'text-anchor':'middle',class:'plot-label'},`${fraction*100}%`));
  sensitivity.svg.append(svgNode('text',{x:209,y:255,'text-anchor':'middle',class:'plot-label'},'Fraction intercepted by Eve'));
  $('sensitivity-caption').textContent=`Analytic intercept-resend reference, not measured sweep data. Uses this run’s noise (${percent(result.config.noise)}), loss, source and detector settings; varies interception from 0 to 100%. Orange: B92; green: BB84. This reference is separate from a selected PNS attack.`;
}
function pauseTrace() {
  tracePlaying=false;traceEpoch++;$('trace-play').textContent=traceIndex>=result?.trace.length?'Replay photons':'Play photons';
}
function resetTrace() {
  pauseTrace();traceIndex=0;$('trace-play').textContent='Play photons';
  $('trace-status').textContent='Ready: play or step through the first 32 pulses of the displayed run.';
  for(const id of ['trace-alice','trace-eve','trace-bob','trace-decision'])$(id).textContent='—';
  $('trace-bits').replaceChildren();$('photon-motion').setAttribute('class','photon-motion');
}
function advanceTrace() {
  const event=result?.trace[traceIndex];if(!event)return false;
  traceIndex++;
  const state=result.config.protocol==='B92'?(event.aliceBit?'|+⟩':'|0⟩'):event.aliceBasis?(event.aliceBit?'|−⟩':'|+⟩'):(event.aliceBit?'|1⟩':'|0⟩');
  $('trace-alice').textContent=`Bit ${event.aliceBit} · ${state} · ${event.photons} photon${event.photons===1?'':'s'}`;
  $('trace-eve').textContent=event.eveAction==='intercept'?'Eve intercepts and resends':event.eveAction==='split'?'Eve retains a photon':event.eveAction==='block'?'Eve blocks this pulse':event.photons===0?'Vacuum pulse':'No intervention';
  $('trace-bob').textContent=event.detected?`${event.bobBasis?'X':'Z'} basis · outcome ${event.bobOutcome}${event.darkOnly?' · dark-only click':''}`:'No detection';
  const decision={lost:'Lost / not detected',discarded:result.config.protocol==='B92'?'Inconclusive · discard':'Basis mismatch · discard',kept:'Sifted · bits agree',error:'Sifted · bit error'}[event.status];
  $('trace-decision').textContent=decision;
  $('trace-status').textContent=`${result.config.protocol} · pulse ${traceIndex} of ${result.trace.length}. ${decision}.`;
  const chip=document.createElement('span');chip.className=`trace-chip trace-${event.status}`;chip.textContent=event.conclusive?String(event.bobBit):'×';chip.setAttribute('title',`Pulse ${event.pulse}: ${decision}`);$('trace-bits').append(chip);
  const motion=$('photon-motion');motion.style.animationDuration=`${1.7/(Number($('trace-speed').value)||1)}s`;
  motion.style.setProperty('--travel',event.detected?'540px':'245px');
  motion.setAttribute('class',`photon-motion motion-${traceIndex%2?'a':'b'} ${event.error?'motion-error':''}`);
  if(traceIndex===result.trace.length)pauseTrace();return true;
}
function playTrace() {
  if(tracePlaying){pauseTrace();return;}
  if(traceIndex>=result.trace.length)resetTrace();
  tracePlaying=true;$('trace-play').textContent='Pause';const epoch=traceEpoch;
  const tick=()=>{if(!tracePlaying||epoch!==traceEpoch)return;advanceTrace();if(tracePlaying)setTimeout(tick,2000/(Number($('trace-speed').value)||1));};
  tick();
}
$('trace-play').addEventListener('click',playTrace);
$('trace-step').addEventListener('click',()=>{pauseTrace();advanceTrace();});
$('trace-reset').addEventListener('click',resetTrace);
$('evidence-repeat').addEventListener('click',()=>{
  if(!result)return;
  try {
    const repeated=simulate(result.config),same=JSON.stringify(repeated)===JSON.stringify(result);
    $('evidence-check').textContent=same?`Verified: seed ${result.config.seed} reproduces all trial records, all counters, QBER and the ${count(result.finalBits)}-bit estimate exactly.`:'Reproduction check failed. The displayed run and repeated calculation differ.';
  }catch(error){$('evidence-check').textContent=`Reproduction check could not finish: ${error.message}`;}
});
$('evidence-next').addEventListener('click',()=>{
  if(!result)return;
  const settings={...result.config,protocol:comparison?'compare':result.config.protocol,seed:(result.config.seed+1)>>>0};
  for(const [key,value] of Object.entries(settings))$(key).value=value;
  syncControls();run();
});
function run() {
  $('form-error').hidden = true;
  if (!form.reportValidity()) return;
  try {
    const settings = getConfig();
    const nextComparison = settings.protocol === 'compare' ? compareProtocols(settings) : null;
    const next = nextComparison ? nextComparison.results[0] : simulate(settings);
    comparison = nextComparison; result = next;
    history.push(...(comparison ? comparison.results : [next]));
    render(next); renderComparison();
  } catch (error) {
    $('form-error').textContent = error.message || 'The experiment could not run. Check the settings.';
    $('form-error').hidden = false;
  }
}
form.addEventListener('submit', event => { event.preventDefault(); run(); });
form.addEventListener('input', event => {
  if (event.target.id === 'attack' && $('attack').value === 'pns') $('source').value = 'wcp';
  syncControls(); $('stale').hidden = !result;
});
const presets = {
  baseline: { protocol: 'BB84', attack: 'none', noise: 0.05, source: 'ideal' },
  ir: { protocol: 'BB84', attack: 'ir', noise: 0, source: 'ideal' },
  pns: { protocol: 'BB84', attack: 'pns', noise: 0, source: 'wcp', lossDb: 10 },
  b92: { protocol: 'B92', pulses:100000, attack: 'none', noise: 0.005, source: 'ideal' }
};
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  const settings = { pulses: 10000, interception: 1, lossDb: 0, efficiency: 1, darkCount: 0, mu: 0.5, sampleFraction: 0.25, eps: 0.000001, requiredBits: 128, seed: 42, ...presets[button.dataset.preset] };
  for (const [key, value] of Object.entries(settings)) $(key).value = value;
  syncControls(); run();
}));
$('download').addEventListener('click', () => {
  if (!result) return;
  const blob = new Blob([JSON.stringify({ model: 'QKD Lab educational simulation', limitation: 'Not a security certificate. Estimated bits only; no usable secret key.', ...result, ...(comparison ? {comparison} : {}) }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `qkd-${comparison ? 'comparison' : result.config.protocol.toLowerCase()}-seed-${result.config.seed}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
syncControls(); run();
mountScada({getQkdConfig:getConfig,svgNode});
