import './build-local.mjs';
import {mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const directory=new URL('vercel-demo/',import.meta.url);
mkdirSync(directory,{recursive:true});
for(const folder of ['public','api','live','dist'])mkdirSync(new URL(folder+'/',directory),{recursive:true});
copyFileSync(new URL('QKD Lab.html',import.meta.url),new URL('public/index.html',directory));
copyFileSync(new URL('simulation.html',import.meta.url),new URL('public/simulation.html',directory));
for(const file of ['live.html','live.css','live.js'])copyFileSync(new URL('live/'+file,import.meta.url),new URL('public/'+file,directory));
for(const file of ['package.json','package-lock.json'])copyFileSync(new URL('live/'+file,import.meta.url),new URL(file,directory));
copyFileSync(new URL('live/session.mjs',import.meta.url),new URL('live/session.mjs',directory));
copyFileSync(new URL('dist/engine.mjs',import.meta.url),new URL('dist/engine.mjs',directory));
copyFileSync(new URL('live/room-api.mjs',import.meta.url),new URL('api/room.js',directory));
rmSync(new URL('index.html',directory),{force:true});
writeFileSync(new URL('.vercelignore',directory),'.env*\nnode_modules\n');
writeFileSync(new URL('vercel.json',directory),JSON.stringify({
  $schema:'https://openapi.vercel.sh/vercel.json',
  framework:null,
  buildCommand:'',
  outputDirectory:'public',
  regions:['iad1'],
  functions:{'api/room.js':{maxDuration:30}},
  headers:[{source:'/(.*)',headers:[{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Content-Type-Options',value:'nosniff'}]}]
},null,2)+'\n');
console.log(`Vercel web demo ready: ${fileURLToPath(directory)}`);
