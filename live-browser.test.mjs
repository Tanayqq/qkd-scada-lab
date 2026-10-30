// Browser integration with an in-memory transport; live-smoke.mjs separately verifies deployed storage.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createSession,advance,act,project,authorize} from './live/session.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.LIVE_URL||'https://qkd.test';
const browser=await chromium.launch({channel:'msedge',headless:true});
let session,now=Date.now(),unavailable=false;const errors=[];
const telemetry=Buffer.from('time_seconds,voltage_V,frequency_Hz\n0,230,50\n'.repeat(55));
try {
  const contexts=await Promise.all([1200,390,900].map(width=>browser.newContext({viewport:{width,height:900}})));
  for(const context of contexts)if(!process.env.LIVE_URL)await context.route('https://qkd.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/room'){
      if(unavailable)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test connection interruption'})});
      const body=route.request().postDataJSON();let result,status=200;
      if(body.action==='create'){session=createSession(body,now);result={id:session.id,tokens:session.tokens};status=201;}
      else if(!authorize(session,body.role,body.token)){status=403;result={error:'Invalid role.'};}
      else{advance(session,now);if(body.action!=='poll')act(session,body.role,body,now);result=project(session,body.role,now);}
      return route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
    }
    const file=path.slice(1);
    if(file==='candidate-counts.mjs')return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('dist/candidate-counts.mjs',import.meta.url),'utf8')});
    if(!['live.html','live.js','live.css'].includes(file))return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('live/'+file,import.meta.url),'utf8')});
  });
  const [sender,receiver,attacker]=await Promise.all(contexts.map(c=>c.newPage()));
  for(const page of [sender,receiver,attacker])page.on('pageerror',e=>errors.push(e.message));
  await sender.goto(base+'/live.html');await sender.getByRole('button',{name:'Create shared room'}).click();
  await sender.locator('#links a').first().waitFor();
  const links=await sender.locator('#links a').evaluateAll(items=>items.map(a=>a.href));
  assert.equal(links.length,3);
  await Promise.all([sender.goto(links[0]),receiver.goto(links[1]),attacker.goto(links[2])]);
  await sender.locator('#telemetry-file').setInputFiles({name:'test-telemetry.csv',mimeType:'text/csv',buffer:telemetry});
  await sender.getByRole('button',{name:'Use selected file'}).click();
  await sender.locator('#file-description').filter({hasText:'test-telemetry.csv'}).waitFor();
  await receiver.getByRole('button',{name:'Join as receiver'}).click();
  await receiver.getByRole('button',{name:'Join as receiver'}).waitFor({state:'hidden'});
  await sender.getByRole('button',{name:'Start key generation'}).click();
  await sender.locator('#phase').filter({hasText:'Sending and measuring'}).waitFor();
  now+=13000;
  await sender.reload();await receiver.reload();
  await sender.locator('#key-id').filter({hasText:'K-001'}).waitFor();
  await receiver.locator('#key-id').filter({hasText:'K-001'}).waitFor();
  assert.equal(await sender.locator('#key-preview').textContent(),await receiver.locator('#key-preview').textContent());
  await attacker.locator('#live-attack').selectOption('ir');await attacker.getByRole('button',{name:'Apply to channel'}).click();
  await attacker.locator('#attack-state').filter({hasText:'Applied mode: ir'}).waitFor();
  now+=24000;await sender.reload();await receiver.reload();
  await sender.locator('#alert.danger').waitFor();await receiver.locator('#alert.danger').waitFor();
  assert.equal(await sender.locator('#key-id').textContent(),'None');
  assert.equal(await receiver.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await sender.screenshot({path:fileURLToPath(new URL('../qkd-live-sender.png',import.meta.url)),fullPage:true});
  await receiver.screenshot({path:fileURLToPath(new URL('../qkd-live-receiver-mobile.png',import.meta.url)),fullPage:true});
  if(!process.env.LIVE_URL){
    unavailable=true;
    await receiver.locator('#key-id').filter({hasText:'Unavailable'}).waitFor();
    assert.match(await receiver.locator('#connection').textContent(),/Disconnected/);
    unavailable=false;
    await receiver.locator('#connection').filter({hasText:'Connected'}).waitFor();
  }
  await attacker.locator('#live-attack').selectOption('none');await attacker.getByRole('button',{name:'Apply to channel'}).click();
  await attacker.locator('#attack-state').filter({hasText:'Applied mode: none'}).waitFor();
  if(!process.env.LIVE_URL){now+=30*12000;await receiver.reload();await sender.reload();}
  await receiver.locator('#download-file').waitFor({state:'visible',timeout:90000});
  const downloadEvent=receiver.waitForEvent('download');await receiver.locator('#download-file').click();const download=await downloadEvent;
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks),telemetry);assert.equal(download.suggestedFilename(),'test-telemetry.csv');
  if(!process.env.LIVE_URL){await sender.locator('#outcome-title').filter({hasText:'BB84 experiment complete — telemetry file received and verified'}).waitFor();assert.equal(await sender.locator('#delivery-chart circle').count(),30);}
  else{await sender.getByRole('button',{name:'Stop & clear key'}).click();await sender.locator('#phase').filter({hasText:'Session paused'}).waitFor();}
  await receiver.screenshot({path:fileURLToPath(new URL('../qkd-file-receiver.png',import.meta.url)),fullPage:true});
  await sender.locator('#transfer-results').screenshot({path:fileURLToPath(new URL('../qkd-transfer-outcome.png',import.meta.url))});
  assert.deepEqual(errors,[]);
  console.log('PASS: three isolated browser contexts; real file upload, attack/recovery, receiver SHA-256 acknowledgement and byte-identical download; outcome graphs, mobile layout, no browser errors.');
}finally{await browser.close();}
