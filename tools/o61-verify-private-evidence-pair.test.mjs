import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ROADMAP_HISTORICAL_ARTIFACTS,
 sealPrivateRoadmapEvidence,restorePrivateRoadmapEvidenceOffline}
 from './o57-private-roadmap-evidence-vault.mjs';
import {inspectPrivateEvidencePair,verifyPrivateEvidencePairOffline,
 runPrivatePairVerifyCli,O61_PRIVATE_PAIR_HOLD}
 from './o61-verify-private-evidence-pair.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'o61-private-archive-pair-'));
const hold=new RegExp(O61_PRIVATE_PAIR_HOLD);
const keys=crypto.generateKeyPairSync('rsa',{
 modulusLength:3072,
 publicKeyEncoding:{type:'spki',format:'pem'},
 privateKeyEncoding:{type:'pkcs8',format:'pem'}
});
const outside=path.join(tmp,'o57-original-evidence-v1');
const keyPath=path.join(tmp,'recovery.private.pem');
const ctx=server=>({repository:'Riflex91/boringstuff',
 ...ROADMAP_HISTORICAL_ARTIFACTS[server]});
const fakeOriginal=server=>Buffer.from('PK\x03\x04SYNTHETIC_'+server+
 '_NEVER_A_GITHUB_ORIGINAL');
