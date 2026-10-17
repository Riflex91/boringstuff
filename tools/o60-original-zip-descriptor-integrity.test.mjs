import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {inspectBoundedZipArchive,O58_ORIGINAL_ARCHIVE_HOLD}
 from './o58-original-artifact-integrity.mjs';

// Synthetic descriptor-format archive, deliberately distinct from the
// separately retained genuine 2026-10-15/16 Actions ZIP data. No original
// ZIP, source modules or credentials are bundled into GitHub Actions.
const text=Buffer.from('{"fixture":"synthetic-signed-descriptor"}');
const name=Buffer.from('fixture/evidence.json');
const data=deflateRawSync(text);
function crc32(buf) {
 let c=0xffffffff;
 for(const b of buf){c^=b;for(let i=0;i<8;i++)
   c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);}
 return (c^0xffffffff)>>>0;
}
const crc=crc32(text);
const lh=Buffer.alloc(30);
lh.writeUInt32LE(0x04034b50);
lh.writeUInt16LE(20,4);
lh.writeUInt16LE(8,6);
lh.writeUInt16LE(8,8);
lh.writeUInt16LE(name.length,26);
const dd=Buffer.alloc(16);
dd.writeUInt32LE(0x08074b50,0);
dd.writeUInt32LE(crc,4);
dd.writeUInt32LE(data.length,8);
dd.writeUInt32LE(text.length,12);
const ch=Buffer.alloc(46);
ch.writeUInt32LE(0x02014b50);
ch.writeUInt16LE(20,4);
ch.writeUInt16LE(20,6);
ch.writeUInt16LE(8,8);
ch.writeUInt16LE(8,10);
ch.writeUInt32LE(crc,16);
ch.writeUInt32LE(data.length,20);
ch.writeUInt32LE(text.length,24);
ch.writeUInt16LE(name.length,28);
const start=lh.length+name.length+data.length+dd.length;
const directory=Buffer.concat([ch,name]);
const end=Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(1,8);
end.writeUInt16LE(1,10);
end.writeUInt32LE(directory.length,12);
end.writeUInt32LE(start,16);
const good=Buffer.concat([lh,name,data,dd,directory,end]);
assert.deepEqual(inspectBoundedZipArchive(good).entries[0].bytes,text);
const hold=new RegExp(O58_ORIGINAL_ARCHIVE_HOLD);
for(const offset of [0,4,8,12]) {
 const bad=Buffer.from(good);
 bad[lh.length+name.length+data.length+offset]^=0x1;
 assert.throws(()=>inspectBoundedZipArchive(bad),hold,
   'mismatched data descriptor at byte '+offset);
}
const gap=Buffer.concat([good.subarray(0,start),Buffer.from('EXTRA'),
 good.subarray(start)]);
gap.writeUInt32LE(start+5,gap.length-22+16);
assert.throws(()=>inspectBoundedZipArchive(gap),hold);
const prefix=Buffer.concat([Buffer.from('PFX'),good]);
prefix.writeUInt32LE(3,3+start+42);
prefix.writeUInt32LE(start+3,prefix.length-22+16);
assert.throws(()=>inspectBoundedZipArchive(prefix),hold);
console.log('O60 signed ZIP descriptor CRC/sizes, no concealed gap/prefix: PASS');
