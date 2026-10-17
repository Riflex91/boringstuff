import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertRestorablePreuploadCodeBackup }
  from './o39-code-upload-active-branch-policy.mjs';

// Code rollback material is secret operational data. Never log its contents,
// store it in a shared or symlinked directory, or treat an unverified write
// as sufficient reason to attempt the irreversible upload.
const SHA256 = text => crypto.createHash('sha256').update(text).digest('hex');
const fail = () => { throw new Error('CODE_UPLOAD_HOLD_DURABLE_BACKUP_UNVERIFIED'); };

function validateLocation(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail();
  const absolute = path.resolve(directory);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const runner = process.env.RUNNER_TEMP;
    if (!runner || !path.isAbsolute(runner)) fail();
    const relative = path.relative(path.resolve(runner), absolute);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative)) fail();
  }
  return absolute;
}

function assertNoSymlinkPathComponents(target) {
  let current = target;
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) fail();
    } catch (err) {
      if (err?.code !== 'ENOENT') fail();
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertPrivateRegularFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail();
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail();
}

export function verifyDurableCodeBackup({
  file, sha256, server, branch, deploymentId, expectedPriorModules
}) {
  try {
    if (!file || !/^[a-f0-9]{64}$/.test(sha256 || '')) fail();
    assertPrivateRegularFile(file);
    const raw = fs.readFileSync(file, 'utf8');
    if (SHA256(raw) !== sha256) fail();
    const saved = JSON.parse(raw);
    if (saved?.server !== server || saved?.branch !== branch ||
        saved?.deploymentId !== deploymentId ||
        !saved?.capturedAt || !saved?.version ||
        !saved?.modules || !expectedPriorModules) fail();
    const names = Object.keys(expectedPriorModules).sort();
    const actual = Object.keys(saved.modules).sort();
    if (names.length !== 82 || actual.length !== 82 ||
        names.some((name, i) => name !== actual[i] ||
          saved.modules[name] !== expectedPriorModules[name])) fail();
    return Object.freeze({ verified: true, moduleCount: 82, sha256 });
  } catch {
    fail();
  }
}

export function writeDurableCodeBackup({
  directory, server, branch, version, deploymentId, previousReply, expectedModules
}) {
  // Reject malformed replies and invalid names before making a local file.
  assertRestorablePreuploadCodeBackup(previousReply, expectedModules);
  if (!/^(world|newbieland)$/.test(server || '') ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(branch || '') ||
      typeof version !== 'string' || !version || version === 'unknown' ||
      typeof deploymentId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(deploymentId)) fail();

  const dir = validateLocation(directory);
  try {
    // Check ancestors before creating a directory: lexical containment alone
    // is insufficient if a parent component redirects through a symlink.
    assertNoSymlinkPathComponents(dir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    assertNoSymlinkPathComponents(dir);
    if (process.env.GITHUB_ACTIONS === 'true') {
      const runnerReal = fs.realpathSync(process.env.RUNNER_TEMP);
      const actualReal = fs.realpathSync(dir);
      const relativeReal = path.relative(runnerReal, actualReal);
      if (!relativeReal || relativeReal === '..' ||
          relativeReal.startsWith('..' + path.sep) ||
          path.isAbsolute(relativeReal)) fail();
    }
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    // Existing local log directories may have been created with 0755.
    fs.chmodSync(dir, 0o700);
    if (process.platform !== 'win32' && (fs.statSync(dir).mode & 0o077) !== 0) fail();
  } catch {
    fail();
  }
  const record = {
    capturedAt: new Date().toISOString(), server, branch, version,
    deploymentId, modules: previousReply.modules
  };
  const raw = JSON.stringify(record, null, 2) + '\n';
  const sha256 = SHA256(raw);
  const file = path.join(dir,
    'deploy-backup-' + new Date().toISOString().replace(/[:.]/g, '-') +
    '-' + crypto.randomBytes(8).toString('hex') + '.json');
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, raw, 'utf8');
    fs.fsyncSync(fd);
  } catch {
    fail();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  verifyDurableCodeBackup({
    file, sha256, server, branch, deploymentId,
    expectedPriorModules: previousReply.modules
  });
  return Object.freeze({ file, sha256, moduleCount: 82 });
}