try{
 fs.writeFileSync(keyPath,keys.privateKey,{mode:0o600});
 fs.mkdirSync(outside,{mode:0o700});
 const world=sealPrivateRoadmapEvidence({
  zipBytes:fakeOriginal('world'),context:ctx('world'),
  recipientPublicKeyPem:keys.publicKey,
  destination:path.join(outside,'world')
 });
 const newb=sealPrivateRoadmapEvidence({
  zipBytes:fakeOriginal('newbieland'),context:ctx('newbieland'),
  recipientPublicKeyPem:keys.publicKey,
  destination:path.join(outside,'newbieland')
 });
 assert.equal(world.releaseAuthorized,false);
 assert.equal(newb.releaseAuthorized,false);
 const inspected=inspectPrivateEvidencePair({archiveDirectory:outside});
 assert.equal(inspected.archivesPresent,2);
 assert.equal(inspected.matchingRecipientFingerprints,true);
 assert.equal(inspected.independentCiphertextKeysAndNonces,true);
 assert.equal(inspected.authenticatedPlaintextOriginals,false);
 assert.equal(inspected.privateKeyRestorationTested,false);
 assert.equal(inspected.replicatedToIndependentStorage,false);
 assert.equal(inspected.releaseAuthorized,false);
 // A positive synthetic round trip validates *cryptography*, not the
 // authenticated original ZIP-byte fingerprint.
 for(const server of ['world','newbieland']){
  const restored=restorePrivateRoadmapEvidenceOffline({
   directory:path.join(outside,server),context:ctx(server),
   recipientPrivateKeyPem:keys.privateKey
  });
  assert.deepEqual(restored.zipBytes,fakeOriginal(server));
  assert.equal(restored.originalReceiptAuthenticated,false);
  assert.equal(restored.releaseAuthorized,false);
 }
 // Strict O61 recovery must refuse synthetic or relabeled ZIP plaintexts,
 // even if GCM and the recipient RSA key work perfectly.
 assert.throws(()=>verifyPrivateEvidencePairOffline({
  archiveDirectory:outside,recipientPrivateKeyPath:keyPath
 }),hold);
 assert.throws(()=>runPrivatePairVerifyCli([
  '--archive',outside,'--private-key',keyPath
 ]),hold);
 assert.throws(()=>runPrivatePairVerifyCli([
  '--archive',outside,'--private-key',keyPath,'--allow-world-upload','yes'
 ]),hold);
 const script=fileURLToPath(new URL('./o61-verify-private-evidence-pair.mjs',
  import.meta.url));
 const child=spawnSync(process.execPath,[script,
  '--archive',outside,'--private-key',keyPath],
  {encoding:'utf8',timeout:8000,env:{PATH:process.env.PATH||''}});
 assert.equal(child.status,2);
 assert.match(child.stderr,hold);
 assert.equal(child.stdout,'');
 assert.equal(child.stderr.includes('PRIVATE KEY'),false);
 assert.deepEqual(fs.readdirSync(outside).sort(),['newbieland','world']);
 const manifestFile=server=>path.join(outside,server,'archive-manifest.json');
 const edit=(server,callback)=>{
  const file=manifestFile(server),old=fs.readFileSync(file);
  const manifest=JSON.parse(old.toString());
  callback(manifest);
  fs.writeFileSync(file,JSON.stringify(manifest));
  try{
   assert.throws(()=>inspectPrivateEvidencePair({archiveDirectory:outside}),hold);
  }finally{fs.writeFileSync(file,old);}
 };
 edit('newbieland',m=>{m.fingerprint='a'.repeat(64);});
 edit('newbieland',m=>{m.iv=JSON.parse(
  fs.readFileSync(manifestFile('world'),'utf8')).iv;});
 edit('newbieland',m=>{m.wrappedKey=JSON.parse(
  fs.readFileSync(manifestFile('world'),'utf8')).wrappedKey;});
 edit('newbieland',m=>{m.source.commit='a'.repeat(40);});
 edit('world',m=>{m.plaintextBytes=200*1024*1024;});
 const cipher=path.join(outside,'world','archive.enc');
 const origCipher=fs.readFileSync(cipher);
 const manipulated=Buffer.from(origCipher);manipulated[0]^=0xff;
 fs.writeFileSync(cipher,manipulated);
 assert.throws(()=>inspectPrivateEvidencePair({archiveDirectory:outside}),hold);
 fs.writeFileSync(cipher,origCipher);
 assert.equal(inspectPrivateEvidencePair({archiveDirectory:outside})
  .matchingRecipientFingerprints,true);
 // No unexpected siblings, symlink replacements or repo-local fallback.
 const extra=path.join(outside,'unexpected');
 fs.writeFileSync(extra,'bogus');
 assert.throws(()=>inspectPrivateEvidencePair({archiveDirectory:outside}),hold);
 fs.rmSync(extra);
 const originalDir=path.join(outside,'newbieland');
 const movedDir=path.join(tmp,'newb-temporary');
 fs.renameSync(originalDir,movedDir);
 fs.symlinkSync(movedDir,originalDir,'dir');
 assert.throws(()=>inspectPrivateEvidencePair({archiveDirectory:outside}),hold);
 fs.unlinkSync(originalDir);fs.renameSync(movedDir,originalDir);
 assert.throws(()=>inspectPrivateEvidencePair({archiveDirectory:
  path.resolve('tools')}),hold);
 const copiedKey=path.join(tmp,'loose.pem');
 fs.writeFileSync(copiedKey,keys.privateKey,{mode:0o644});
 if(process.platform!=='win32')
  assert.throws(()=>verifyPrivateEvidencePairOffline({
   archiveDirectory:outside,recipientPrivateKeyPath:copiedKey
  }),hold);
 const wrong=crypto.generateKeyPairSync('rsa',{
  modulusLength:3072,
  publicKeyEncoding:{type:'spki',format:'pem'},
  privateKeyEncoding:{type:'pkcs8',format:'pem'}
 });
 fs.writeFileSync(keyPath,wrong.privateKey,{mode:0o600});
 assert.throws(()=>verifyPrivateEvidencePairOffline({
  archiveDirectory:outside,recipientPrivateKeyPath:keyPath
 }),hold);
 assert.equal(inspectPrivateEvidencePair({archiveDirectory:outside})
  .releaseAuthorized,false);
 console.log('O61 offline paired evidence: matching RSA identity, unique nonces, fake ZIP denial, no plaintext/write/key leakage, symlink & tamper HOLD: PASS');
}finally{
 fs.rmSync(tmp,{recursive:true,force:true});
}
