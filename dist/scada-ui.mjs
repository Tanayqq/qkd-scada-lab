import { compareScada, simulateScada, SCADA_DEFAULTS } from './scada.mjs';

export function mountScada({ getQkdConfig, svgNode } = {}) {
  const root = document.getElementById('scada-lab');
  if (!root || root.dataset.mounted) return;
  root.dataset.mounted = 'true';
  const $ = name => document.getElementById(`scada-${name}`);
  const form = $('form');
  const number = (value, digits = 0) => value!=null&&Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
  const pct = value => `${number(Number(value) * 100, 2)}%`;
  const fields = [
    ['protocol', 'Protocol', 'select', ['compare', 'BB84', 'B92'], 'primary'],
    ['duration', 'Duration (s)', 'number', [5, 600, 1], 'primary'],
    ['pulseRate', 'QKD pulses / second', 'number', [100, 1000000, 100], 'primary'],
    ['messageRate', 'Messages / second', 'number', [0.1, 100, 0.1], 'primary'],
    ['attack', 'Attack scenario', 'select', ['none', 'ir', 'pns', 'noise', 'mitm'], 'primary'],
    ['attackStart', 'Attack begins (s)', 'number', [0, 600, 0.1], 'primary'],
    ['attackEnd', 'Attack ends (s)', 'number', [0, 600, 0.1], 'primary'],
    ['authenticated', 'Authenticate classical channel', 'checkbox', [], 'primary'],
    ['postProcessingSec', 'Post-processing / round (s)', 'number', [0, 10, 0.01]],
    ['keyLifetime', 'Key lifetime (s)', 'number', [0.1, 600, 0.1]],
    ['messagesPerKey', 'Maximum messages per key', 'number', [1, 10000, 1]],
    ['poolCapacity', 'Key pool capacity (keys)', 'number', [1, 1000, 1]],
    ['deadlineSec', 'Message deadline (s)', 'number', [0.1, 60, 0.01]],
    ['networkDelaySec', 'One-way network delay (s)', 'number', [0, 60, 0.01]],
    ['interception', 'Intercept-resend fraction (0–1)', 'number', [0, 1, 0.05]],
    ['attackNoise', 'Noise-burst bit-flip probability', 'number', [0, 0.5, 0.01]],
    ['recoveryRounds', 'Consecutive clean rounds before recovery', 'number', [1, 10, 1]],
    ['alarmIncrease', 'QBER alarm increase above baseline', 'number', [0, 0.5, 0.005]],
    ['alarmProbability', 'Per-round baseline tail probability cutoff', 'number', [0.000000001, 0.1, 'any']]
  ];
  const defaults = { protocol: 'compare', duration: 60, pulseRate: 10000, postProcessingSec: .1, messageRate: 10, keyLifetime: 10, messagesPerKey: 50, poolCapacity: 100, deadlineSec: 2, networkDelaySec: .02, attack: 'none', attackStart: 20, attackEnd: 40, interception: 1, attackNoise: .25, authenticated: true, recoveryRounds: 2, alarmIncrease: .03, alarmProbability: .001, ...SCADA_DEFAULTS };
  defaults.protocol = 'compare';
  const attackLabels = { none: 'No attack', ir: 'Intercept & resend', pns: 'Photon-number splitting', noise: 'Noise burst', mitm: 'Man in the middle' };
  for (const [name, labelText, type, bounds, group] of fields) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label'); label.htmlFor = `scada-${name}`; label.textContent = labelText;
    const input = document.createElement(type === 'select' ? 'select' : 'input'); input.id = `scada-${name}`; input.name = name;
    if (type === 'select') for (const value of bounds) { const option = document.createElement('option'); option.value = value; option.textContent = name === 'attack' ? attackLabels[value] : value === 'compare' ? 'Compare BB84 / B92' : value; input.append(option); }
    else { input.type = type; if (type === 'number') { [input.min, input.max, input.step] = bounds.map(String); input.required = true; } }
    if (type === 'checkbox') { input.checked = defaults[name]; wrapper.className = 'scada-check'; wrapper.append(input, label); }
    else { input.value = defaults[name]; wrapper.append(label, input); }
    $(group === 'primary' ? 'primary-controls' : 'advanced-controls').append(wrapper);
  }
  let output = null, runs = [], selected = 0, snapshotIndex = 0, timer = null;
  function readOptions() { return Object.fromEntries(fields.map(([name, , type]) => [name, type === 'checkbox' ? $(name).checked : type === 'number' ? Number($(name).value) : $(name).value])); }
  function pause() { clearInterval(timer); timer = null; root.dataset.playing = 'false'; $('play').textContent = 'Play replay'; }
  function markStale() { if (output) $('stale').hidden = false; }
  form.addEventListener('input', markStale);
  document.getElementById('experiment')?.addEventListener('input', markStale);
  const presets = {
    healthy: { attack: 'none' }, ir: { attack: 'ir' }, noise: { attack: 'noise' },
    authenticatedMITM: { attack: 'mitm', authenticated: true }, unauthMITM: { attack: 'mitm', authenticated: false },
    supplystarved: { attack: 'none', pulseRate: 1000, messageRate: 50, messagesPerKey: 1, keyLifetime: 1, deadlineSec: .5 }
  };
  root.querySelectorAll('[data-scada-preset]').forEach(button => button.addEventListener('click', () => {
    for (const [name, value] of Object.entries({ ...defaults, ...presets[button.dataset.scadaPreset] })) {
      if (!$(name)) continue;
      if (typeof value === 'boolean') $(name).checked = value; else $(name).value = value;
    }
    markStale(); $('initial').textContent = `${button.textContent} preset selected. Click Run SCADA experiment.`;
  }));
  function paragraph(text) { const p = document.createElement('p'); p.textContent = text; return p; }
  function metric(label, value, note) { const div = document.createElement('div'); div.className = 'scada-stat'; const span = document.createElement('span'); span.textContent = label; const strong = document.createElement('strong'); strong.textContent = value; const small = document.createElement('small'); small.textContent = note; div.append(span, strong, small); return div; }
  const ns = 'http://www.w3.org/2000/svg';
  function svgElement(tag, attrs, text) { const el = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); if (text !== undefined) el.textContent = text; return el; }
  function plot(target, title, data, duration, attack, cursor, unit, baseline) {
    const svg = svgElement('svg', { viewBox: '0 0 440 175', role: 'img', 'aria-label': title });
    svg.append(svgElement('title', {}, title));
    const max = Math.max(unit === '%' ? .01 : 1, baseline||0,...data.filter(p => Number.isFinite(p[1])).map(p => p[1]));
    const upper = unit === '%' ? Math.min(1, max * 1.15) : max * 1.1;
    const x = value => 46 + Math.max(0, Math.min(duration, value)) / Math.max(duration, .01) * 378;
    const y = value => 143 - value / upper * 122;
    if (attack.attack !== 'none') svg.append(svgElement('rect', { x: x(attack.attackStart), y: 15, width: Math.max(0, x(attack.attackEnd) - x(attack.attackStart)), height: 128, fill: '#e9b77f', opacity: '.25' }));
    for (let i = 0; i <= 2; i++) { const value = upper * i / 2; svg.append(svgElement('line', { x1: 46, x2: 424, y1: y(value), y2: y(value), stroke: '#d8dfd1' }), svgElement('text', { x: 39, y: y(value) + 3, 'text-anchor': 'end', 'font-size': 9, fill: '#667770' }, unit === '%' ? pct(value) : number(value, 1))); }
    for (let i = 0; i <= 2; i++) svg.append(svgElement('text', { x: x(duration * i / 2), y: 162, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle', 'font-size': 9, fill: '#667770' }, `${number(duration * i / 2, 1)} s`));
    const points = data.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (points.length) svg.append(svgElement('polyline', { points: points.map(([time, value]) => `${x(time)},${y(value)}`).join(' '), fill: 'none', stroke: '#267b65', 'stroke-width': 2 }));
    if (unit === '%') {
      if(Number.isFinite(baseline))svg.append(svgElement('line',{x1:46,x2:424,y1:y(baseline),y2:y(baseline),stroke:'#406e9b','stroke-dasharray':'4 4'}));
      for (const [time, value,alarm] of points) { const circle = svgElement('circle', { cx: x(time), cy: y(value), r: alarm?4:2.5, fill: alarm?'#b6462c':'#267b65' }); circle.append(svgElement('title', {}, `${number(time, 2)} s: ${pct(value)}${alarm?' · alarm':''}`)); svg.append(circle); }
    }
    svg.append(svgElement('line', { x1: x(cursor), x2: x(cursor), y1: 15, y2: 143, stroke: '#173743', 'stroke-dasharray': '3 3' }));
    if (!points.length) svg.append(svgElement('text', { x: 235, y: 80, 'text-anchor': 'middle', 'font-size': 11, fill: '#667770' }, 'No completed data'));
    $(target).replaceChildren(svg);
  }
  function supplyChart(summary) {
    const svg = svgElement('svg', { viewBox: '0 0 440 175', role: 'img', 'aria-label': 'Average estimated QKD supply and modeled key demand in bits per second' });
    const max = Math.max(1, summary.bitsPerSecond, summary.demandBitsPerSecond);
    [['Supply', summary.bitsPerSecond, '#267b65'], ['Demand', summary.demandBitsPerSecond, '#b87742']].forEach(([label, value, color], index) => {
      const y = 45 + index * 65;
      svg.append(svgElement('text', { x: 12, y: y - 10, 'font-size': 11, fill: '#173743' }, `${label}: ${number(value, 1)} bits/s`), svgElement('rect', { x: 12, y, width: value / max * 410, height: 20, rx: 3, fill: color }));
    }); $('supply-chart').replaceChildren(svg);
  }
  function renderSnapshot() {
    const run = runs[selected], snapshots = run.snapshots || [];
    const s = snapshots[snapshotIndex] || { time: 0, state: 'no snapshots', queue: 0, poolKeys: 0, activeKeys: 0, delivered: 0, generatedBits: 0 };
    const time = s.time; $('time').value = snapshotIndex; $('clock').textContent = `${number(time, 2)} s`;
    $('flow-state').textContent = String(s.state).toUpperCase(); $('flow-pool').textContent = `${number(s.poolKeys)} pooled keys · ${number(s.queue)} queued messages`;
    $('current').textContent = `At ${number(time, 2)} s · state: ${s.state} · delivered: ${number(s.delivered)} · active keys: ${number(s.activeKeys)} · generated key estimate: ${number(s.generatedBits)} bits · latest QBER: ${Number.isFinite(s.lastQber) ? pct(s.lastQber) : 'not measured'}.`;
    const keys = (run.keys || []).filter(key => key.activatedAt != null && key.activatedAt <= time && (key.endedAt == null || key.endedAt > time) && key.expiresAt > time);
    $('keys').textContent = `Active simulated key IDs: ${keys.length ? keys.map(key => `${key.id} (${key.direction}, expiry ${number(key.expiresAt, 2)} s${key.compromised ? ', compromised' : ''})`).join(' · ') : 'none'}. IDs represent modeled budgets, not secret key values.`;
    plot('qber-chart', 'Sample QBER over simulated time', (run.rounds || []).filter(r => r.end <= run.options.duration).map(r => [r.end, r.qber,r.alarm]), run.options.duration, run.options, time, '%',run.rounds[0]?.baselineQber);
    plot('pool-chart', 'Available key pool over simulated time, in keys', snapshots.map(s => [s.time, s.poolKeys]), run.options.duration, run.options, time, 'keys');
    plot('queue-chart', 'Waiting messages over simulated time, in messages', snapshots.map(s => [s.time, s.queue]), run.options.duration, run.options, time, 'messages');
    const events = (run.events || []).filter(event => event.time <= time).slice(-20).reverse();
    $('events').replaceChildren(...(events.length ? events.map(event => { const li = document.createElement('li'); li.textContent = `${number(event.time, 2)} s · ${event.type} · ${event.message}${event.keyId ? ` · ${event.keyId}` : ''}`; return li; }) : [Object.assign(document.createElement('li'), { textContent: 'No events at this time.' })]));
    const messages = (run.messages || []).filter(message => message.generatedAt <= time).slice(-10).reverse();
    $('messages').replaceChildren(...(messages.length ? messages.map(message => {
      const li = document.createElement('li');
      const delivered = message.deliveredAt != null && message.deliveredAt <= time, sent = message.sentAt != null && message.sentAt <= time;
      const dropped=message.droppedAt!=null&&message.droppedAt<=time;
      const state = dropped?`dropped (${message.reason})`:delivered ? 'delivered' : sent ? 'in flight' : time > message.deadlineAt ? 'deadline passed' : 'queued';
      li.textContent = `${message.id} · ${message.direction} · ${message.kind} · ${state} · generated ${number(message.generatedAt, 2)} s · deadline ${number(message.deadlineAt, 2)} s${sent ? ` · key ${message.keyId} · nonce ${message.nonceCounter}${message.compromised ? ' · COMPROMISED' : ''}` : ''} · ${typeof message.payload === 'object' ? JSON.stringify(message.payload) : message.payload || 'illustrative payload'}`;
      return li;
    }) : [Object.assign(document.createElement('li'), { textContent: 'No messages generated at this time.' })]));
  }
  function renderRun() {
    pause(); const run = runs[selected], s = run.summary;
    snapshotIndex = Math.max(0, (run.snapshots || []).length - 1); $('time').max = snapshotIndex;
    $('summary').replaceChildren(
      metric('Full-run delivery', `${number(s.delivered)} / ${number(s.generated)}`, `${number(s.dropped)} dropped · ${number(s.pending)} pending`),
      metric('Service availability', pct(s.availability), `${number(s.blockedSec, 2)} s blocked`),
      metric('Mean / max latency', `${number(s.meanLatencySec, 3)} / ${number(s.maxLatencySec, 3)} s`, `${number(s.deadlineMisses)} deadline misses`),
      metric('Compromised delivered', number(s.compromisedDelivered), `${number(s.authenticatedDelivered)} authenticated deliveries`),
      metric('Estimated QKD supply', `${number(s.estimatedBits)} bits`, `${number(s.bitsPerSecond, 1)} bits/s · full-run average`),
      metric('Key lifecycle', `${number(s.keysGenerated)} generated`, `${number(s.keysPerSecond,2)} keys/s · ${number(s.keyRotations)} rotations · ${number(s.keyExpirations)} expired`),
      metric('QKD generation interval', `${number(run.generationSec,2)} s`, `${number(run.rounds.length)} completed blocks · ${number(s.overflowKeys)} overflow keys discarded`),
      metric('Disturbance alarms', number(s.alarms), 'QBER alarms do not establish an attacker'),
      metric('Authentication failures', number(s.authFailures), 'Ideal checker; pre-shared trust assumed')
    ); supplyChart(s); renderSnapshot();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    pause(); $('error').hidden = true;
    const options = readOptions();
    if (options.attack !== 'none' && (options.attackEnd <= options.attackStart || options.attackStart >= options.duration || options.attackEnd > options.duration)) { $('error').textContent = 'Attack interval must begin before it ends and remain within the simulation duration.'; $('error').hidden = false; return; }
    $('run').disabled = true; $('initial').textContent = 'Simulating timed QKD supply, key lifecycle, and SCADA traffic…';
    await new Promise(resolve => setTimeout(resolve, 20));
    try {
      const qkd = structuredClone(getQkdConfig());
      if(options.attack==='pns')qkd.source='wcp';
      output = options.protocol === 'compare' ? compareScada(options, qkd) : simulateScada(options, {...qkd,protocol:options.protocol});
      runs = output.results || [output]; selected = 0;
      $('view').replaceChildren(...runs.map((run, index) => { const option = document.createElement('option'); option.value = index; option.textContent = run.qkdConfig.protocol; return option; }));
      $('comparison').replaceChildren(...(runs.length > 1 ? runs.map(run => { const card = document.createElement('article'); card.className = 'scada-compare-card'; const title = document.createElement('h3'); title.textContent = run.qkdConfig.protocol; card.append(title, paragraph(`${number(run.summary.delivered)} delivered / ${number(run.summary.generated)} generated · ${pct(run.summary.availability)} availability`), paragraph(`${number(run.summary.bitsPerSecond, 1)} estimated bits/s · ${number(run.summary.compromisedDelivered)} compromised deliveries · ${number(run.summary.authFailures)} authentication failures`)); return card; }) : []));
      $('recommendation').textContent = runs.length > 1 ? `${output.recommendation?`Scenario choice: ${output.recommendation}. `:'No single winner. '}${output.reason}` : `${runs[0].qkdConfig.protocol} timed experiment. Interpret the service metrics alongside security alarms and the assumptions below.`;
      $('results').hidden = false; $('stale').hidden = true; $('initial').textContent = `Experiment complete: ${qkd.pulses.toLocaleString()} pulses/block, ${pct(qkd.noise)} noise, ${qkd.source==='wcp'?'weak-coherent':'single-photon'} source. Metrics summarize the full run; replay controls inspect snapshots.`; $('export').disabled = false;
      renderRun(); $('announcement').textContent = 'SCADA experiment complete. Comparison, timeline, charts, and event logs updated.';
    } catch (error) { $('error').textContent = error.message || 'The SCADA experiment could not run.'; $('error').hidden = false; $('initial').textContent = 'Experiment failed. Check the settings and try again.'; }
    finally { $('run').disabled = false; }
  });
  $('view').addEventListener('change', () => { selected = Number($('view').value); renderRun(); });
  $('time').addEventListener('input', () => { pause(); snapshotIndex = Number($('time').value); renderSnapshot(); });
  $('play').addEventListener('click', () => {
    if (timer) { pause(); return; }
    if (snapshotIndex >= runs[selected].snapshots.length - 1) snapshotIndex = 0;
    root.dataset.playing = 'true'; $('play').textContent = 'Pause replay'; renderSnapshot();
    timer = setInterval(() => { if (snapshotIndex >= runs[selected].snapshots.length - 1) { pause(); return; } snapshotIndex=Math.min(runs[selected].snapshots.length-1,snapshotIndex+(Number($('speed').value)||5)); renderSnapshot(); }, 100);
  });
  $('export').addEventListener('click', () => {
    if (!output) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ model: 'Local educational QKD / SCADA scheduling model; no actual encryption or network', ...output }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'qkd-scada-experiment.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
