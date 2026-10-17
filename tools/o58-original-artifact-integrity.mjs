import crypto from 'node:crypto';
import {inflateRawSync} from 'node:zlib';

// O58 source bytes were fetched directly using GitHub's authenticated
// Actions artifact download tool on 2026-10-17. Not a canonical new World
// LIVE_100T_PASS: the World artifact belongs to an older commit.
export const ORIGINAL_ARTIFACT_SHA256=Object.freeze({
 world:'257ad662770e5b425c1f7322b5d240d8e3ca84aa76517f78d967ee29a21bb944',
 newbieland:'6a7b2db73798fd47a894c8741f830a97436cf9b19c7249ba74e0f81aa35cb685'
});
export const ORIGINAL_ARTIFACT_LENGTH=Object.freeze({world:193951,newbieland:192120});
export const O58_ORIGINAL_ARCHIVE_HOLD='O58_ORIGINAL_ARCHIVE_HOLD';
const hold=()=>{throw new Error(O58_ORIGINAL_ARCHIVE_HOLD);};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=x=>{if(!x)hold();};
const read16=(b,p)=>{if(p<0||p+2>b.length)hold();return b.readUInt16LE(p);};
const read32=(b,p)=>{if(p<0||p+4>b.length)hold();return b.readUInt32LE(p);};
const utf8=b=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{hold();}};
const entryMax=1024*1024;
const table=Uint32Array.from({length:256},(_,i)=>{
 let v=i;for(let j=0;j<8;j++)v=v&1?0xedb88320^(v>>>1):v>>>1;
 return v>>>0;
});
function crc32(buffer){let c=0xffffffff;for(const byte of buffer)c=table[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0;}

export function inspectBoundedZipArchive(bytes){
 check(Buffer.isBuffer(bytes)&&bytes.length>=30&&bytes.length<=32*1024*1024);
 // Parse central directory and each local entry without extracting files,
 // executing archive contents or trusting paths. Zip64/multidisk rejected.
 let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)
  if(read32(bytes,p)===0x06054b50){end=p;break;}
 check(end>=0&&end+22===bytes.length&&read16(bytes,end+20)===0);
 check(read16(bytes,end+4)===0&&read16(bytes,end+6)===0);
 const count=read16(bytes,end+10),start=read32(bytes,end+16),length=read32(bytes,end+12);
 check(count>=1&&count<=8&&count===read16(bytes,end+8)&&
  start!==0xffffffff&&length!==0xffffffff&&start+length===end);
 let cursor=start,total=0;
 // O60: the ZIP must contain only the claimed local records followed
 // immediately by its central directory. No shadow/prefix/hidden bytes.
 let expectedLocalOffset=0;
 const names=new Set(),entries=[];
 for(let index=0;index<count;index++){
  check(read32(bytes,cursor)===0x02014b50);
  const flags=read16(bytes,cursor+8),method=read16(bytes,cursor+10);
  const crc=read32(bytes,cursor+16),packed=read32(bytes,cursor+20);
  const unpacked=read32(bytes,cursor+24),nameLen=read16(bytes,cursor+28);
  const extra=read16(bytes,cursor+30),comment=read16(bytes,cursor+32);
  const disk=read16(bytes,cursor+34),local=read32(bytes,cursor+42);
  check((flags&1)===0&&(flags&~0x808)===0&&method===8&&
   packed>0&&packed<=32*1024*1024&&unpacked>0&&unpacked<=entryMax&&
   nameLen>0&&nameLen<=180&&extra===0&&comment===0&&disk===0&&
   local!==0xffffffff&&cursor+46+nameLen<=end);
  const name=utf8(bytes.subarray(cursor+46,cursor+46+nameLen));
  check(!names.has(name)&&/^[A-Za-z0-9_./-]+$/.test(name)&&
   !name.startsWith('/')&&!name.endsWith('/')&&!name.includes('//')&&
   name.split('/').every(s=>s!=='.'&&s!=='..'));
  names.add(name);cursor+=46+nameLen;
  check(local===expectedLocalOffset&&read32(bytes,local)===0x04034b50&&
   read16(bytes,local+6)===flags&&read16(bytes,local+8)===method);
  const localNameLen=read16(bytes,local+26);
  const localExtra=read16(bytes,local+28);
  const dataStart=local+30+localNameLen+localExtra;
  check(localNameLen===nameLen&&localExtra===0&&dataStart+packed<=start&&
   utf8(bytes.subarray(local+30,local+30+localNameLen))===name);
  // The local and central headers must describe the same entry. Data-
  // descriptor archives keep the 3 size/checksum fields zero in local
  // header; non-descriptor entries must carry the central values.
  check(read16(bytes,local+10)===read16(bytes,cursor-(46+nameLen)+12)&&
   read16(bytes,local+12)===read16(bytes,cursor-(46+nameLen)+14));
  if(flags&8){
   check(read32(bytes,local+14)===0&&read32(bytes,local+18)===0&&
    read32(bytes,local+22)===0);
  }else{
   check(read32(bytes,local+14)===crc&&read32(bytes,local+18)===packed&&
    read32(bytes,local+22)===unpacked);
  }
  // The Actions original ZIPs use 16-byte signed data descriptors.
  // Previous O58 accepted corrupt descriptors or payload gaps, while
  // validating the decompressed stream against the central directory.
  const compressedEnd=dataStart+packed;
  if(flags&8){
   check(compressedEnd+16<=start&&
    read32(bytes,compressedEnd)===0x08074b50&&
    read32(bytes,compressedEnd+4)===crc&&
    read32(bytes,compressedEnd+8)===packed&&
    read32(bytes,compressedEnd+12)===unpacked);
   expectedLocalOffset=compressedEnd+16;
  }else expectedLocalOffset=compressedEnd;
  check(expectedLocalOffset<=start);
  let content;
  try{content=inflateRawSync(bytes.subarray(dataStart,dataStart+packed),
    {maxOutputLength:entryMax});}catch{hold();}
  check(content.length===unpacked&&crc32(content)===crc);
  total+=content.length;check(total<=3*1024*1024);
  entries.push(Object.freeze({name,bytes:content,length:content.length,sha256:sha(content)}));
 }
 check(cursor===end&&expectedLocalOffset===start);
 return Object.freeze({sha256:sha(bytes),size:bytes.length,
  entries:Object.freeze(entries),entryCount:entries.length});
}

