import {normalize} from './engine.mjs';

// Share configuration only. Each page runs the engine itself; no result is supplied in the link.
export function runFragment(settings) {
  return '#qkd='+encodeURIComponent(JSON.stringify(normalize(settings)));
}
export function readRunFragment(hash) {
  if(!hash.startsWith('#qkd='))return null;
  const input=JSON.parse(decodeURIComponent(hash.slice(5)));
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid shared settings');
  const settings={};
  for(const key of Object.keys(normalize()))if(Object.hasOwn(input,key))settings[key]=input[key];
  return normalize(settings);
}
