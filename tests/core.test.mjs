import test from 'node:test';
import assert from 'node:assert/strict';
import { imageMetrics, classifyQuality, groupSplit, datasetReport, annotationRecord, makeZip, crc32, safeSlug, sha256 } from '../src/core.js';
const frame = (id, sourceId, hash, status = 'approved', label = 'plastique') => ({ id, sourceId, hash, sha256: id.repeat(4), status, label, reviewedAt: '2026-10-31T00:00:00Z' });
test('flat image is filtered as blur; strong edges survive', () => {
  const flat = new Uint8ClampedArray(160 * 90 * 4).fill(128);
  assert.equal(classifyQuality(imageMetrics(flat, 160, 90), [], 35), 'flou');
  for (let y=0;y<90;y++) for (let x=0;x<160;x++) for(let c=0;c<3;c++) flat[(y*160+x)*4+c] = (x+y)%2 ? 0 : 255;
  assert.ok(imageMetrics(flat,160,90).sharpness > 35);
});
test('near duplicate is filtered, different dHash is retained', () => {
  const a = '0'.repeat(64), m = { hash:a, sharpness:100, brightness:100 };
  assert.equal(classifyQuality(m, [{hash:'1' + a.slice(1)}],35),'doublon');
  assert.equal(classifyQuality(m, [{hash:'1'.repeat(64)}],35),null);
});
test('whole sources and transitive visual overlaps cannot cross splits', () => {
  const a='0'.repeat(64), b='1'.repeat(64), c='01'.repeat(32), d='0011'.repeat(16);
  const frames=[frame('f1','A',a),frame('f2','A',b),frame('f3','B',b),frame('f4','B',c),frame('f5','C',c),frame('f6','D',d),frame('f7','E','10'.repeat(32))];
  const split=groupSplit(frames);
  assert.equal(split.bySource.A,split.bySource.B); assert.equal(split.bySource.B,split.bySource.C);
  assert.equal(split.independentGroups,3); assert.deepEqual(new Set(Object.values(split.bySource)),new Set(['train','val','test']));
});
test('one source is never randomly split to fake validation',()=>{
  assert.deepEqual(groupSplit([frame('f1','one','0'.repeat(64)),frame('f2','one','1'.repeat(64))]).bySource,{one:'train'});
});
test('report excludes pending, rejected, filtered and invalid labels',()=>{
  const state={name:'x',classes:['plastique','métal'],frames:[frame('a','S','0'.repeat(64)),frame('b','S','1'.repeat(64),'pending'),frame('c','S','01'.repeat(32),'rejected'),frame('d','S','10'.repeat(32),'filtered'),frame('e','S','0'.repeat(64),'approved','invented')],sources:[{id:'S',synthetic:true}],threshold:35,interval:3};
  const r=datasetReport(state); assert.equal(r.counts.approved,1); assert.equal(r.review.acceptance_rate,null); assert.ok(r.limitations.some(s=>s.includes('synthétiques'))); assert.ok(r.limitations.some(s=>s.includes('trois')));
});
test('annotation record distinguishes manual and model-assisted corrections',()=>{
  const f=frame('image','source','0'.repeat(64));
  assert.equal(annotationRecord(f,'train',['plastique']).annotation_origin,'human-only');
  f.prediction={label:'métal'}; const r=annotationRecord(f,'train',['plastique']);
  assert.equal(r.human_review.label_corrected,true); assert.equal(r.file,'train/plastique/image.jpg');
});
test('ZIP contains proper local, central and end signatures with UTF8 flag and CRC',async()=>{
  const data=new TextEncoder().encode('hello'); assert.equal(crc32(data),0x3610a686);
  const zip=makeZip([{name:'métal/a.txt',data}]); const bytes=new Uint8Array(await zip.arrayBuffer()),v=new DataView(bytes.buffer);
  assert.equal(v.getUint32(0,true),0x04034b50); assert.equal(v.getUint16(6,true),0x0800); assert.equal(v.getUint32(bytes.length-22,true),0x06054b50); assert.equal(v.getUint16(bytes.length-12,true),1);
});
test('safe folder names and SHA256 are deterministic',async()=>{assert.equal(safeSlug('Métal / canette'),'metal-canette'); assert.equal(await sha256('hello'),'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');});
