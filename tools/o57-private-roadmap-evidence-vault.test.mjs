import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
 ROADMAP_HISTORICAL_ARTIFACTS,sealPrivateRoadmapEvidence,
 inspectPrivateRoadmapArchive,restorePrivateRoadmapEvidenceOffline,
 inspectHistoricalArtifactRetention
} from './o57-private-roadmap-evidence-vault.mjs';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'o57-private-evidence-'));
try{
 const keypair=crypto.generateKeyPairSync('rsa',{
  modulusLength:3072,
  publicKeyEncoding:{format:'pem',type:'spki'},
  privateKeyEncoding:{format:'pem',type:'pkcs8'}
 });
 const context={repository:'Riflex91/boringstuff',
  ...ROADMAP_HISTORICAL_ARTIFACTS.world};
 // Arbitrary bytes simulate an ALREADY downloaded original artifact. This
 // test makes NO claim the synthetic data is an actual Actions ZIP/receipt.
 const zip=Buffer.from('SYNTHETIC_ARCHIVE_BYTES_NEVER_AN_ORIGINAL_RECEIPT');
 const dir=path.join(temp,'sealed-archive');
 const result=sealPrivateRoadmapEvidence({
  zipBytes:zip,context,recipientPublicKeyPem:keypair.publicKey,
  destination:dir});
 assert.equal(result.releaseAuthorized,false);
 assert.equal(result.durableRemoteStorageVerified,false);
 assert.equal(result.originalReceiptAuthenticated,false);
 assert.deepEqual(fs.readdirSync(dir).sort(),
  ['archive-manifest.json','archive.enc']);
 assert.equal(fs.readFileSync(path.join(dir,'archive.enc')).includes(zip),false);
 const check=inspectPrivateRoadmapArchive({directory:dir,context});
 assert.equal(check.manifest.format,'O57_PRIVATE_EVIDENCE_V1');
 assert.equal(check.manifest.releaseAuthorized,false);
 const restored=restorePrivateRoadmapEvidenceOffline({
  directory:dir,context,recipientPrivateKeyPem:keypair.privateKey});
 assert.deepEqual(restored.zipBytes,zip);
 assert.equal(restored.releaseAuthorized,false);
 assert.equal(restored.originalReceiptAuthenticated,false);
 assert.throws(()=>sealPrivateRoadmapEvidence({
  zipBytes:zip,context,recipientPublicKeyPem:keypair.publicKey,destination:dir
 }),/O57_EVIDENCE_VAULT_HOLD_/);
 const wrongContext={...context,commit:'a'.repeat(40)};
 assert.throws(()=>inspectPrivateRoadmapArchive({directory:dir,
  context:wrongContext}),/O57_EVIDENCE_VAULT_HOLD_/);
 const other=crypto.generateKeyPairSync('rsa',{
  modulusLength:3072,
  publicKeyEncoding:{format:'pem',type:'spki'},
  privateKeyEncoding:{format:'pem',type:'pkcs8'}
 });
 assert.throws(()=>restorePrivateRoadmapEvidenceOffline({
  directory:dir,context,recipientPrivateKeyPem:other.privateKey}),
  /O57_EVIDENCE_VAULT_HOLD_/);
 const manifestPath=path.join(dir,'archive-manifest.json');
 const originalManifest=fs.readFileSync(manifestPath);
 const manifest=JSON.parse(originalManifest.toString());
 manifest.source.commit='a'.repeat(40);
 fs.writeFileSync(manifestPath,JSON.stringify(manifest));
 assert.throws(()=>inspectPrivateRoadmapArchive({directory:dir,context}),
  /O57_EVIDENCE_VAULT_HOLD_/);
 fs.writeFileSync(manifestPath,originalManifest);
 const cipherPath=path.join(dir,'archive.enc');
 const originalCipher=fs.readFileSync(cipherPath);
 const altered=Buffer.from(originalCipher);
 altered[0]^=1;
 fs.writeFileSync(cipherPath,altered);
 assert.throws(()=>inspectPrivateRoadmapArchive({directory:dir,context}),
  /O57_EVIDENCE_VAULT_HOLD_/);
 fs.writeFileSync(cipherPath,originalCipher);
 assert.equal(inspectPrivateRoadmapArchive({directory:dir,context}).manifest.ciphertextBytes,
  originalCipher.length);
 assert.throws(()=>sealPrivateRoadmapEvidence({
  zipBytes:Buffer.alloc(0),context,
  recipientPublicKeyPem:keypair.publicKey,
  destination:path.join(temp,'empty')
 }),/O57_EVIDENCE_VAULT_HOLD_/);
 const expired=inspectHistoricalArtifactRetention(new Date('2026-10-31T00:00:00Z'));
 assert.equal(expired.length,2);
 assert.ok(expired.every(x=>x.alreadyExpired&&x.storageVerified===false));
 const current=inspectHistoricalArtifactRetention(new Date('2026-10-17T00:00:00Z'));
 assert.ok(current.every(x=>!x.alreadyExpired));
 // Never archive artifact source bytes into source control or claim remote
 // durability based on a runner-local encrypted file.
 console.log('O57 private archive encryption, offline RSA restore, tamper and historical expiry: PASS');
}finally{
 fs.rmSync(temp,{recursive:true,force:true});
}
