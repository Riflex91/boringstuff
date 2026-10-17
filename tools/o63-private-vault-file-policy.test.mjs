import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sealPrivateRoadmapEvidence,inspectPrivateRoadmapArchive,
 ROADMAP_HISTORICAL_ARTIFACTS}
 from './o57-private-roadmap-evidence-vault.mjs';
import {inspectPrivateEvidencePair,O61_PRIVATE_PAIR_HOLD}
 from './o61-verify-private-evidence-pair.mjs';
import {assertPrivateArchiveDirectory,assertPrivateArchiveFiles,
 O63_PRIVATE_FILE_HOLD}
 from './o63-private-vault-file-policy.mjs';

const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'o63-private-mode-'));
const key=crypto.generateKeyPairSync('rsa',{
 modulusLength:3072,
 publicKeyEncoding:{format:'pem',type:'spki'},
 privateKeyEncoding:{format:'pem',type:'pkcs8'}
});
const hold=new RegExp(O63_PRIVATE_FILE_HOLD);
const ctx=server=>({repository:'Riflex91/boringstuff',
 ...ROADMAP_HISTORICAL_ARTIFACTS[server]});
function synthetic(server){
 return Buffer.from('PK\x03\x04SYNTHETIC_O63_'+server);
}
try{
 const pair=path.join(temp,'pair');
 fs.mkdirSync(pair,{mode:0o700});
 for(const server of ['world','newbieland']){
  sealPrivateRoadmapEvidence({
   zipBytes:synthetic(server),
   context:ctx(server),
   recipientPublicKeyPem:key.publicKey,
   destination:path.join(pair,server)
  });
 }
 assert.equal(assertPrivateArchiveDirectory(pair).releaseAuthorized,false);
 assert.equal(assertPrivateArchiveFiles(path.join(pair,'world'))
  .releaseAuthorized,false);
 assert.equal(inspectPrivateEvidencePair({archiveDirectory:pair})
  .matchingRecipientFingerprints,true);
 assert.throws(()=>assertPrivateArchiveDirectory(checkout),hold);
 assert.throws(()=>sealPrivateRoadmapEvidence({
  zipBytes:synthetic('world'),context:ctx('world'),
  recipientPublicKeyPem:key.publicKey,
  destination:path.join(checkout,'o63-must-not-create')
 }),/O57_EVIDENCE_VAULT_HOLD_PRIVATE_PARENT/);
 assert.equal(fs.existsSync(path.join(checkout,'o63-must-not-create')),false);

 if(process.platform!=='win32'){
  function modeAttack(filename,newMode,assertion){
   const stat=fs.statSync(filename),old=stat.mode&0o777;
   try{
    fs.chmodSync(filename,newMode);
    assertion();
   }finally{fs.chmodSync(filename,old);}
  }
  modeAttack(pair,0o755,()=>{
   assert.throws(()=>assertPrivateArchiveDirectory(pair),hold);
   assert.throws(()=>inspectPrivateEvidencePair({archiveDirectory:pair}),
    new RegExp(O61_PRIVATE_PAIR_HOLD));
  });
  modeAttack(path.join(pair,'world'),0o750,()=>{
   assert.throws(()=>assertPrivateArchiveFiles(path.join(pair,'world')),hold);
   assert.throws(()=>inspectPrivateEvidencePair({archiveDirectory:pair}),
    new RegExp(O61_PRIVATE_PAIR_HOLD));
  });
  for(const filename of ['archive.enc','archive-manifest.json']){
   const p=path.join(pair,'newbieland',filename);
   modeAttack(p,0o644,()=>{
    assert.throws(()=>assertPrivateArchiveFiles(path.join(pair,'newbieland')),hold);
    assert.throws(()=>inspectPrivateEvidencePair({archiveDirectory:pair}),
      new RegExp(O61_PRIVATE_PAIR_HOLD));
    assert.throws(()=>inspectPrivateRoadmapArchive({
      directory:path.join(pair,'newbieland'),context:ctx('newbieland')
    }),/O57_EVIDENCE_VAULT_HOLD_PRIVATE_FILE_POLICY/);
   });
  }
 }
 const manifest=path.join(pair,'world','archive-manifest.json');
 const backup=path.join(temp,'saved-manifest');
 fs.renameSync(manifest,backup);
 fs.symlinkSync(backup,manifest);
 assert.throws(()=>assertPrivateArchiveFiles(path.join(pair,'world')),hold);
 assert.throws(()=>inspectPrivateEvidencePair({archiveDirectory:pair}),
  new RegExp(O61_PRIVATE_PAIR_HOLD));
 fs.unlinkSync(manifest);fs.renameSync(backup,manifest);
 assert.equal(inspectPrivateEvidencePair({archiveDirectory:pair})
  .releaseAuthorized,false);
 console.log('O63 POSIX private archive owner/permissions, symlink, direct repository writer rejection and O61 recovery HOLD: PASS');
}finally{
 fs.rmSync(temp,{recursive:true,force:true});
}
