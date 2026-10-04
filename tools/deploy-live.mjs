import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScreepsHttpClient } from './screeps-client-node18.mjs';
import { DEFAULT_VERIFICATION_LOG_DIR, writeDeploymentReceipt } from './deployment-receipt.mjs';

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
console.log('Deployment ID:      ' + deploymentId);

const api = await ScreepsHttpClient.fromConfig(serverName);

let activeWorld = null;
try {
  const branches = await api.userBranches();
  const list = Array.isArray(branches?.list) ? branches.list : [];
  const info = list.find(entry => entry?.branch === branch);
  if (typeof info?.activeWorld === 'boolean') activeWorld = info.activeWorld;
  else if (typeof branches?.activeWorld === 'string') activeWorld = branches.activeWorld === branch;
} catch (err) {
  console.warn('Branch activity check skipped: ' + err.message);
}

if (activeWorld !== null) {
  console.log('Branch activeWorld:' + (activeWorld ? ' true' : ' false'));
}

const before = await api._request('GET', '/api/user/code', { branch });
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
  'utf8'
);
console.log('Backup written:    ' + backupPath);

await api._request('POST', '/api/user/code', { branch, modules });
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

if (activeWorld === false) {
  console.warn(
    "WARNING: branch '" + branch +
    "' is not activeWorld. Upload succeeded, but the world may execute another branch."
  );
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
