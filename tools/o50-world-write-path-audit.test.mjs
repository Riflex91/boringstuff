import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditWorldWritePaths,classifyWorldWriteSource,
  LEGACY_WORLD_MUTATOR_EXPORTS,WRITE_PATH_CLASSES,MUTATING_WORKFLOW_CLI
} from './o50-world-write-path-audit.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report=auditWorldWritePaths(root);
assert.deepEqual(report.violations,[],
  'Unknown World writer or missing guards detected: '+JSON.stringify(report.violations));
assert.equal(report.guardedLegacyExports,7);
assert.equal(report.classifiedWorldWriterSources.length,8);
assert.equal(report.classifiedWorldWriterWorkflows.length,8);
assert.ok(report.sourceFiles>=20, 'Audit must actually scan non-test production tools');
assert.ok(report.workflowFiles>=25);
assert.ok(report.worldMutationCandidates.length>=6);
assert.equal(Object.keys(LEGACY_WORLD_MUTATOR_EXPORTS).length,6);
assert.equal(Object.keys(WRITE_PATH_CLASSES).length,8);
assert.equal(Object.keys(MUTATING_WORKFLOW_CLI).length,8);

// Regression against future accidental new, unguarded World mutator:
const newSink=classifyWorldWriteSource('world-surprise-upload.mjs',
  "export async function write(api) { return api._request('POST','/api/user/code',{}); }");
assert.ok(newSink.errors.some(x=>x.includes('UNREVIEWED_WORLD_MUTATION_SINK')));
const oldSink=classifyWorldWriteSource('world-next-inactive-restage.mjs',
  "export async function restageInactiveWorldCode(api) { "+
  "await api._request('POST','/api/user/code',{}); }\n"+
  "async function main() { await api._request('POST','/api/user/code',{}); }");
assert.ok(oldSink.errors.some(x=>x.includes('EXPORT_NOT_QUARANTINED')));
assert.ok(oldSink.errors.some(x=>x.includes('MAIN_NOT_QUARANTINED')));
const absentDirect=classifyWorldWriteSource('deploy-live.mjs',
  "await api.userUploadCodeOnce(branch, modules); const api = "+
  "await ScreepsHttpClient.fromConfig(serverName);");
assert.ok(absentDirect.errors.some(x=>x.includes('WORLD_DIRECT_UPLOAD_HOLD')));
const badTransport=classifyWorldWriteSource('screeps-client.mjs',
  "async function _request(){ return https.request('https://screeps.com'); }");
assert.ok(badTransport.errors.some(x=>x.includes('SHARED_HTTP_FIREWALL_MISSING')));
assert.ok(badTransport.errors.some(x=>x.includes('WORLD_WS_COMMAND_FIREWALL_MISSING')));

// The reporter contains bounded paths/counts only; not credentials, source,
// world code, raw request bodies, or deployment receipts.
console.log('O50 World write-path audit: PASS '+JSON.stringify({
  sourceFiles:report.sourceFiles,workflowFiles:report.workflowFiles,
  classifiedSources:report.classifiedWorldWriterSources.length,
  classifiedWorkflows:report.classifiedWorldWriterWorkflows.length,
  legacyExportHolds:report.guardedLegacyExports,
  mutationCandidates:report.worldMutationCandidates.length,
  violations:report.violations.length
}));
