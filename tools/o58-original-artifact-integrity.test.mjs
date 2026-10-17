import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {
 inspectBoundedZipArchive,verifyPinnedOriginalArtifactZip,
 ORIGINAL_ARTIFACT_SHA256,ORIGINAL_ARTIFACT_LENGTH,O58_ORIGINAL_ARCHIVE_HOLD
} from './o58-original-artifact-integrity.mjs';
const sig=Buffer.from('PK\x03\x04');
function crc32(b){
 let c=0xffffffff;
 for(const byte of b){
  c^=byte;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
 }
 return (c^0xffffffff)>>>0;
}
// Fully synthetic ZIP generator for structural and adversarial tests. No
// historical evidence ZIP or credentials are embedded into git or CI.
function zip(files){
 const local=[],central=[];let offset=0;
 for(const [name,content] of files){
  const nameBuf=Buffer.from(name),body=Buffer.from(content);
  const data=deflateRawSync(body),crc=crc32(body);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);
  h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);
  h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);
  h.writeUInt32LE(body.length,22);h.writeUInt16LE(nameBuf.length,26);
  local.push(h,nameBuf,data);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);
  c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);
  c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);
  c.writeUInt32LE(data.length,20);c.writeUInt32LE(body.length,24);
  c.writeUInt16LE(nameBuf.length,28);c.writeUInt32LE(offset,42);
  central.push(c,nameBuf);offset+=h.length+nameBuf.length+data.length;
 }
 const centralData=Buffer.concat(central),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);
 end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralData.length,12);
 end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,centralData,end]);
}
const example=zip([
 ['fixtures/backup.json','{"modules":82,"server":"synthetic"}'],
 ['fixtures/receipt.json','{"deploymentId":"SYNTHETIC_ONLY"}']
]);
const parsed=inspectBoundedZipArchive(example);
assert.equal(parsed.entryCount,2);
assert.equal(parsed.entries[0].name,'fixtures/backup.json');
assert.deepEqual(parsed.entries[0].bytes,
 Buffer.from('{"modules":82,"server":"synthetic"}'));
assert.equal(parsed.size,example.length);
assert.equal(parsed.sha256,crypto.createHash('sha256').update(example).digest('hex'));
const hold=new RegExp(O58_ORIGINAL_ARCHIVE_HOLD);
assert.equal(ORIGINAL_ARTIFACT_LENGTH.world,193951);
assert.equal(ORIGINAL_ARTIFACT_LENGTH.newbieland,192120);
assert.equal(ORIGINAL_ARTIFACT_SHA256.world,
 '257ad662770e5b425c1f7322b5d240d8e3ca84aa76517f78d967ee29a21bb944');
assert.equal(ORIGINAL_ARTIFACT_SHA256.newbieland,
 '6a7b2db73798fd47a894c8741f830a97436cf9b19c7249ba74e0f81aa35cb685');
for(const server of ['world','newbieland']){
 assert.throws(()=>verifyPinnedOriginalArtifactZip(example,server),hold);
}
for(const bytes of [
 Buffer.alloc(20),Buffer.from('not a ZIP'),
 Buffer.concat([example,Buffer.from('trail')]),
 (()=>{const x=Buffer.from(example);x[10]^=1;return x;})(),
 zip([['../escape.json','{}']]),
 zip([['/absolute.json','{}']]),
 zip([['duplicates.json','{}'],['duplicates.json','{}']]),
 zip([['unsafe//name.json','{}']]),
 zip([['normal.json','\ufffd']])
 .subarray(0,18),
 zip([['huge.json','A'.repeat(1024*1024+1)]]),
 (()=>{const x=Buffer.from(example);x.writeUInt32LE(0,14);return x;})()
]){
 assert.throws(()=>inspectBoundedZipArchive(bytes),hold);
}
assert.throws(()=>verifyPinnedOriginalArtifactZip(example,'unknown'),hold);
const result=inspectBoundedZipArchive(example);
assert.equal(Object.hasOwn(result,'releaseAuthorized'),false);
console.log('O58 bounded ZIP parsing, CRC/inflate safety, traversal/duplicate and pinned original bytes controls: PASS');
