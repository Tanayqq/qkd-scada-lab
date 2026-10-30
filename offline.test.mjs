// DOM smoke checks execute the packaged script without a browser or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('offline dashboard integrates protocol comparisons, playback, SCADA controls and exports', async () => {
  const html = readFileSync(new URL('QKD Lab.html', import.meta.url),'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const elements=new Map(),buttons=[];
  class Element {
    constructor(){ this.value=''; this.hidden=true; this.children=[]; this.listeners={}; this.dataset={}; this.style={setProperty(key,value){this[key]=value;}}; }
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(name,value){this[name]=value;}
    set id(value){this._id=value;elements.set(value,this);}
    get id(){return this._id;}
    addEventListener(name,handler){const prior=this.listeners[name];this.listeners[name]=event=>{prior?.(event);return handler(event);};}
    querySelectorAll(selector){return buttons.filter(button=>selector==='[data-scada-preset]'?button.dataset.scadaPreset:button.dataset.preset);}
    reportValidity(){return true;}
    click(){this.listeners.click?.({target:this});}
  }
  for(const match of html.matchAll(/\bid="([^"]+)"/g)){const element=new Element();element.id=match[1];}
  for(const match of html.matchAll(/data-(scada-preset|preset)="([^"]+)"/g)){const button=new Element();button.dataset[match[1]==='preset'?'preset':'scadaPreset']=match[2];buttons.push(button);}
  const defaults={protocol:'BB84',pulses:10000,noise:.05,attack:'none',interception:1,lossDb:0,efficiency:1,darkCount:0,source:'ideal',mu:.5,sampleFraction:.25,seed:42,eps:1e-6,requiredBits:128};
  for(const [key,value] of Object.entries(defaults)) elements.get(key).value=String(value);
  const document={getElementById:id=>elements.get(id)||null,createElement(){return new Element();},createElementNS(){return new Element();},querySelectorAll:selector=>buttons.filter(button=>selector==='[data-scada-preset]'?button.dataset.scadaPreset:button.dataset.preset)};
  let exported;
  const timers=[],intervals=new Map();let intervalId=0;
  const context={document,console,structuredClone,setTimeout:fn=>timers.push(fn),setInterval:fn=>{intervals.set(++intervalId,fn);return intervalId;},clearInterval:id=>intervals.delete(id),FormData:class{*[Symbol.iterator](){for(const key of Object.keys(defaults)){const field=elements.get(key);if(!field.disabled)yield[key,field.value];}}},Blob:class{constructor(parts){exported=JSON.parse(parts.join(''));}},URL:{createObjectURL:()=> 'blob:local',revokeObjectURL(){}}};
  runInNewContext(script,context);
  assert.equal(elements.get('form-error').hidden,true,elements.get('form-error').textContent);
  assert.equal(elements.get('metric-bits').textContent,'649');
  assert.ok(!elements.has('candidate-total'));
  assert.ok(!elements.has('open-colab'));
  assert.ok(!html.includes('monte-carlo-evidence'));
  assert.equal(elements.get('key-graph').children[0].role,'img');
  assert.match(elements.get('sensitivity-caption').textContent,/Analytic intercept-resend reference/);
  elements.get('trace-step').click();
  assert.match(elements.get('trace-status').textContent,/pulse 1 of 32/);
  assert.equal(elements.get('trace-bits').children.length,1);
  elements.get('trace-play').click();
  assert.equal(elements.get('trace-play').textContent,'Pause');
  elements.get('trace-play').click();
  const paused=elements.get('trace-status').textContent;
  while(timers.length)timers.shift()();
  assert.equal(elements.get('trace-status').textContent,paused);
  elements.get('trace-reset').click();
  assert.equal(elements.get('trace-bits').children.length,0);
  assert.equal(elements.get('trace-summary').hidden,true);
  for(let i=0;i<31;i++)elements.get('trace-step').click();
  assert.equal(elements.get('trace-summary').hidden,true);
  elements.get('trace-step').click();
  assert.equal(elements.get('trace-summary').hidden,false);
  assert.match(elements.get('trace-summary').textContent,/32 transmitted pulses · 21 kept \/ sifted · 11 discarded · 0 lost/);
  assert.equal(elements.get('trace-sequences').hidden,false);
  assert.equal(elements.get('trace-prepared').textContent,'10001000110011001110111000100100');
  assert.equal(elements.get('trace-sifted-alice').textContent,'100100100100110100100');
  assert.equal(elements.get('trace-sifted-bob').textContent,'100100100100110100100');
  elements.get('trace-reset').click();
  assert.equal(elements.get('trace-summary').hidden,true);
  assert.equal(elements.get('trace-sequences').hidden,true);
  const submit=()=>elements.get('experiment').listeners.submit({preventDefault(){}});
  elements.get('protocol').value='compare'; submit();
  assert.equal(elements.get('form-error').hidden,true,elements.get('form-error').textContent);
  assert.equal(elements.get('comparison').hidden,false);
  assert.match(elements.get('comparison-verdict').textContent,/Modeled choice: BB84/);
  assert.equal(elements.get('comparison-cards').children.length,2);
  assert.match(elements.get('key-graph-caption').textContent,/BB84: .*B92:/);
  elements.get('comparison-cards').children[1].children.at(-1).click();
  assert.equal(elements.get('protocol-label').textContent,'B92');
  assert.equal(elements.get('metric-bits').textContent,'0');
  elements.get('download').click();
  assert.deepEqual(exported.comparison.results.map(item=>item.config.protocol),['BB84','B92']);
  elements.get('attack').value='ir'; submit();
  assert.match(elements.get('comparison-verdict').textContent,/No yield winner/);
  elements.get('attack').value='none'; elements.get('noise').value='0'; elements.get('pulses').value='100000'; submit();
  elements.get('download').click();
  assert.ok(exported.comparison.results[1].finalBits>128);
  assert.ok(exported.comparison.results[1].b92Bound.supported);
  elements.get('comparison-cards').children[1].children.at(-1).click();
  assert.match(elements.get('b92-bound').textContent,/phase-error upper bound/);
  elements.get('protocol').value='BB84'; submit();
  assert.equal(elements.get('comparison').hidden,true);
  assert.equal(elements.get('form-error').hidden,true,elements.get('form-error').textContent);
  elements.get('trace-reset').click();elements.get('trace-play').click();
  let ticks=0;while(timers.length&&ticks++<100)timers.shift()();
  assert.equal(elements.get('trace-play').textContent,'Replay photons');
  assert.equal(elements.get('trace-bits').children.length,32);
  assert.equal(elements.get('scada-lab').dataset.mounted,'true');
  assert.equal(elements.get('scada-results').hidden,true);
  elements.get('scada-duration').value='6';elements.get('scada-pulseRate').value='50000';
  const scadaSubmit=async()=>{
    const completion=elements.get('scada-form').listeners.submit({preventDefault(){}});
    while(timers.length)timers.shift()();await completion;
    assert.equal(elements.get('scada-error').hidden,true,elements.get('scada-error').textContent);
  };
  await scadaSubmit();
  assert.equal(elements.get('scada-results').hidden,false);
  assert.deepEqual(elements.get('scada-view').children.map(option=>option.textContent),['BB84','B92']);
  elements.get('scada-export').click();
  assert.equal(exported.mode,'scada-comparison');
  assert.equal(exported.results.length,2);
  assert.ok(exported.results[0].summary.delivered>0);
  elements.get('scada-play').click();
  assert.equal(elements.get('scada-play').textContent,'Pause replay');
  for(const callback of [...intervals.values()])callback();
  elements.get('scada-play').click();assert.equal(intervals.size,0);
  elements.get('scada-protocol').value='B92';await scadaSubmit();
  assert.equal(elements.get('scada-view').children[0].textContent,'B92');
  elements.get('scada-export').click();assert.equal(exported.qkdConfig.protocol,'B92');
  elements.get('scada-attack').value='mitm';elements.get('scada-attackStart').value='0';elements.get('scada-attackEnd').value='6';elements.get('scada-authenticated').checked=false;
  await scadaSubmit();elements.get('scada-export').click();
  assert.ok(exported.summary.compromisedDelivered>0);
  elements.get('scada-authenticated').checked=true;await scadaSubmit();elements.get('scada-export').click();
  assert.ok(exported.summary.authFailures>0);assert.equal(exported.summary.compromisedDelivered,0);
  buttons.find(button=>button.dataset.scadaPreset==='supplystarved').click();
  assert.equal(elements.get('scada-messagesPerKey').value,1);
  assert.equal(elements.get('scada-authenticated').checked,true);
  elements.get('scada-duration').value='6';await scadaSubmit();elements.get('scada-export').click();
  assert.ok(exported.results[0].summary.deadlineMisses>0);
  elements.get('scada-protocol').value='BB84';elements.get('scada-attack').value='pns';elements.get('scada-attackStart').value='0';elements.get('scada-attackEnd').value='6';await scadaSubmit();elements.get('scada-export').click();
  assert.equal(exported.qkdConfig.source,'wcp');
});
