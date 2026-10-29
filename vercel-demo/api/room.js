import { get, put, del, BlobPreconditionFailedError } from '@vercel/blob';
import { createSession, authorize, advance, act, project } from '../live/session.mjs';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return res.status(405).json({error:'Use POST.'});
  if(req.headers.origin && req.headers.origin!==`https://${req.headers.host}`) return res.status(403).json({error:'Origin not allowed.'});
  let body=req.body;
  try {if(typeof body==='string')body=JSON.parse(body);}catch{return res.status(400).json({error:'Invalid JSON.'});}
  if(!body||typeof body!=='object'||JSON.stringify(body).length>35000) return res.status(400).json({error:'Invalid request or file too large.'});
  try {
    if(body.action==='create') {
      const s=createSession(body);
      await put(`rooms/${s.id}.json`,JSON.stringify(s),{access:'private',addRandomSuffix:false});
      return res.status(201).json({id:s.id,tokens:s.tokens,expires:s.expires});
    }
    if(!/^[a-f0-9]{48}$/.test(body.id||'')||!/^[a-f0-9]{48}$/.test(body.token||'')) return res.status(403).json({error:'Invalid room link.'});
    const path=`rooms/${body.id}.json`;
    for(let attempt=0;attempt<5;attempt++) {
      const stored=await get(path,{access:'private',useCache:false,headers:{'Accept-Encoding':'identity'}});
      if(!stored) return res.status(404).json({error:'Room not found. Create a new room.'});
      const s=await new Response(stored.stream).json();
      if(!authorize(s,body.role,body.token)) return res.status(403).json({error:'This link does not authorize this role.'});
      const now=Date.now();
      if(now>=s.expires){await del(path,{ifMatch:stored.blob.etag});return res.status(410).json({error:'Room expired. Create a new room.'});}
      const previous=s.revision;
      advance(s,now);
      if(body.action!=='poll')act(s,body.role,body,now);
      try {
        if(previous!==s.revision)await put(path,JSON.stringify(s),{access:'private',addRandomSuffix:false,allowOverwrite:true,ifMatch:stored.blob.etag});
        return res.status(200).json(project(s,body.role,now));
      }catch(e){if(e instanceof BlobPreconditionFailedError){console.info('Room write conflict',{attempt,weakEtag:stored.blob.etag.startsWith('W/'),revision:previous});await new Promise(resolve=>setTimeout(resolve,100+Math.random()*200));continue;}throw e;}
    }
    return res.status(409).json({error:'Another participant updated the room. Please retry.'});
  }catch(e){
    if(/Choose a valid|Ask the receiver|Session complete|Unknown attack|control limit|cannot perform|File cannot|Invalid file|File verification/.test(e.message))return res.status(400).json({error:e.message});
    console.error('Room operation failed:',e.name,String(e.message).replace(/vercel_blob_rw_\S+|[a-f0-9]{48}/g,'[redacted]').slice(0,180));
    return res.status(503).json({error:'Session service unavailable. Please retry shortly.'});
  }
}
