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
