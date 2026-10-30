import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const script = ['dist/engine.mjs','dist/run-link.mjs','dist/candidate-counts.mjs','dist/scada.mjs','dist/scada-ui.mjs','dist/app.mjs']
  .map(name=>read(name).replace(/^import .*from '\.\/[^']+';\s*/gm,'').replace(/^export /gm,''))
  .join('\n');
const check = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: script, encoding: 'utf8' });
if (check.status !== 0) throw new Error(check.stderr || 'Offline script syntax check failed');
if (/<\/script/i.test(script)) throw new Error('Unexpected script closing tag');
const html = read('dist/index.html')
  .replace(/<!-- SCADA_PANEL_START -->[\s\S]*?<!-- SCADA_PANEL_END -->/,()=>`<!-- SCADA_PANEL_START -->${read('dist/scada-panel.html')}<!-- SCADA_PANEL_END -->`)
  .replace('<link rel="stylesheet" href="./style.css">', () => `<style>${read('dist/style.css')}</style>`)
  .replace('class="brand" href="./"', 'class="brand" href="#results"')
  .replace('<script type="module" src="./app.mjs"></script>', () => `<script type="module">${script}</script>`);
if (/<(?:script|link)\b[^>]*(?:src|href)="\.\//i.test(html)) throw new Error('External application asset remains');
const output = new URL('QKD Lab.html', import.meta.url);
writeFileSync(output, html);
console.log(`Offline dashboard ready: ${fileURLToPath(output)}`);
const runner=read('dist/simulation.mjs').replace(/^import .*from '\.\/[^']+';\s*/gm,'');
const runnerScript=['dist/engine.mjs','dist/run-link.mjs'].map(name=>read(name).replace(/^import .*from '\.\/[^']+';\s*/gm,'').replace(/^export /gm,'')).join('\n')+'\n'+runner;
const runnerCheck=spawnSync(process.execPath,['--check','--input-type=module'],{input:runnerScript,encoding:'utf8'});
if(runnerCheck.status!==0||/<\/script/i.test(runnerScript))throw new Error(runnerCheck.stderr||'Invalid simulation script');
writeFileSync(new URL('simulation.html',import.meta.url),read('dist/simulation.html').replace('<script type="module" src="./simulation.mjs"></script>',()=>`<script type="module">${runnerScript}</script>`));
