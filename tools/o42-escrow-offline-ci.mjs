import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeDurableCodeBackup } from './o41-durable-code-backup.mjs';
import {
  sealBackupForOfflineEscrow, verifyOfflineRemoteEscrow
} from './o42-encrypted-escrow.mjs';

// CI ONLY. Entirely synthetic contents. No ScreepsHttpClient import, no API
// token, no game source, no live code POST, no writeback to deployment receipt.
const mode=process.argv[2];
if (!['prepare','verify'].includes(mode)) throw new Error('O42_OFFLINE_MODE_REQUIRED');
if (process.env.GITHUB_ACTIONS!=='true' || !process.env.RUNNER_TEMP ||
    !process.env.GITHUB_RUN_ID || !process.env.GITHUB_SHA ||
    process.env.GITHUB_REPOSITORY!=='Riflex91/boringstuff')
  throw new Error('O42_OFFLINE_GITHUB_CI_ONLY');
const root=process.env.RUNNER_TEMP;
const localArchiveDir=path.join(root,'o42-encrypted-backup');
const remoteArchiveDir=path.join(root,'o42-remote-download');
const privateDir=path.join(root,'o42-private');
const stateFile=path.join(root,'o42-private-state.json');
const context={
  repository:process.env.GITHUB_REPOSITORY,
  commit:process.env.GITHUB_SHA,
  runId:process.env.GITHUB_RUN_ID,
  server:'world',branch:'chatgpt'
};
const deploymentId='synthetic-o42-'+process.env.GITHUB_RUN_ID;
function originals() {
  const result={
    main:'// SYNTHETIC old main, NOT Screeps code',
    config:'// SYNTHETIC old config, NOT Screeps code'
  };
  for(let i=0;i<80;i++)result['module'+i]='synthetic old '+i;
  return result;
}
function targets() {
  const result={
    main:'// SYNTHETIC target main, NOT Screeps code',
    config:'// SYNTHETIC target config, NOT Screeps code'
  };
  for(let i=0;i<80;i++)result['module'+i]='synthetic target '+i;
  return result;
}
if(mode==='prepare') {
  if(fs.existsSync(stateFile)) throw new Error('O42_ALREADY_PREPARED');
  const previousModules=originals();
  const backup=writeDurableCodeBackup({
    directory:privateDir,server:'world',branch:'chatgpt',
    version:'syntheticO41',deploymentId,
    previousReply:{modules:previousModules},expectedModules:targets()
  });
  const keyHex=crypto.randomBytes(32).toString('hex');
  sealBackupForOfflineEscrow({
    backupFile:backup.file,backupSha256:backup.sha256,
    archiveDir:localArchiveDir,keyHex,context,deploymentId,previousModules
  });
  const state={
    keyHex, backupFile:backup.file,backupSha256:backup.sha256,
    context,deploymentId
  };
  fs.writeFileSync(stateFile,JSON.stringify(state),{flag:'wx',mode:0o600});
  console.log('O42 SYNTHETIC_ENCRYPTED_ESCROW_PREPARED; no game API, no production data');
} else {
  if(!fs.existsSync(stateFile)) throw new Error('O42_PREPARATION_NOT_FOUND');
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(JSON.stringify(state.context)!==JSON.stringify(context) ||
      state.deploymentId!==deploymentId)
    throw new Error('O42_RUN_IDENTITY_CHANGED');
  const result=verifyOfflineRemoteEscrow({
    ...state,previousModules:originals(),
    localArchiveDir,remoteArchiveDir
  });
  if(!result.remoteEncryptedEscrowVerified ||
      result.mayUploadWorldCode || result.releaseAuthorized)
    throw new Error('O42_NO_PRODUCTION_AUTHORIZATION');
  console.log('O42 ENCRYPTED_REMOTE_ARTIFACT_ROUNDTRIP_PASS; production writes still blocked');
  if(process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### O42 offline encrypted escrow round-trip passed\n'+
      'Downloaded encrypted archive bytes and authenticated decrypted 82 synthetic rollback modules matched.\n'+
      '**No Screeps writes, no live credentials, no release authorization.**\n');
  }
}
