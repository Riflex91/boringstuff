import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {archivePinnedRoadmapOriginals}
 from './o57-archive-historical-originals.mjs';
import {restorePrivateRoadmapEvidenceOffline,ROADMAP_HISTORICAL_ARTIFACTS}
 from './o57-private-roadmap-evidence-vault.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'o57-zip-archives-'));
try{
 const pair=crypto.generateKeyPairSync('rsa',{
  modulusLength:3072,
  publicKeyEncoding:{format:'pem',type:'spki'},
  privateKeyEncoding:{format:'pem',type:'pkcs8'}
 });
 const keyFile=path.join(tmp,'operator.pub');
 fs.writeFileSync(keyFile,pair.publicKey,{mode:0o600});
 const worldBytes=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),
  Buffer.from('synthetic world archive no real credentials')]);
 const newbBytes=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),
  Buffer.from('synthetic newbieland archive no real credentials')]);
 const w=path.join(tmp,'world.zip'),n=path.join(tmp,'newb.zip');
 fs.writeFileSync(w,worldBytes);
 fs.writeFileSync(n,newbBytes);
 const args=['--output-parent',tmp,'--world-zip',w,
  '--newbieland-zip',n,'--public-key',keyFile];
 const outcome=archivePinnedRoadmapOriginals(args);
 assert.equal(outcome.sourceArtifacts,2);
 assert.equal(outcome.releaseAuthorized,false);
 assert.equal(outcome.durableRemoteStorageVerified,false);
 assert.deepEqual(fs.readdirSync(outcome.encryptedDirectory).sort(),
  ['newbieland','world']);
 for(const [server,bytes] of [['world',worldBytes],['newbieland',newbBytes]]){
  const restored=restorePrivateRoadmapEvidenceOffline({
   directory:path.join(outcome.encryptedDirectory,server),
   context:{repository:'Riflex91/boringstuff',...ROADMAP_HISTORICAL_ARTIFACTS[server]},
   recipientPrivateKeyPem:pair.privateKey
  });
  assert.deepEqual(restored.zipBytes,bytes);
 }
 assert.throws(()=>archivePinnedRoadmapOriginals(args),
  /O57_ARCHIVE_ORIGINALS_HOLD/);
 const bad=path.join(tmp,'bad.zip');
 fs.writeFileSync(bad,Buffer.from('NOT_A_ZIP'));
 const another=path.join(tmp,'other');
 fs.mkdirSync(another);
 assert.throws(()=>archivePinnedRoadmapOriginals([
  '--output-parent',another,'--world-zip',bad,
  '--newbieland-zip',n,'--public-key',keyFile
 ]),/O57_ARCHIVE_ORIGINALS_HOLD/);
 assert.deepEqual(fs.readdirSync(another),[]);
 assert.throws(()=>archivePinnedRoadmapOriginals([
  '--output-parent',another,'--world-zip',w,
  '--newbieland-zip',n,'--public-key',keyFile,
  '--approval','DEPLOY_WORLD'
 ]),/O57_ARCHIVE_ORIGINALS_HOLD/);
 console.log('O57 offline paired original ZIP encryption with atomic private archive handoff: PASS');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
