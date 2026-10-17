import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { DEFAULT_VERIFICATION_LOG_DIR, writeDeploymentReceipt } from './deployment-receipt.mjs';
import { assertUniqueActiveCodeBranch, assertRestorablePreuploadCodeBackup } from './o39-code-upload-active-branch-policy.mjs';
import { reconcileUncertainCodePostViaGet } from './o40-code-post-get-reconcile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const parent = path.resolve(here, '..');
const runtimeCandidates = [
  parent,
  path.join(parent, 'game')
];
const runtimeDir = runtimeCandidates.find(dir =>
  fs.existsSync(path.join(dir, 'main.js')) &&
  fs.existsSync(path.join(dir, 'config.js'))
);

if (!runtimeDir) {
  throw new Error(
    'Could not locate Screeps runtime. Checked: ' +
    runtimeCandidates.join(', ')
  );
}

const serverName = process.env.SCREEPS_SERVER || 'newbieland';
const branch = process.env.SCREEPS_BRANCH || 'chatgpt';

function extractVersion(source) {
  const match = String(source || '').match(/VERSION\s*:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : 'unknown';
}

const files = fs.readdirSync(runtimeDir)
  .filter(name => name.endsWith('.js'))
  .sort();

const modules = {};
for (const file of files) {
  modules[file.slice(0, -3)] = fs.readFileSync(path.join(runtimeDir, file), 'utf8');
}

const expectedVersion = extractVersion(modules.config);
if (expectedVersion === 'unknown') {
  throw new Error('Could not determine local VERSION from config.js');
}
const deploymentId = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + process.pid;
if (!/module\.exports\s*=\s*\{/.test(modules.config)) {
  throw new Error('Could not inject DEPLOYMENT_ID into config.js');
}
modules.config = modules.config.replace(
  /module\.exports\s*=\s*\{/,
  match => match + "\n  DEPLOYMENT_ID: '" + deploymentId + "',"
);

console.log('Server:            ' + serverName);
console.log('Branch:            ' + branch);
console.log('Runtime directory: ' + runtimeDir);
console.log('Runtime modules:   ' + files.length);
console.log('Local version:     ' + expectedVersion);
console.log('Deployment ID:     ' + deploymentId);

const api = await ScreepsHttpClient.fromConfig(serverName);

// Reject missing, ambiguous or wrong active code branches BEFORE backing up
// or making the single permitted code POST. A prior CI preflight is insufficient
// because account branch activation may change between CI steps.
const branches = await api.userBranches();
assertUniqueActiveCodeBranch(branches, branch);
console.log('Branch activeWorld: true');

const before = await api._request('GET', '/api/user/code', { branch });
assertRestorablePreuploadCodeBackup(before, modules);
const beforeVersion = extractVersion(before?.modules?.config);
console.log('Server before:     ' + beforeVersion);

const packageRoot = runtimeDir.endsWith(path.sep + 'game')
  ? path.dirname(runtimeDir)
  : runtimeDir;
const logsDir = path.join(packageRoot, 'logs');
fs.mkdirSync(logsDir, { recursive: true });
const backupPath = path.join(
  logsDir,
  'deploy-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
);
fs.writeFileSync(
  backupPath,
  JSON.stringify({
    capturedAt: new Date().toISOString(),
    server: serverName,
    branch,
    version: beforeVersion,
    deploymentId,
    modules: before?.modules || {}
  }, null, 2),
  { encoding: 'utf8', mode: 0o600, flag: 'wx' }
);
console.log('Backup written:    ' + backupPath);

// A missing HTTP acknowledgement is an UNKNOWN result. Never implicitly
// retry this code POST: the API may already have committed the upload.
// Active branch may change after initial preflight or backup capture.
assertUniqueActiveCodeBranch(await api.userBranches(), branch);
try {
  await api.userUploadCodeOnce(branch, modules);
} catch {
  // The server might have applied the POST before the acknowledgement was
  // lost. Inspect only via authenticated GET; even exact bytes do not replace
  // the missing POST acknowledgement or a canonical 100-tick release witness.
  const diagnostic = await reconcileUncertainCodePostViaGet(api, branch, modules);
  console.error('CODE_POST_OUTCOME_UNCERTAIN ' + JSON.stringify(diagnostic));
  throw new Error('CODE_POST_OUTCOME_UNCERTAIN_NO_RETRY_NO_RECEIPT');
}
console.log('Upload completed.');

const after = await api._request('GET', '/api/user/code', { branch });
const afterVersion = extractVersion(after?.modules?.config);
console.log('Server after:      ' + afterVersion);

if (afterVersion !== expectedVersion) {
  throw new Error(
    'Verification failed: expected ' + expectedVersion +
    ', server returned ' + afterVersion
  );
}

const uploadedNames = Object.keys(after?.modules || {});
const missing = Object.keys(modules).filter(name => !uploadedNames.includes(name));
if (missing.length) {
  throw new Error('Verification failed: missing uploaded modules: ' + missing.join(', '));
}

// Identical VERSION strings can span multiple development commits. Checking
// module names is insufficient: verify the *exact bytes* of each uploaded
// module (including the unique injected deployment ID).
const mismatches = Object.keys(modules).filter(name =>
  after.modules[name] !== modules[name]
);
if (mismatches.length) {
  throw new Error('Verification failed: uploaded module content differs for: ' +
    mismatches.join(', '));
}

if (!String(after?.modules?.config || '').includes("DEPLOYMENT_ID: '" + deploymentId + "'")) {
  throw new Error('Verification failed: server config does not contain deployment ID ' + deploymentId);
}

const verificationLogDir = process.env.SCREEPS_LOG_DIR || DEFAULT_VERIFICATION_LOG_DIR;
const receipt = writeDeploymentReceipt({
  logDir: verificationLogDir,
  server: serverName,
  branch,
  version: expectedVersion,
  deploymentId
});

console.log('Server-side deployment verification passed.');
console.log('Deployment receipt: ' + receipt.file);
console.log('Deployment marker will be emitted by the first runtime tick: ' + deploymentId);
