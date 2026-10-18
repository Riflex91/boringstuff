import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {inspectBoundedZipArchive,verifyPinnedOriginalArtifactZip,
 O58_ORIGINAL_ARCHIVE_HOLD} from './o58-original-artifact-integrity.mjs';

// No original game modules/ZIPs in CI. Independent small synthetic ZIP
// with a central directory whose Unix metadata can be mutated.
const name=Buffer.from('evidence/receipt.json');
const plaintext=Buffer.from('{"synthetic":"O64_METADATA_FIXTURE_ONLY"}');
const compressed=deflateRawSync(plaintext);
function crc32(buf){
 let c=0xffffffff;
 for(const b of buf){c^=b;for(let i=0;i<8;i++)
  c=c&1?0xedb88320^(c>>>1):c>>>1;}
 return (c^0xffffffff)>>>0;
}
const crc=crc32(plaintext);
const lh=Buffer.alloc(30);
lh.writeUInt32LE(0x04034b50);lh.writeUInt16LE(20,4);
lh.writeUInt16LE(8,8);lh.writeUInt32LE(crc,14);
lh.writeUInt32LE(compressed.length,18);
lh.writeUInt32LE(plaintext.length,22);
lh.writeUInt16LE(name.length,26);
const centralOffset=lh.length+name.length+compressed.length;
const central=Buffer.alloc(46);
central.writeUInt32LE(0x02014b50);
central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);
central.writeUInt32LE(compressed.length,20);
central.writeUInt32LE(plaintext.length,24);
central.writeUInt16LE(name.length,28);
const end=Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
end.writeUInt32LE(central.length+name.length,12);
end.writeUInt32LE(centralOffset,16);
const fixture=Buffer.concat([lh,name,compressed,central,name,end]);
function attributeCase(creatorOS,external,internal=0){
 const b=Buffer.from(fixture);
 b[centralOffset+5]=creatorOS;
 b.writeUInt16LE(internal,centralOffset+36);
 b.writeUInt32LE(external,centralOffset+38);
 return b;
}
const goodUnix=attributeCase(3,0x81a40020);
const goodPrivateUnix=attributeCase(3,0x81800020);
const goodDOS=attributeCase(0,0);
for(const bytes of [goodUnix,goodPrivateUnix,goodDOS]){
 const result=inspectBoundedZipArchive(bytes);
 assert.equal(result.entryCount,1);
 assert.deepEqual(result.entries[0].bytes,plaintext);
 assert.equal(result.entries[0].name,'evidence/receipt.json');
}
const malicious=[
 [3,0xa1ff0020,'Unix symlink'],
 [3,0x41ed0010,'Unix directory'],
 [3,0x21a40020,'Unix character device'],
 [3,0x61a40020,'Unix block device'],
 [3,0x11a40020,'Unix named pipe'],
 [3,0x81ed0020,'Unix executable file'],
 [3,0x89a40020,'Unix setuid file'],
 [3,0x81b60020,'Unix group-write file'],
 [3,0x81a40010,'Unix regular with DOS directory flag'],
 [3,0x81a40000,'Unix regular without pinned DOS archive bit'],
 [7,0x81a40020,'Unknown creator OS'],
 [0,0x00000010,'DOS directory'],
 [0,0x00000004,'DOS system file'],
 [0,0x00000002,'DOS hidden file'],
 [0,0x00000001,'DOS read-only alternate'],
 [0,0x81a40020,'DOS with unreviewed POSIX bits'],
 [3,0x81a40020,'Unsafe internal flags',1]
];
for(const [creator,attributes,label,internal] of malicious){
 assert.throws(()=>inspectBoundedZipArchive(
  attributeCase(creator,attributes,internal||0)),
  new RegExp(O58_ORIGINAL_ARCHIVE_HOLD),label);
}
assert.throws(()=>verifyPinnedOriginalArtifactZip(goodUnix,'world'),
 new RegExp(O58_ORIGINAL_ARCHIVE_HOLD),
 'A structurally sound Unix ZIP cannot impersonate the exact original bytes');
console.log('O64 Unix ZIP regular file and DOS attribute allowlist, symlink/device/executable/foreign-OS denial: PASS');
