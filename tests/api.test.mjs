import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateInput, parseAnnotations, annotate, makePrompt } from '../src/server.js';
import { sha256 } from '../src/core.js';
const frames=[{id:'image_1',data:'data:image/jpeg;base64,/9j/AA=='}],classes=['plastique','métal'];
test('API bounds image count and rejects duplicate ids and malformed images',()=>{
  assert.throws(()=>validateInput({classes,frames:[...frames,...frames]}));
  assert.throws(()=>validateInput({classes,frames:[{id:'x',data:'data:text/plain;base64,AA=='}]}));
  assert.throws(()=>validateInput({classes,frames:Array.from({length:5},(_,i)=>({...frames[0],id:'i'+i}))}));
  assert.throws(()=>validateInput({classes:['x','x'],frames}));
});
test('unlisted model labels become unknown; mismatched ids reject the batch',()=>{
  const result=parseAnnotations('[{"id":"image_1","label":"autre","reason":"x","uncertain":false}]',frames,classes);
  assert.equal(result[0].label,'indéterminé'); assert.equal(result[0].uncertain,true);
  assert.throws(()=>parseAnnotations('[{"id":"wrong","label":"plastique"}]',frames,classes));
});
test('successful hosted request preserves model identity and hashes exact prompt',async()=>{
  let payload,headers;
  const result=await annotate({classes,frames},{GEMINI_API_KEY:'test-only'},async(url,opts)=>{
    assert.ok(url.endsWith('gemma-4-26b-a4b-it:generateContent')); headers=opts.headers; payload=JSON.parse(opts.body);
    return Response.json({candidates:[{content:{parts:[{text:'private thought',thought:true},{text:'```json\n[{"id":"image_1","label":"plastique","reason":"Une bouteille visible.","uncertain":false}]\n```'}]}}]});
  });
  const data=await result.json(); assert.equal(result.status,200); assert.equal(data.annotations[0].label,'plastique'); assert.equal(headers['x-goog-api-key'],'test-only'); assert.equal(data.provenance.prompt_sha256,await sha256(makePrompt(classes,['image_1']))); assert.ok(payload.contents[0].parts.some(p=>p.inlineData)); assert.ok(!JSON.stringify(data).includes('test-only'));
});
test('upstream errors never leak the credential or fabricate annotations',async()=>{
  const result=await annotate({classes,frames},{GEMINI_API_KEY:'secret-value'},async()=>new Response('secret-value request details',{status:403}));
  const body=await result.text(); assert.equal(result.status,502); assert.ok(!body.includes('secret-value')); assert.ok(!body.includes('annotations'));
});
test('missing key and malformed model outputs have explicit failures',async()=>{
  assert.equal((await annotate({classes,frames},{})).status,503);
  const result=await annotate({classes,frames},{GEMINI_API_KEY:'test'},async()=>Response.json({candidates:[{content:{parts:[{text:'not JSON'}]}}]})); assert.equal(result.status,502);
});
test('health exposes configuration state only; cross-origin requests are refused',async()=>{
  const health=await worker.fetch(new Request('http://localhost/api/health'),{GEMINI_API_KEY:'secret-value'}); const text=await health.text(); assert.ok(text.includes('"configured":true')); assert.ok(!text.includes('secret-value'));
  const blocked=await worker.fetch(new Request('http://localhost/api/annotate',{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:'{}'}),{}); assert.equal(blocked.status,403);
});
const goodResponse = () => Response.json({candidates:[{content:{parts:[{text:'[{"id":"image_1","label":"plastique","reason":"Bouteille visible.","uncertain":false}]'}]}}]});
test('transient 503 and 500 errors recover with bounded backoff and intact provenance',async()=>{
  const delays=[];let calls=0;
  const response=await annotate({classes,frames},{GEMINI_API_KEY:'test'},async()=>{
    calls++;if(calls===1)return new Response('busy',{status:503});if(calls===2)return new Response('internal',{status:500});return goodResponse();
  },{sleep:async ms=>delays.push(ms)});
  const data=await response.json();assert.equal(response.status,200);assert.equal(calls,3);assert.deepEqual(delays,[600,1400]);assert.equal(data.provenance.upstream_requests,3);assert.equal(data.provenance.recovered_after_retry,true);assert.equal(data.provenance.prompt_sha256,await sha256(makePrompt(classes,['image_1'])));
});
test('permanent upstream failure stops after three attempts without invented annotations',async()=>{
  let calls=0;const response=await annotate({classes,frames},{GEMINI_API_KEY:'never-leak'},async()=>{calls++;return new Response('never-leak',{status:503});},{sleep:async()=>{}});
  const data=await response.json();assert.equal(calls,3);assert.equal(response.status,502);assert.equal(data.code,'GOOGLE_503');assert.equal(data.attempts,3);assert.equal(data.retryable,true);assert.ok(!('annotations' in data));assert.ok(!JSON.stringify(data).includes('never-leak'));
});
test('authentication errors and long quota cooldowns are not retried',async()=>{
  for(const status of [403,429]){let calls=0;const r=await annotate({classes,frames},{GEMINI_API_KEY:'test'},async()=>{calls++;return new Response('error',{status,headers:{'retry-after':'60'}});},{sleep:async()=>assert.fail('should not sleep')});assert.equal(calls,1);assert.equal((await r.json()).upstream_status,status);}
});
test('network interruption retries and never reuses an earlier HTTP response',async()=>{
  let calls=0;const r=await annotate({classes,frames},{GEMINI_API_KEY:'test'},async()=>{calls++;if(calls===1)return new Response('busy',{status:503});throw new Error('network disconnected');},{sleep:async()=>{}});const data=await r.json();assert.equal(calls,3);assert.equal(r.status,504);assert.equal(data.code,'UPSTREAM_UNAVAILABLE');assert.ok(!('annotations' in data));
});
