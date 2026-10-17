import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  rsaRecipientFingerprint, restoreBackupWithOfflinePrivateKey
} from './o43-recoverable-escrow.mjs';
import {
  prepareTwoPhaseWorldEscrow, verifyTwoPhaseWorldPrePostGate
} from './o43-two-phase-world-gate.mjs';

// Every byte below is synthetic. No Screeps service is contacted.
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP||os.tmpdir(),
  'o43-prepost-test-'));
const local=path.join(root,'encrypted');
const remote=path.join(root,'independent-remote-download');
const backupDirectory=path.join(root,'private-backup');
const keys=crypto.generateKeyPairSync('rsa',{
  modulusLength:3072,
  publicKeyEncoding:{type:'spki',format:'pem'},
  privateKeyEncoding:{type:'pkcs8',format:'pem'}
});
const pin=rsaRecipientFingerprint(keys.publicKey);
const context={
  repository:'Riflex91/boringstuff',commit:'a'.repeat(40),
  runId:'39049999001',server:'world',branch:'chatgpt'
};
const originals={
  main:'synthetic previous main',config:"module.exports={VERSION:'original'};"
};
const target={
  main:'synthetic target main',config:"module.exports={VERSION:'target'};"
};
for(let i=0;i<80;i++){
  originals['mod'+i]='previous mock module '+i;
  target['mod'+i]='updated mock module '+i;
}
const state={account:'fixture-id',status:'normal',active:'chatgpt',modules:originals};
const calls=[];
const api={
  token:'local-fixture',
  async _request(method,endpoint,params,options){
    calls.push([method,endpoint,options]);
    assert.equal(method,'GET','No Screeps mutation permitted from O43');
    assert.equal(options?.retryAuth,false);
    if(endpoint==='/api/auth/me')return {_id:state.account,ok:1};
    if(endpoint==='/api/user/world-status')return {status:state.status,ok:1};
    if(endpoint==='/api/user/branches')return {list:[
      {branch:'chatgpt',activeWorld:state.active==='chatgpt'},
      {branch:'default',activeWorld:state.active==='default'}]};
    if(endpoint==='/api/user/code')return {modules:{...state.modules}};
    throw new Error('Unexpected read '+endpoint);
  }
};
try {
  assert.match(pin,/^[a-f0-9]{64}$/);
  const prepared=await prepareTwoPhaseWorldEscrow({
    api,context,targetModules:target,backupDirectory,
    archiveDirectory:local,deploymentId:'o43-fixture-1',
    recipientPublicKeyPem:keys.publicKey,recipientFingerprint:pin,
    version:'synthetic'
  });
  assert.equal(prepared.mayUploadWorldCode,false);
  assert.equal(prepared.stage,'WAIT_FOR_VERIFIED_REMOTE_ESCROW');
  assert.equal(calls.length,4);
  const envelopeText=fs.readFileSync(path.join(local,'escrow-envelope.json'),'utf8');
  assert.ok(!envelopeText.includes(keys.privateKey));
  assert.ok(!envelopeText.includes(prepared.ephemeralKeyHex));
  assert.ok(!envelopeText.includes(originals.main));
  assert.ok(!envelopeText.includes(prepared.deploymentId));
  assert.match(envelopeText,/wrappedKey/);
  const ciphertext=fs.readFileSync(path.join(local,'backup.enc'));
  assert.ok(!ciphertext.toString('utf8').includes(originals.main));

  await assert.rejects(()=>verifyTwoPhaseWorldPrePostGate({
    api,prepared,targetModules:target,localArchiveDir:local,
    downloadedArchiveDir:remote,recipientPublicKeyPem:keys.publicKey,
    recipientFingerprint:pin
  }),/O43_RECOVERABLE_ESCROW_HOLD_/,'No remote downloaded copy must block');

  fs.mkdirSync(remote);
  for(const file of fs.readdirSync(local))fs.copyFileSync(
    path.join(local,file),path.join(remote,file));
  const args={api,prepared,targetModules:target,localArchiveDir:local,
    downloadedArchiveDir:remote,recipientPublicKeyPem:keys.publicKey,
    recipientFingerprint:pin};
  const decision=await verifyTwoPhaseWorldPrePostGate(args);
  assert.equal(decision.stage,'REMOTE_ESCROW_AND_GETS_VERIFIED_NO_WRITE');
  assert.equal(decision.mayUploadWorldCode,false);
  assert.equal(decision.releaseAuthorized,false);
  assert.equal(decision.mayWriteDeploymentReceipt,false);
  assert.equal(calls.length,8);
  // Simulate losing the ephemeral runner key: ONLY the offline operator's
  // private RSA key restores the encrypted backup directly from the artifact.
  const recovered=restoreBackupWithOfflinePrivateKey({
    downloadedArchiveDir:remote,context,recipientFingerprint:pin,
    recipientPrivateKeyPem:keys.privateKey
  });
  assert.equal(recovered.mayUploadWorldCode,false);
  assert.equal(recovered.originalSha256,prepared.backupSha256);
  assert.ok(recovered.restoredBytes.equals(fs.readFileSync(prepared.backupFile)));
  const wrongPrivate=crypto.generateKeyPairSync('rsa',{
    modulusLength:3072,
    publicKeyEncoding:{type:'spki',format:'pem'},
    privateKeyEncoding:{type:'pkcs8',format:'pem'}
  });
  assert.throws(()=>restoreBackupWithOfflinePrivateKey({
    downloadedArchiveDir:remote,context,recipientFingerprint:pin,
    recipientPrivateKeyPem:wrongPrivate.privateKey
  }),/O43_RECOVERABLE_ESCROW_HOLD_/);

  state.active='default';
  await assert.rejects(()=>verifyTwoPhaseWorldPrePostGate(args),
    /O43_TWO_PHASE_HOLD_ACTIVE_WORLD_BRANCH_CHANGED/);
  state.active='chatgpt';
  state.modules={...originals,main:'external writer changed live code'};
  await assert.rejects(()=>verifyTwoPhaseWorldPrePostGate(args),
    /O43_TWO_PHASE_HOLD_SERVER_CODE_CHANGED_OR_INCOMPLETE/);
  state.modules=originals;
  state.account='swapped-account';
  await assert.rejects(()=>verifyTwoPhaseWorldPrePostGate(args),
    /O43_TWO_PHASE_HOLD_ACCOUNT_CHANGED/);
  state.account='fixture-id';
  state.status='lost';
  await assert.rejects(()=>verifyTwoPhaseWorldPrePostGate(args),
    /O43_TWO_PHASE_HOLD_WORLD_STATUS_NOT_NORMAL/);
  state.status='normal';
  fs.appendFileSync(path.join(remote,'backup.enc'),'malicious');
  await assert.rejects(()=>verifyTwoPhaseWorldPrePostGate(args),
    /O43_RECOVERABLE_ESCROW_HOLD_REMOTE_BYTES_CHANGED/);
  assert.equal(calls.every(c=>c[0]==='GET'),true);
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
console.log('O43 recoverable RSA escrow and two-stage World GET-only no-write gates: PASS');
