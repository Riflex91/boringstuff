import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeDurableCodeBackup, verifyDurableCodeBackup
} from './o41-durable-code-backup.mjs';

// Local filesystem only, no Screeps API, credentials or game-code writes.
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(),
  'o41-private-backup-'));
const destination = path.join(root, 'backup-private');
const server = 'world', branch = 'chatgpt', deploymentId = '20261017-123';
const expected = {
  main: 'module.exports.loop = () => {};',
  config: 'module.exports = { VERSION: "new" };'
};
const previous = {
  main: 'module.exports.loop = () => { /* previous */ };',
  config: 'module.exports = { VERSION: "old" };'
};
for (let i=0; i<80; i++) {
  expected['module'+i] = 'new code ' + i;
  previous['module'+i] = 'restorable original code ' + i;
}
assert.equal(Object.keys(expected).length, 82);

const write = (previousReply = { modules: previous }, directory = destination) =>
  writeDurableCodeBackup({
    directory, server, branch, version: 'old',
    deploymentId, previousReply, expectedModules: expected
  });
try {
  const backup = write();
  assert.equal(backup.moduleCount, 82);
  assert.match(backup.sha256, /^[a-f0-9]{64}$/);
  assert.equal(path.dirname(backup.file), destination);
  assert.equal(fs.statSync(backup.file).isFile(), true);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(backup.file).mode & 0o077, 0);
    assert.equal(fs.statSync(destination).mode & 0o077, 0);
  }
  const verified = () => verifyDurableCodeBackup({
    file: backup.file, sha256: backup.sha256, server,
    branch, deploymentId, expectedPriorModules: previous
  });
  assert.equal(verified().verified, true);
  assert.equal(verified().moduleCount, 82);
  const saved = JSON.parse(fs.readFileSync(backup.file, 'utf8'));
  assert.equal(saved.modules.main, previous.main);
  assert.notEqual(saved.modules.main, expected.main);

  const another = write();
  assert.notEqual(backup.file, another.file, 'Backup must be nonoverwriting');
  assert.equal(fs.statSync(another.file).isFile(), true);

  // Re-reading and hashing the full on-disk payload is not optional.
  fs.appendFileSync(backup.file, 'tampered');
  assert.throws(verified, /CODE_UPLOAD_HOLD_DURABLE_BACKUP_UNVERIFIED/);

  // Even if an attacker recalculates the digest, changed modules must fail.
  const rogue = { ...saved, modules: { ...saved.modules, main: 'rogue' } };
  const modified = JSON.stringify(rogue, null, 2) + '\n';
  fs.writeFileSync(backup.file, modified, { mode: 0o600 });
  const { createHash } = await import('node:crypto');
  assert.throws(() => verifyDurableCodeBackup({
    file: backup.file,
    sha256: createHash('sha256').update(modified).digest('hex'),
    server, branch, deploymentId, expectedPriorModules: previous
  }), /CODE_UPLOAD_HOLD_DURABLE_BACKUP_UNVERIFIED/);

  if (process.platform !== 'win32') {
    const alias = path.join(destination, 'symlink.json');
    fs.symlinkSync(another.file, alias);
    assert.throws(() => verifyDurableCodeBackup({
      file: alias, sha256: another.sha256, server, branch,
      deploymentId, expectedPriorModules: previous
    }), /CODE_UPLOAD_HOLD_DURABLE_BACKUP_UNVERIFIED/);
    const linkDir = path.join(root, 'linkdir');
    fs.symlinkSync(destination, linkDir);
    assert.throws(() => write({ modules: previous }, linkDir),
      /CODE_UPLOAD_HOLD_DURABLE_BACKUP_UNVERIFIED/);
    fs.chmodSync(another.file, 0o644);
    assert.throws(() => verifyDurableCodeBackup({
      file: another.file, sha256: another.sha256, server, branch,
      deploymentId, expectedPriorModules: previous
    }), /CODE_UPLOAD_HOLD_DURABLE_BACKUP_UNVERIFIED/);
  }
  for (const malformed of [
    null, {}, {modules:{}}, {modules:{...previous, main:''}},
    {modules:{...previous, extra:'x'}},
    {modules:Object.fromEntries(Object.entries(previous)
      .filter(([name])=>name!=='config'))}
  ]) {
    assert.throws(() => write(malformed),
      /CODE_UPLOAD_HOLD_ROLLBACK_BACKUP_UNVERIFIED/);
  }
  assert.throws(() => write({ modules: previous }, 'relative/unsafe'),
    /CODE_UPLOAD_HOLD_DURABLE_BACKUP_UNVERIFIED/);

  // In GitHub Actions, neither the repo workspace nor another runner path
  // may be used as the private preupload backup destination.
  const beforeActions = process.env.GITHUB_ACTIONS;
  const beforeTemp = process.env.RUNNER_TEMP;
  try {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.RUNNER_TEMP = root;
    assert.throws(() => write({ modules: previous }, os.tmpdir()),
      /CODE_UPLOAD_HOLD_DURABLE_BACKUP_UNVERIFIED/);
    assert.throws(() => write({ modules: previous }, root),
      /CODE_UPLOAD_HOLD_DURABLE_BACKUP_UNVERIFIED/);
    assert.equal(write({ modules: previous }, path.join(root, 'approved')).moduleCount, 82);
  } finally {
    if (beforeActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = beforeActions;
    if (beforeTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = beforeTemp;
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uploader = fs.readFileSync(path.join(repo,'tools','deploy-live.mjs'),'utf8');
const b = uploader.indexOf('const backup = writeDurableCodeBackup({');
const lastBranch = uploader.indexOf(
  'assertUniqueActiveCodeBranch(await api.userBranches(), branch)');
const reread = uploader.indexOf('verifyDurableCodeBackup({');
const post = uploader.indexOf('await api.userUploadCodeOnce(branch, modules)');
const receipt = uploader.indexOf('const receipt = writeDeploymentReceipt');
assert.ok(b > 0 && lastBranch > b && reread > lastBranch &&
  post > reread && receipt > post,
  'Persist/readback/last branch check precede the single code POST and receipt');

const worldPreflight=fs.readFileSync(
  path.join(repo,'tools','world-deploy-guard.mjs'),'utf8');
assert.match(worldPreflight,/assertUniqueActiveCodeBranch\(branches,'chatgpt'\)/);
assert.match(worldPreflight,/assertRestorablePreuploadCodeBackup\(code,expected\)/);

for (const [filename, backupDir] of [
  ['screeps-world-deploy.yml','screeps-world-backups'],
  ['screeps-world-next-auto-deploy.yml','screeps-world-backups'],
  ['screeps-auto-deploy.yml','screeps-newbieland-backups']
]) {
  const contents=fs.readFileSync(
    path.join(repo,'.github','workflows',filename),'utf8');
  assert.ok(contents.includes(
    'echo "SCREEPS_BACKUP_DIR=$RUNNER_TEMP/'+backupDir+'" >> "$GITHUB_ENV"'),
    filename+' must configure exact runner-local backup directory');
  assert.ok(contents.includes(
    '${{ runner.temp }}/'+backupDir+'/deploy-backup-*.json'),
    filename+' must archive the exact backup output path');
  assert.ok(!contents.includes('tools/logs/deploy-backup-*.json'));
}
console.log('O41 durable private 82-module backup + disk tampering + workflow archive path: PASS');
