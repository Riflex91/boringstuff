import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertPrivateArchiveDirectory,assertPrivateArchiveFiles}
 from './o63-private-vault-file-policy.mjs';

// O57 private EVIDENCE vault. NOT a production escrow receipt, NOT a
// GitHub upload and NEVER a source of release authorization. A real backup
// still requires an independently chosen private, durable storage location.
const HOLD='O57_EVIDENCE_VAULT_HOLD_';
const die=x=>{throw new Error(HOLD+x);};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const good=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
export const ROADMAP_HISTORICAL_ARTIFACTS=Object.freeze({
 world:Object.freeze({server:'world',runId:'38808493499',
  artifactId:'12007967018',commit:'3f14590592d30dded0b6f61ab0e301e475ed6bf3',
  expiresAt:'2026-10-29T21:26:02Z'}),
 newbieland:Object.freeze({server:'newbieland',runId:'38848802082',
  artifactId:'12024822115',commit:'bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c',
  expiresAt:'2026-10-30T04:16:49Z'})
});
function verifiedContext(context) {
 if(context?.repository!=='Riflex91/boringstuff'||
   !['world','newbieland'].includes(context?.server)||
   !/^[0-9]{8,15}$/.test(context.runId||'')||
   !/^[0-9]{8,15}$/.test(context.artifactId||'')||
   !sha40(context.commit)||typeof context.expiresAt!=='string'||
   !Number.isFinite(Date.parse(context.expiresAt)))die('CONTEXT');
 const pinned=ROADMAP_HISTORICAL_ARTIFACTS[context.server];
 if(Object.entries(pinned).some(([key,value])=>context[key]!==value))
   die('ORIGINAL_SOURCE_NOT_PINNED');
 return Object.freeze({...pinned,repository:'Riflex91/boringstuff'});
}
function publicKey(pem){
 let key;
 try{key=crypto.createPublicKey(pem);}catch{die('RSA_PUBLIC_KEY');}
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<3072)
   die('RSA_PUBLIC_KEY');
 return key;
}
function privateDir(directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||
   fs.existsSync(directory))die('DIRECTORY_ALREADY_EXISTS_OR_RELATIVE');
 // O63: a direct library caller cannot bypass O62's CLI path gate.
 // The parent must be a private, current-UID, non-Git directory.
 try{assertPrivateArchiveDirectory(path.dirname(directory));}
 catch{die('PRIVATE_PARENT');}
 fs.mkdirSync(directory,{recursive:false,mode:0o700});
 if(process.platform!=='win32')fs.chmodSync(directory,0o700);
 return directory;
}
function freshWrite(directory,name,bytes){
 const file=path.join(directory,name);
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export function sealPrivateRoadmapEvidence({
 zipBytes,context,recipientPublicKeyPem,destination
}){
 const ctx=verifiedContext(context);
 if(!Buffer.isBuffer(zipBytes)||zipBytes.length<1||zipBytes.length>32*1024*1024)
   die('ZIP_BYTES');
 // A hash is not verification that the original ZIP is authentic; that
 // requires original artifact metadata and independent signature/receipts.
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
 const recipient=publicKey(recipientPublicKeyPem);
 const fingerprint=sha(recipient.export({type:'spki',format:'der'}));
 const plaintextSha256=sha(zipBytes);
 const aad=Buffer.from(JSON.stringify({ctx,plaintextSha256,fingerprint}));
 const enc=crypto.createCipheriv('aes-256-gcm',key,iv);
 enc.setAAD(aad);
 const body=Buffer.concat([enc.update(zipBytes),enc.final()]);
 let wrappedKey;
 try{
   wrappedKey=crypto.publicEncrypt({
     key:recipient,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
     oaepHash:'sha256'},key).toString('base64');
 }finally{
   // O63: the temporary AES content-encryption key must not linger in
   // caller-visible JS memory after producing its recipient-only wrap.
   key.fill(0);
 }
 const manifest={
   format:'O57_PRIVATE_EVIDENCE_V1',source:ctx,fingerprint,
   plaintextSha256,plaintextBytes:zipBytes.length,
   ciphertextSha256:sha(body),ciphertextBytes:body.length,
   iv:iv.toString('hex'),tag:enc.getAuthTag().toString('hex'),
   wrappedKey,
   originalReceiptAuthenticated:false,
   durableRemoteStorageVerified:false,
   releaseAuthorized:false
 };
 const dir=privateDir(destination);
 try{
   freshWrite(dir,'archive.enc',body);
   freshWrite(dir,'archive-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
 }catch{die('PRIVATE_WRITE_FAILED');}
 return Object.freeze({directory:dir,manifestSha256:sha(Buffer.from(JSON.stringify(manifest,null,2)+'\n')),
   ciphertextSha256:manifest.ciphertextSha256,originalReceiptAuthenticated:false,
   durableRemoteStorageVerified:false,releaseAuthorized:false});
}
function file(dir,name){
 const pathName=path.join(dir,name),stat=fs.lstatSync(pathName);
 if(!stat.isFile()||stat.isSymbolicLink())die('UNSAFE_FILE');
 return fs.readFileSync(pathName);
}
export function inspectPrivateRoadmapArchive({directory,context}){
 const ctx=verifiedContext(context);
 if(typeof directory!=='string'||!path.isAbsolute(directory))die('DIRECTORY');
 const stat=fs.lstatSync(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink())die('DIRECTORY');
 try{assertPrivateArchiveFiles(directory);}
 catch{die('PRIVATE_FILE_POLICY');}
 if(JSON.stringify(fs.readdirSync(directory).sort())!==
   JSON.stringify(['archive-manifest.json','archive.enc']))die('INVENTORY');
 let manifest;
 try{manifest=JSON.parse(file(directory,'archive-manifest.json').toString('utf8'));}
 catch{die('MANIFEST_JSON');}
 const payload=file(directory,'archive.enc');
 if(manifest?.format!=='O57_PRIVATE_EVIDENCE_V1'||
   JSON.stringify(manifest.source)!==JSON.stringify(ctx)||
   !good(manifest.plaintextSha256)||!good(manifest.ciphertextSha256)||
   manifest.ciphertextSha256!==sha(payload)||
   !Number.isInteger(manifest.plaintextBytes)||manifest.plaintextBytes<1||
   manifest.plaintextBytes>32*1024*1024||
   manifest.ciphertextBytes!==payload.length||
   !good(manifest.fingerprint)||
   !/^[a-f0-9]{24}$/.test(manifest.iv||'')||
   !/^[a-f0-9]{32}$/.test(manifest.tag||'')||
   typeof manifest.wrappedKey!=='string'||
   manifest.originalReceiptAuthenticated!==false||
   manifest.durableRemoteStorageVerified!==false||
   manifest.releaseAuthorized!==false)die('MANIFEST_INTEGRITY');
 return {manifest,payload,ctx};
}
export function restorePrivateRoadmapEvidenceOffline({
 directory,context,recipientPrivateKeyPem
}){
 const {manifest,payload,ctx}=inspectPrivateRoadmapArchive({directory,context});
 let secret,plain;
 try{
   secret=crypto.privateDecrypt({
     key:recipientPrivateKeyPem,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
     oaepHash:'sha256'
   },Buffer.from(manifest.wrappedKey,'base64'));
   if(secret.length!==32)die('KEY_LENGTH');
   const dec=crypto.createDecipheriv('aes-256-gcm',secret,
     Buffer.from(manifest.iv,'hex'));
   dec.setAAD(Buffer.from(JSON.stringify({
     ctx,plaintextSha256:manifest.plaintextSha256,fingerprint:manifest.fingerprint
   })));
   dec.setAuthTag(Buffer.from(manifest.tag,'hex'));
   plain=Buffer.concat([dec.update(payload),dec.final()]);
 }catch{
   if(plain)plain.fill(0);
   die('RECOVERY_KEY_OR_AUTH_TAG');
 }finally{
   // O63: never leave the RSA-unwrapped AES secret resident after an
   // authenticated restore, a wrong key, or a malformed GCM tag.
   if(secret)secret.fill(0);
 }
 if(plain.length!==manifest.plaintextBytes||sha(plain)!==manifest.plaintextSha256){
   plain.fill(0);
   die('RESTORED_BYTES');
 }
 return {zipBytes:plain,sha256:sha(plain),
   releaseAuthorized:false,remoteStored:false,originalReceiptAuthenticated:false};
}
export function inspectHistoricalArtifactRetention(now=new Date()){
 const clock=now instanceof Date?now.getTime():Number.NaN;
 if(!Number.isFinite(clock))die('CLOCK');
 return Object.values(ROADMAP_HISTORICAL_ARTIFACTS).map(x=>Object.freeze({
   server:x.server,artifactId:x.artifactId,runId:x.runId,
   expiresAt:x.expiresAt,alreadyExpired:clock>=Date.parse(x.expiresAt),
   storageVerified:false
 }));
}
