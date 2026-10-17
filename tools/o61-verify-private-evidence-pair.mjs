import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROADMAP_HISTORICAL_ARTIFACTS,
  inspectPrivateRoadmapArchive,restorePrivateRoadmapEvidenceOffline}
  from './o57-private-roadmap-evidence-vault.mjs';
import {ORIGINAL_ARTIFACT_SHA256,ORIGINAL_ARTIFACT_LENGTH,
  verifyPinnedOriginalArtifactZip} from './o58-original-artifact-integrity.mjs';
import {assertPrivateArchiveDirectory,assertPrivateArchiveFiles}
 from './o63-private-vault-file-policy.mjs';

// O61: a private, offline, pair-wide read-only recovery audit. It NEVER
// generates private keys, downloads archives, sends bytes, writes restored
// source code, returns release permission or changes a Screeps server.
export const O61_PRIVATE_PAIR_HOLD='O61_PRIVATE_EVIDENCE_PAIR_HOLD';
const refuse=()=>{throw new Error(O61_PRIVATE_PAIR_HOLD);};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hex64=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function inRepo(p){
 const relative=path.relative(root,p);
 return relative===''||(!relative.startsWith('..'+path.sep)&&
   relative!=='..'&&!path.isAbsolute(relative));
}
function resolveExternalDir(dir){
 if(typeof dir!=='string'||!path.isAbsolute(dir))refuse();
 let rp,st;
 try{
  st=fs.lstatSync(dir);
  rp=fs.realpathSync.native(dir);
 }catch{refuse();}
 if(!st.isDirectory()||st.isSymbolicLink()||inRepo(rp))refuse();
 return rp;
}
function boundedFile(file,max){
 let st;
 try{st=fs.lstatSync(file);}catch{refuse();}
 if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>max)refuse();
 return st;
}
function context(server){
 return Object.freeze({
  repository:'Riflex91/boringstuff',...ROADMAP_HISTORICAL_ARTIFACTS[server]
 });
}
function readPair(directory){
 const rp=resolveExternalDir(directory);
 assertPrivateArchiveDirectory(rp);
 const names=fs.readdirSync(rp).sort();
 if(JSON.stringify(names)!==JSON.stringify(['newbieland','world']))refuse();
 const results={};
 for(const server of ['world','newbieland']){
  const sub=path.join(rp,server);
  const subStat=fs.lstatSync(sub);
  if(!subStat.isDirectory()||subStat.isSymbolicLink())refuse();
  if(fs.realpathSync.native(sub)!==sub)refuse();
  assertPrivateArchiveFiles(sub);
  const entries=fs.readdirSync(sub).sort();
  if(JSON.stringify(entries)!==JSON.stringify(['archive-manifest.json','archive.enc']))
   refuse();
  boundedFile(path.join(sub,'archive-manifest.json'),16*1024);
  boundedFile(path.join(sub,'archive.enc'),33*1024*1024);
  const item=inspectPrivateRoadmapArchive({directory:sub,context:context(server)});
  const m=item.manifest;
  if(!hex64(m.fingerprint)||
     !/^[a-f0-9]{24}$/.test(m.iv||'')||
     typeof m.wrappedKey!=='string'||m.wrappedKey.length>2048||
     !hex64(m.plaintextSha256)||m.plaintextBytes<1||
     m.plaintextBytes>32*1024*1024)refuse();
  results[server]={directory:sub,manifest:m};
 }
 const w=results.world.manifest,n=results.newbieland.manifest;
 if(w.fingerprint!==n.fingerprint||w.iv===n.iv||
    w.wrappedKey===n.wrappedKey||w.ciphertextSha256===n.ciphertextSha256)refuse();
 return results;
}
export function inspectPrivateEvidencePair({archiveDirectory}={}){
 try{
  const pair=readPair(archiveDirectory);
  return Object.freeze({
   archiveType:'O57_PRIVATE_EVIDENCE_V1',
   archivesPresent:2,
   matchingRecipientFingerprints:true,
   independentCiphertextKeysAndNonces:true,
   metadataIntegrityChecksPassed:true,
   authenticatedPlaintextOriginals:false,
   privateKeyRestorationTested:false,
   replicatedToIndependentStorage:false,
   releaseAuthorized:false,mayUploadWorldCode:false,
   mayMergeCandidate:false,
   fingerprints:Object.freeze({recipient:pair.world.manifest.fingerprint})
  });
 }catch{refuse();}
}
function readPrivateKey(file){
 if(typeof file!=='string'||!path.isAbsolute(file))refuse();
 const parent=resolveExternalDir(path.dirname(file));
 const resolved=path.join(parent,path.basename(file));
 boundedFile(resolved,32*1024);
 if(fs.realpathSync.native(file)!==resolved)refuse();
 const st=fs.lstatSync(resolved);
 // POSIX: a recovery private key must not be group/world readable.
 // Windows ACLs are managed by the operator and not certified here.
 if(process.platform!=='win32'&&(st.mode&0o077)!==0)refuse();
 let buf;
 try{buf=fs.readFileSync(resolved);}catch{refuse();}
 return buf;
}
export function verifyPrivateEvidencePairOffline({
 archiveDirectory,recipientPrivateKeyPath
}={}){
 let keyBytes;
 try{
  const pair=readPair(archiveDirectory);
  keyBytes=readPrivateKey(recipientPrivateKeyPath);
  let key;
  try{key=crypto.createPrivateKey(keyBytes);}catch{refuse();}
  if(key.asymmetricKeyType!=='rsa'||
     key.asymmetricKeyDetails?.modulusLength<3072)refuse();
  const fingerprint=crypto.createHash('sha256')
   .update(crypto.createPublicKey(key).export({type:'spki',format:'der'}))
   .digest('hex');
  if(fingerprint!==pair.world.manifest.fingerprint)refuse();
  const check={};
  for(const server of ['world','newbieland']){
   // Pair-envelope metadata alone cannot attest an original GitHub ZIP.
   // Production recovery additionally requires exact original byte pins.
   if(pair[server].manifest.plaintextBytes!==ORIGINAL_ARTIFACT_LENGTH[server]||
      pair[server].manifest.plaintextSha256!==ORIGINAL_ARTIFACT_SHA256[server])refuse();
   let restored;
   try{
    restored=restorePrivateRoadmapEvidenceOffline({
     directory:pair[server].directory,context:context(server),
     recipientPrivateKeyPem:keyBytes
    });
    if(restored.sha256!==ORIGINAL_ARTIFACT_SHA256[server]||
       restored.zipBytes.length!==ORIGINAL_ARTIFACT_LENGTH[server])refuse();
    const original=verifyPinnedOriginalArtifactZip(restored.zipBytes,server);
    if(!original.originalGitHubArtifactBytesMatched||
       original.moduleCount!==82)refuse();
    check[server]=Object.freeze({
     originalZipSha256:restored.sha256,
     moduleCount:original.moduleCount,
     matchedPinnedOriginal:true
    });
   }finally{
    // O63: plaintext needs scrubbing even if a later hash, ZIP, or
    // deployment-receipt verification rejects the restored archive.
    if(restored?.zipBytes)restored.zipBytes.fill(0);
   }
  }
  return Object.freeze({
   checked:check,archivesRecovered:2,recipientKeyMatches:true,
   originalBytesVerified:true,
   originallyArchivedGithubRunAuthenticatedByThisTool:false,
   independentDurableReplicationVerified:false,
   releaseAuthorized:false,mayUploadWorldCode:false,
   mayMergeCandidate:false
  });
 }catch{refuse();}
 finally{if(keyBytes)keyBytes.fill(0);}
}
// No implicit runner path, built-in private key, or ability to turn this
// verification into production deployment or canonical World proof.
export function runPrivatePairVerifyCli(argv){
 if(!Array.isArray(argv)||argv.length!==4||
   argv[0]!=='--archive'||argv[2]!=='--private-key')refuse();
 return verifyPrivateEvidencePairOffline({
  archiveDirectory:argv[1],recipientPrivateKeyPath:argv[3]
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const r=runPrivatePairVerifyCli(process.argv.slice(2));
  // No original module source, private key or signed URL is printed.
  console.log('O61_PRIVATE_EVIDENCE_RECOVERY_VERIFIED '+JSON.stringify({
   originalBytesVerified:r.originalBytesVerified,
   archivesRecovered:r.archivesRecovered,
   independentDurableReplicationVerified:false,
   releaseAuthorized:false
  }));
 }catch{
  console.error(O61_PRIVATE_PAIR_HOLD);
  process.exitCode=2;
 }
}
