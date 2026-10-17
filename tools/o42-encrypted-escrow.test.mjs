import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeDurableCodeBackup } from './o41-durable-code-backup.mjs';
import {
  sealBackupForOfflineEscrow, verifyOfflineRemoteEscrow
} from './o42-encrypted-escrow.mjs';

// Only synthetic module content and local filesystem tests. Never the live
// account/game/ backup or a Screeps credential.
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(),
  'screeps-o42-escrow-'));
const destination=path.join(root,'private'),local=path.join(root,'encrypted'),
  remote=path.join(root,'downloaded');
const context={
  repository:'Riflex91/boringstuff',commit:'a'.repeat(40),runId:'123456789',
  server:'world',branch:'chatgpt'
};
const deploymentId='synthetic-offline-1234';
const keyHex=crypto.randomBytes(32).toString('hex');
const expected={main:'module.exports.loop=()=>{};',
  config:'module.exports={VERSION:"O42"};'};
const original={main:'module.exports.loop=()=>{return 1;};',
  config:'module.exports={VERSION:"O41"};'};
for(let i=0;i<80;i++){
  expected['mod'+i]='new mock source '+i;
  original['mod'+i]='old synthetic rollback '+i;
}
try {
  const backup=writeDurableCodeBackup({
    directory:destination,server:context.server,branch:context.branch,
    version:'O41',deploymentId,previousReply:{modules:original},
    expectedModules:expected
  });
  const args={backupFile:backup.file,backupSha256:backup.sha256,keyHex,
    context,deploymentId,previousModules:original};
  const denial=sealBackupForOfflineEscrow({...args,archiveDir:local});
  assert.equal(denial.mayUploadWorldCode,false);
  assert.equal(denial.remoteEncryptedEscrowVerified,false);
  assert.deepEqual(fs.readdirSync(local).sort(),
    ['backup.enc','escrow-envelope.json']);
  const source=fs.readFileSync(backup.file);
  const ciphertext=fs.readFileSync(path.join(local,'backup.enc'));
  assert.equal(ciphertext.includes(source),false,
    'Encrypted public artifact must not contain raw rollback source');
  const manifest=fs.readFileSync(path.join(local,'escrow-envelope.json'),'utf8');
  assert.ok(!manifest.includes(deploymentId));
  assert.ok(!manifest.includes(original.main));
  assert.ok(!manifest.includes(keyHex));

  fs.mkdirSync(remote);
  for(const name of fs.readdirSync(local))
    fs.copyFileSync(path.join(local,name),path.join(remote,name));
  const inspect=()=>verifyOfflineRemoteEscrow({
    ...args,localArchiveDir:local,remoteArchiveDir:remote
  });
  const pass=inspect();
  assert.deepEqual(pass,{
    remoteEncryptedEscrowVerified:true,
    mayUploadWorldCode:false,mayRetryCodePost:false,
    mayWriteDeploymentReceipt:false,mayMergeCandidate:false,
    releaseAuthorized:false,canonicalLive100tPass:false,
    requiresSeparateApprovedProductionIntegration:true
  });

  const evil=path.join(remote,'backup.enc');
  fs.appendFileSync(evil,Buffer.from([123]));
  assert.throws(inspect,/O42_ESCROW_HOLD_/);
  fs.copyFileSync(path.join(local,'backup.enc'),evil);
  const wrongCtx={...context,runId:'234567891'};
  assert.throws(()=>verifyOfflineRemoteEscrow({
    ...args,context:wrongCtx,localArchiveDir:local,remoteArchiveDir:remote
  }),/O42_ESCROW_HOLD_/);
  assert.throws(()=>verifyOfflineRemoteEscrow({
    ...args,keyHex:crypto.randomBytes(32).toString('hex'),
    localArchiveDir:local,remoteArchiveDir:remote
  }),/O42_ESCROW_HOLD_/);
  assert.throws(()=>verifyOfflineRemoteEscrow({
    ...args,backupSha256:'b'.repeat(64),
    localArchiveDir:local,remoteArchiveDir:remote
  }),/O42_ESCROW_HOLD_/);
  assert.throws(()=>verifyOfflineRemoteEscrow({
    ...args,previousModules:{...original,main:'swapped'},
    localArchiveDir:local,remoteArchiveDir:remote
  }),/O42_ESCROW_HOLD_/);
  assert.throws(()=>verifyOfflineRemoteEscrow({
    ...args,localArchiveDir:local,remoteArchiveDir:local
  }),/O42_ESCROW_HOLD_REMOTE_NOT_INDEPENDENT/);
  fs.writeFileSync(path.join(remote,'extra'),'injected');
  assert.throws(inspect,/O42_ESCROW_HOLD_UNEXPECTED_ARCHIVE_CONTENTS/);
  fs.unlinkSync(path.join(remote,'extra'));
  fs.unlinkSync(path.join(remote,'escrow-envelope.json'));
  assert.throws(inspect,/O42_ESCROW_HOLD_UNEXPECTED_ARCHIVE_CONTENTS/);
  fs.copyFileSync(path.join(local,'escrow-envelope.json'),
    path.join(remote,'escrow-envelope.json'));
  if(process.platform!=='win32'){
    fs.unlinkSync(path.join(remote,'backup.enc'));
    fs.symlinkSync(path.join(local,'backup.enc'),
      path.join(remote,'backup.enc'));
    assert.throws(inspect,/O42_ESCROW_HOLD_/);
  }
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
console.log('O42 encrypted synthetic escrow, tampering, missing archive and no-upload gate: PASS');
