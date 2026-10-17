import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {archivePinnedRoadmapOriginals}
 from './o57-archive-historical-originals.mjs';
import {verifyPrivateEvidencePairOffline}
 from './o61-verify-private-evidence-pair.mjs';

// O62: opt-in local E2E using the TWO ALREADY DOWNLOADED authentic
// original ZIPs, NEVER adding them to GitHub Actions, without live
// network and without a long-lived generated private key. The generated
// fixture key exists only in an isolated private temp directory and is
// deleted with the temporary archive on return. This is NOT durable
// operator custody or a production rollback escrow.
export const O62_ORIGINAL_PAIR_SMOKE_HOLD='O62_ORIGINAL_PAIR_SMOKE_HOLD';
function deny(){throw new Error(O62_ORIGINAL_PAIR_SMOKE_HOLD);}
export function smokeOriginalPairOffline({worldZip,newbielandZip}={}){
 if(typeof worldZip!=='string'||typeof newbielandZip!=='string'||
   !path.isAbsolute(worldZip)||!path.isAbsolute(newbielandZip))deny();
 let tmp,privatePem;
 try{
  tmp=fs.mkdtempSync(path.join(os.tmpdir(),'o62-real-original-e2e-'));
  if(process.platform!=='win32')fs.chmodSync(tmp,0o700);
  const key=crypto.generateKeyPairSync('rsa',{
   modulusLength:3072,
   publicKeyEncoding:{type:'spki',format:'pem'},
   privateKeyEncoding:{type:'pkcs8',format:'pem'}
  });
  privatePem=Buffer.from(key.privateKey);
  const publicFile=path.join(tmp,'ephemeral.pub.pem');
  const privateFile=path.join(tmp,'ephemeral.private.pem');
  fs.writeFileSync(publicFile,key.publicKey,{flag:'wx',mode:0o600});
  fs.writeFileSync(privateFile,privatePem,{flag:'wx',mode:0o600});
  const archived=archivePinnedRoadmapOriginals([
   '--output-parent',tmp,'--world-zip',worldZip,
   '--newbieland-zip',newbielandZip,'--public-key',publicFile
  ]);
  const result=verifyPrivateEvidencePairOffline({
   archiveDirectory:archived.encryptedDirectory,
   recipientPrivateKeyPath:privateFile
  });
  if(result.archivesRecovered!==2||result.originalBytesVerified!==true||
      result.releaseAuthorized!==false||
      result.checked.world.moduleCount!==82||
      result.checked.newbieland.moduleCount!==82)deny();
  return Object.freeze({
   realOriginalBytesRoundTripVerified:true,
   originalArchivesRecovered:2,
   sourceModulesEach:82,
   temporaryKeyAndArchiveDestroyedOnReturn:true,
   archivedInIndependentDurableStorage:false,
   ownerRecoveryKeyValidated:false,
   releaseAuthorized:false,
   mayUploadWorldCode:false,mayMergeCandidate:false
  });
 }catch{deny();}
 finally{
  if(privatePem)privatePem.fill(0);
  if(tmp)fs.rmSync(tmp,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const argv=process.argv.slice(2);
  if(argv.length!==4||argv[0]!=='--world-zip'||
     argv[2]!=='--newbieland-zip')deny();
  const x=smokeOriginalPairOffline({
   worldZip:argv[1],newbielandZip:argv[3]
  });
  console.log('O62_REAL_ORIGINAL_PAIR_OFFLINE_SMOKE_PASS '+JSON.stringify(x));
 }catch{
  console.error(O62_ORIGINAL_PAIR_SMOKE_HOLD);
  process.exitCode=2;
 }
}
