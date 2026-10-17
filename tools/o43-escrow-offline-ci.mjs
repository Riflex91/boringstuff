import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeDurableCodeBackup } from './o41-durable-code-backup.mjs';
import {
  rsaRecipientFingerprint,sealRecoverableBackup,
  verifyDownloadedRecoverableBackup,restoreBackupWithOfflinePrivateKey
} from './o43-recoverable-escrow.mjs';

// Exact-HEAD offline Actions witness. This source has no Screeps client,
// game module reads or mutating API calls. All data is synthetic.
const mode=process.argv[2];
if (!['prepare','verify'].includes(mode) ||
    process.env.GITHUB_ACTIONS!=='true' ||
    process.env.GITHUB_REPOSITORY!=='Riflex91/boringstuff' ||
    !process.env.RUNNER_TEMP || !process.env.GITHUB_SHA ||
    !process.env.GITHUB_RUN_ID)
  throw new Error('O43_SYNTHETIC_CI_ONLY');
const root=process.env.RUNNER_TEMP;
const archiveDir=path.join(root,'o43-encrypted-archive');
const downloadedArchiveDir=path.join(root,'o43-downloaded-archive');
const privateDir=path.join(root,'o43-rollback-private');
const secretPath=path.join(root,'o43-private-state.json');
const context={
  repository:process.env.GITHUB_REPOSITORY,commit:process.env.GITHUB_SHA,
  runId:process.env.GITHUB_RUN_ID,server:'world',branch:'chatgpt'
};
const deploymentId='o43-synthetic-'+process.env.GITHUB_RUN_ID;
const original={
  main:'synthetic prior main',config:'synthetic prior config'
};
const expected={
  main:'synthetic updated main',config:'synthetic updated config'
};
for(let i=0;i<80;i++){
  original['module'+i]='O43 synthetic backup module '+i;
  expected['module'+i]='O43 synthetic target module '+i;
}
if(mode==='prepare'){
  if(fs.existsSync(secretPath))throw new Error('O43_ALREADY_PREPARED');
  const pair=crypto.generateKeyPairSync('rsa',{
    modulusLength:3072,
    publicKeyEncoding:{type:'spki',format:'pem'},
    privateKeyEncoding:{type:'pkcs8',format:'pem'}
  });
  const fingerprint=rsaRecipientFingerprint(pair.publicKey);
  const backup=writeDurableCodeBackup({
    directory:privateDir,server:'world',branch:'chatgpt',
    version:'syntheticO43',deploymentId,
    previousReply:{modules:original},expectedModules:expected
  });
  const envelope=sealRecoverableBackup({
    backupFile:backup.file,backupSha256:backup.sha256,
    archiveDir,context,deploymentId,previousModules:original,
    recipientPublicKeyPem:pair.publicKey,recipientFingerprint:fingerprint
  });
  fs.writeFileSync(secretPath,JSON.stringify({
    privateKeyPem:pair.privateKey,publicKeyPem:pair.publicKey,
    fingerprint,ephemeralKeyHex:envelope.ephemeralKeyHex,
    backupFile:backup.file,backupSha256:backup.sha256,
    deploymentId,context
  }),{mode:0o600,flag:'wx'});
  console.log('O43 OFFLINE_RECOVERABLE_ESCROW_PREPARED_ONLY');
}else{
  const state=JSON.parse(fs.readFileSync(secretPath,'utf8'));
  if(JSON.stringify(state.context)!==JSON.stringify(context) ||
      state.deploymentId!==deploymentId)
    throw new Error('O43_RUN_IDENTITY_CHANGED');
  const checked=verifyDownloadedRecoverableBackup({
    ...state,previousModules:original,
    localArchiveDir:archiveDir,downloadedArchiveDir,
    recipientPublicKeyPem:state.publicKeyPem,
    recipientFingerprint:state.fingerprint
  });
  if(!checked.remoteBackupVerified || checked.mayUploadWorldCode)
    throw new Error('O43_VERIFICATION_DID_NOT_HOLD');
  // Simulate losing the ephemeral runner key; restore from encrypted
  // GitHub-hosted download using the independently-held recipient private key.
  const restored=restoreBackupWithOfflinePrivateKey({
    downloadedArchiveDir,context,
    recipientFingerprint:state.fingerprint,
    recipientPrivateKeyPem:state.privateKeyPem
  });
  if(!restored.restoredBytes.equals(fs.readFileSync(state.backupFile)) ||
     restored.originalSha256!==state.backupSha256 ||
     restored.mayUploadWorldCode)
    throw new Error('O43_OFFLINE_RECOVERY_FAILED');
  console.log('O43 GITHUB_REMOTE_DOWNLOAD_AND_OFFLINE_PRIVATE_KEY_RESTORE_PASS');
  if(process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      'O43 exact SHA: encrypted synthetic backup uploaded and independently downloaded; '+
      'RSA-OAEP offline private-key recovery verified. No Screeps credentials, POST or release approval.\n');
}
