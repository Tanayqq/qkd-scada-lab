// Run explicitly against a deployed preview: node live-smoke.mjs <Vercel CLI JS path> <deployment URL>.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const run=promisify(execFile),cli=process.argv[2],deployment=process.argv[3];
if(!cli||!deployment)throw new Error('Pass CLI JS path and deployment URL.');
const directory=await mkdtemp(join(tmpdir(),'qkd-smoke-'));
let count=0;
async function request(body,status=200,retry=0){
  const file=join(directory,`${++count}.json`),out=file+'.out';
  await writeFile(file,JSON.stringify(body));
  const result=await run(process.execPath,[cli,'curl','/api/room','--deployment',deployment,'--','--request','POST','--header','Content-Type: application/json','--data-binary',`@${file}`,'--output',out,'--silent','--write-out','%{http_code}'],{cwd:new URL('vercel-demo/',import.meta.url),timeout:45000});
  const text=await readFile(out,'utf8');
  if(body.action==='poll'&&[409,503].includes(Number(result.stdout.trim()))&&retry<3){console.log('Transient synchronization failure; checking reconnection.');await new Promise(resolve=>setTimeout(resolve,3000));return request(body,status,retry+1);}
  assert.equal(Number(result.stdout.trim()),status,`Unexpected HTTP status: ${result.stdout}; ${text.slice(0,180)}`);
  return JSON.parse(text);
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let room;
try{
  room=await request({action:'create',protocol:'BB84',authenticated:true},201);
  const call=(role,action='poll',extra={},status=200)=>request({id:room.id,role,token:room.tokens[role],action,...extra},status);
  await call('attacker','start',{},400);
  await call('receiver','poll',{token:room.tokens.sender},403);
  await call('receiver','join');
  await call('sender','start');
  await wait(13000);
  const [a,b,e]=await Promise.all(['sender','receiver','attacker'].map(r=>call(r)));
  assert.deepEqual(a.key,b.key);assert.ok(a.key);assert.equal(e.key,null);
  console.log('PASS: simultaneous clients agree; role isolation and healthy key verified.');
  await call('attacker','attack',{attack:'ir'});
  await wait(25000);
  const [badA,badB]=await Promise.all(['sender','receiver'].map(r=>call(r)));
  assert.ok(badA.quarantine);assert.ok(badB.quarantine);assert.equal(badA.key,null);assert.equal(badB.key,null);
  console.log('PASS: attack rejects keys and both endpoints observe quarantine.');
  await call('attacker','attack',{attack:'none'});
  await wait(37000);
  const [goodA,goodB]=await Promise.all(['sender','receiver'].map(r=>call(r)));
  assert.equal(goodA.quarantine,false);assert.deepEqual(goodA.key,goodB.key);assert.ok(goodA.key);
  await call('sender','stop');assert.equal((await call('receiver')).key,null);
  console.log('PASS: clean-round recovery synchronizes a fresh key; stop revokes it.');
}finally{
  await rm(directory,{recursive:true,force:true});
}