const paths=Object.freeze({
 world:Object.freeze([
  'boringstuff/boringstuff/logs/deploy-backup-2026-10-15T21-15-55-543Z.json',
  '_temp/w37s79-auto-deploy-evidence/consumer-supply-world-report.json',
  '_temp/w37s79-auto-deploy-evidence/deployment-receipt-world-chatgpt-w37s79-stage.json'
 ]),
 newbieland:Object.freeze([
  'boringstuff/boringstuff/logs/deploy-backup-2026-10-16T04-05-44-311Z.json',
  '_temp/screeps-verification/deployment-receipt-newbieland-chatgpt.json'
 ])
});
function json(entry){try{return JSON.parse(utf8(entry.bytes));}catch{hold();}}
export function verifyPinnedOriginalArtifactZip(bytes,server){
 check(Object.hasOwn(ORIGINAL_ARTIFACT_SHA256,server)&&
  Buffer.isBuffer(bytes)&&bytes.length===ORIGINAL_ARTIFACT_LENGTH[server]&&
  sha(bytes)===ORIGINAL_ARTIFACT_SHA256[server]);
 const zip=inspectBoundedZipArchive(bytes),wanted=paths[server];
 check(zip.entryCount===wanted.length&&zip.entries.every((e,i)=>e.name===wanted[i]));
 const backup=json(zip.entries[0]),receipt=json(zip.entries.at(-1));
 const branch=server==='world'?'chatgpt-w37s79-stage':'chatgpt';
 check(backup?.server===server&&receipt?.server===server&&
  backup.branch===branch&&receipt.branch===branch&&
  typeof backup.deploymentId==='string'&&backup.deploymentId.length>10&&
  receipt.deploymentId===backup.deploymentId&&
  backup.version==='0.3.0-shadow.15-node24'&&receipt.version===backup.version&&
  backup.modules&&typeof backup.modules==='object'&&!Array.isArray(backup.modules)&&
  Object.keys(backup.modules).length===82&&
  Object.values(backup.modules).every(v=>typeof v==='string'));
 if(server==='world'){
  const report=json(zip.entries[1]);
  check(report?.server==='world'&&report?.deploymentId===backup.deploymentId);
 }
 return Object.freeze({server,sha256:zip.sha256,zipBytes:zip.size,
  moduleCount:82,entryCount:zip.entryCount,
  entries:Object.freeze(zip.entries.map(e=>Object.freeze({
   name:e.name,sha256:e.sha256,bytes:e.length}))),
  deploymentId:backup.deploymentId,branch,
  originalGitHubArtifactBytesMatched:true,
  mainExactWorld100tWitness:false,releaseAuthorized:false});
}
