import {simulate} from './engine.mjs';
import {runFragment,readRunFragment} from './run-link.mjs';

const el=id=>document.getElementById(id),simulationForm=el('simulation-form');
let displayedRun;
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:3});
const pct=n=>(100*n).toFixed(2)+'%';
function showSimulation(settings) {
  const r=simulate(settings);displayedRun=r;
  el('error').hidden=true;el('check').textContent='Calculated locally from randomized pulse outcomes. Same seed and settings reproduce the run.';
  el('run-label').textContent=`${r.config.protocol} · seed ${r.config.seed} · ${fmt(r.config.pulses)} pulse trials · noise ${pct(r.config.noise)} · ${r.config.attack}`;
  el('sifted').textContent=fmt(r.counts.sifted);el('qber').textContent=r.counts.sample?pct(r.qber):'No test sample';
  el('final').textContent=fmt(r.finalBits);el('outcome').textContent=r.status;
  const steps=[
    `${fmt(r.counts.pulses)} pulses → ${fmt(r.counts.detected)} detections → ${fmt(r.counts.sifted)} retained bits.`,
    r.counts.sample?`${fmt(r.counts.errors)} observed errors ÷ ${fmt(r.counts.sample)} disclosed test bits = ${pct(r.qber)} QBER.`:'No disclosed test bits: QBER cannot be estimated from a sample.',
    `${fmt(r.counts.sifted)} retained − ${fmt(r.counts.sample)} disclosed = ${fmt(r.counts.keyBits)} remaining raw bits.`,
    `Modeled privacy allowance: ${fmt(r.counts.keyBits)} × ${r.budget.privacyFraction.toFixed(6)} = ${fmt(r.budget.privacyBits)} bits.`,
    `Subtract reconciliation ${fmt(r.budget.reconciliationLeakage)}, finite-size ${fmt(r.finitePenalty)}, verification ${r.verification} and authentication ${r.authentication} bits → raw budget ${fmt(r.budget.rawBudget)}.`,
    `Round down, clamp at zero and apply model checks → ${fmt(r.finalBits)} estimated final bits; ${r.status}. Target: ${r.config.requiredBits} bits. Status is a model outcome, not a security certificate.`
  ];
  el('calculation').replaceChildren(...steps.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  el('warnings').textContent=r.warnings.join(' ');
  el('dashboard').href=(location.protocol==='file:'?'./QKD Lab.html':'./')+runFragment(r.config);
  const kept=r.audit.filter(e=>e.conclusive),sampled=kept.filter(e=>e.sampled),remaining=kept.filter(e=>!e.sampled);
  el('trace-rule').textContent=r.config.protocol==='BB84'?'BB84: Alice prepares a random bit in Z (+) or X (×). A detected pulse is retained when Bob chose the same basis. Noise or interception can change the measured bit.':'B92: Alice encodes 0 as |0⟩ and 1 as |+⟩. Bob chooses Z or X. Only measurement outcome 1 is conclusive; its inferred bit is 1 − Bob’s basis index. This uses no basis-matching rule.';
  el('preview-scope').textContent=`Preview: first ${r.audit.length} of ${fmt(r.config.pulses)} actual pulses; ${kept.length} retained, ${sampled.length} disclosed, ${remaining.length} remaining. Summary counts above cover the full run.`;
  el('bits').replaceChildren(...[['Alice prepared',r.audit,'aliceBit'],['Alice retained',kept,'aliceBit'],['Bob retained',kept,'bobBit'],['Remaining raw Alice',remaining,'aliceBit'],['Remaining raw Bob',remaining,'bobBit']].flatMap(([label,events,key])=>{const dt=document.createElement('dt'),dd=document.createElement('dd'),code=document.createElement('code');dt.textContent=label;code.textContent=events.length?events.map(e=>e[key]).join(''):'No bits in this preview';dd.append(code);return[dt,dd];}));
  el('trial-caption').textContent=`${r.config.protocol} · seed ${r.config.seed} · actual pulse records`;
  el('trials').replaceChildren(...r.audit.map(e=>{
    const row=document.createElement('tr');row.className=e.sampled?'disclosed':e.error?'error':'';
    const decision=!e.detected?'Lost':!e.conclusive?(r.config.protocol==='B92'?'Inconclusive / discard':'Basis mismatch / discard'):(e.sampled?'Disclosed test':'Keep / raw')+(e.error?' · error':'');
    const state=r.config.protocol==='BB84'?(e.aliceBasis?'X (×)':'Z (+)'):(e.aliceBit?'|+⟩':'|0⟩');
    for(const value of [e.pulse,e.aliceBit,state,e.bobBasis?'X (×)':'Z (+)',e.bobOutcome??'—',e.bobBit??'—',decision,e.draws.aliceBit.toFixed(8),e.draws.noise.toFixed(8)]){const td=document.createElement('td');td.textContent=value;row.append(td);}return row;
  }));
}
function runForm() {
  if(!simulationForm.reportValidity())return;
  try{showSimulation(Object.fromEntries([...new FormData(simulationForm)].map(([key,value])=>[key,['protocol','attack','source'].includes(key)?value:Number(value)])));}
  catch(error){el('error').textContent=error.message;el('error').hidden=false;}
}
simulationForm.addEventListener('submit',event=>{event.preventDefault();runForm();});
el('fresh-seed').addEventListener('click',()=>{simulationForm.elements.namedItem('seed').value=crypto.getRandomValues(new Uint32Array(1))[0];runForm();});
el('repeat').addEventListener('click',()=>{if(displayedRun){const same=JSON.stringify(simulate(displayedRun.config))===JSON.stringify(displayedRun);el('check').textContent=same?'Verified: all pulse records, counts, QBER and estimated final bits match the displayed run exactly.':'Verification failed: results differ.';}});
el('export').addEventListener('click',()=>{if(!displayedRun)return;const url=URL.createObjectURL(new Blob([JSON.stringify(displayedRun,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`simulation-${displayedRun.config.protocol}-seed-${displayedRun.config.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
try{const shared=readRunFragment(location.hash);if(shared)for(const [key,value] of Object.entries(shared))simulationForm.elements.namedItem(key).value=value;runForm();}
catch(error){el('error').textContent='Shared settings could not be loaded: '+error.message;el('error').hidden=false;}
