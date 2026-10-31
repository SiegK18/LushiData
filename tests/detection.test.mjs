import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_DETECTION,TASK_CLASSIFICATION,validBox,boxToYolo,isExportable,detectionExport,datasetReport,sha256,makeAnnotationPrompt,DETECTION_PROMPT_VERSION } from '../src/core.js';
import {parseAnnotations,validateInput,annotate} from '../src/server.js';
const classes=['plastique','métal'];
const objects=[{id:'a',label:'plastique',box_2d:[200,100,600,500],uncertain:false},{id:'b',label:'plastique',box_2d:[100,600,400,900],uncertain:false}];
const frame=()=>({id:'image_1',sourceId:'source',width:800,height:400,time:1,sha256:'abc',hash:'0'.repeat(64),objects:structuredClone(objects),status:'approved',sceneConfirmed:true,reviewedAt:'2026-10-31T00:00:00Z'});
const state=()=>({name:'test',task:TASK_DETECTION,classes,frames:[frame()],sources:[{id:'source'}],threshold:35,interval:3});
test('boxes reject inverted, non-numeric, zero area and out-of-image coordinates',()=>{
  assert.equal(validBox([0,0,1000,1000]),true);for(const b of [[0,0,0,50],[100,0,50,100],[-1,0,100,100],[0,0,1001,100],['0',0,100,100],[0,NaN,100,100]])assert.equal(validBox(b),false);
});
test('YOLO conversion keeps horizontal and vertical axes in the right order',()=>{const out=boxToYolo([200,100,600,500]);[.3,.4,.4,.4].forEach((v,i)=>assert.ok(Math.abs(out[i]-v)<1e-12));});
test('COCO and YOLO retain two instances of the same class and pixel dimensions',()=>{
  const s=state(),out=detectionExport(s.frames,s,{bySource:{source:'train'}}),coco=JSON.parse(out.files.find(f=>f.name==='coco/train.json').data),yolo=out.files.find(f=>f.name==='labels/train/image_1.txt').data;
  assert.equal(coco.annotations.length,2);assert.deepEqual(coco.annotations[0].bbox,[80,80,320,160]);assert.equal(coco.annotations[0].category_id,1);assert.equal(coco.images[0].width,800);assert.equal(out.records[0].objects[0].class_id,0);assert.equal(yolo.trim().split('\n').length,2);assert.equal(out.records[0].file,'images/train/image_1.jpg');
});
test('unreviewed scenes, unknown categories and unconfirmed empty images cannot export',()=>{
  const s=state(),f=s.frames[0];f.sceneConfirmed=false;assert.equal(isExportable(f,s),false);f.sceneConfirmed=true;f.objects[0].label='indéterminé';assert.equal(isExportable(f,s),false);f.objects=[];assert.equal(isExportable(f,s),false);f.emptyConfirmed=true;assert.equal(isExportable(f,s),true);const out=detectionExport([f],s,{bySource:{source:'train'}});assert.equal(out.files.find(x=>x.name==='labels/train/image_1.txt').data,'');
});
test('detection reports count images separately from object instances',()=>{const s=state(),r=datasetReport(s);assert.equal(r.counts.approved,1);assert.equal(r.counts.objects,2);assert.equal(r.counts.by_class.plastique,2);assert.equal(r.task,TASK_DETECTION);assert.equal(r.prompt_version,DETECTION_PROMPT_VERSION);});
test('model parser preserves individual objects and marks unknown classes for review',()=>{
  const a=parseAnnotations(JSON.stringify([{id:'image_1',objects:[objects[0],{...objects[1],label:'verre'}],incomplete:false}]),[{id:'image_1'}],classes,TASK_DETECTION)[0];assert.equal(a.objects.length,2);assert.notEqual(a.objects[0].id,a.objects[1].id);assert.equal(a.objects[1].label,'indéterminé');assert.equal(a.objects[1].uncertain,true);
});
test('missing object arrays and invalid model boxes fail instead of creating negative samples',()=>{
  for(const row of [{id:'image_1'},{id:'image_1',objects:[{label:'plastique',box_2d:[10,10,2,2]}]}])assert.throws(()=>parseAnnotations(JSON.stringify([row]),[{id:'image_1'}],classes,TASK_DETECTION));
});
test('detection request uses its own prompt and provenance while legacy classification remains valid',async()=>{
  const frames=[{id:'image_1',data:'data:image/jpeg;base64,/9j/AA=='}];let payload;
  const r=await annotate({classes,frames,task:TASK_DETECTION},{GEMINI_API_KEY:'test-only'},async(url,options)=>{payload=JSON.parse(options.body);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify([{id:'image_1',objects,incomplete:false,reason:'Deux objets visibles.'}])}]}}]});});
  const result=await r.json();assert.equal(r.status,200);assert.equal(result.annotations[0].objects.length,2);assert.equal(result.provenance.prompt_version,DETECTION_PROMPT_VERSION);assert.equal(result.provenance.prompt_sha256,await sha256(makeAnnotationPrompt(classes,['image_1'],TASK_DETECTION)));assert.equal(payload.generationConfig.maxOutputTokens,4096);assert.ok(makeAnnotationPrompt(classes,['image_1'],TASK_CLASSIFICATION).includes('SINGLE-LABEL'));
});
test('invalid tasks and multi-image detection batches are refused',()=>{
  const f={id:'i',data:'data:image/jpeg;base64,/9j/AA=='};assert.throws(()=>validateInput({classes,frames:[f],task:'anything'}));assert.throws(()=>validateInput({classes,frames:[f,{...f,id:'j'}],task:TASK_DETECTION}));assert.doesNotThrow(()=>validateInput({classes,frames:[f,{...f,id:'j'}]}));
});
