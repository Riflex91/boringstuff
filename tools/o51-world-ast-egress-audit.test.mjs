import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectWorldAstSource,auditWorldAstRepo}
  from './o51-world-ast-egress-audit.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report=auditWorldAstRepo(root);
assert.deepEqual(report.errors,[],
  'Unreviewed World dynamic/evasive code or missing executable guard: '+
   JSON.stringify(report.errors));
assert.equal(report.reviewed,8);
assert.ok(report.files>=80,'AST must cover all non-test .mjs tools');
const contains=(code,kind,filename='world-new-writer.mjs')=>{
  const result=inspectWorldAstSource(filename,code);
  assert.ok(result.findings.some(f=>f.kind===kind),
    'Expected '+kind+': '+JSON.stringify(result));
  assert.ok(result.violations.includes('UNREVIEWED_WORLD_EXECUTABLE_SINK'),
    'New world script cannot silently introduce new write sink');
};
// Syntax AST, NOT substrings: comments and user-controlled string literals
// containing a fake POST must not create spurious network sinks.
for(const source of [
  "// api._request('POST','/api/user/code');\nexport const read=1;",
  'const example="api._request(\\'POST\\',\\'/api/user/code\\')";',
  "const data='https.request';\nconst get=api._request('GET','/api/user/code');"
]){
  const result=inspectWorldAstSource('world-docs.mjs',source);
  assert.equal(result.findings.length,0,JSON.stringify(result));
  assert.deepEqual(result.violations,[]);
}
contains("const verb='PO'+'ST'; const fn=api['_request']; "+
  "fn(verb,'/api/user/code',{});",'MUTATING_API_REQUEST');
contains("const route='userUpload'+'CodeOnce'; "+
  "const writer=api[route]; writer('chatgpt',{});",'MUTATING_CLIENT_WRAPPER');
contains("function act(api,verb){return api._request(verb,'/api/user/code',{});}",
  'UNKNOWN_HTTP_VERB');
contains("function act(api,method){return api[method]('chatgpt',{});}",
  'DYNAMIC_API_MEMBER');
contains("import https from 'node:https'; "+
  "const send=https.request;send('https://screeps.com/',{});",
  'ALTERNATE_NETWORK_TRANSPORT');
contains("const f=globalThis['fetch'];f('https://screeps.com/',{method:'POST'});",
  'FETCH_TRANSPORT');
contains("const s=new WebSocket('wss://screeps.com/socket/websocket');",
  'ALTERNATE_SOCKET_OR_XHR');
contains("import {exec as command} from 'node:child_process';"+
  "command('node other-tool.mjs');",'ALTERNATE_NETWORK_TRANSPORT');
contains("const sock={send(){}};ws.send('console something')",'SOCKET_SEND');

// O50's textual substring test can mistake a guard in a comment for a
// first-statement guard. The O51 AST proof rejects it.
const exportSource=(body,firstMain)=>
  "import {assertLegacyWorldMutationDisabled} from "+
  "'./o45-world-mutation-entrypoint-hold.mjs';\n"+
  "export async function stageInactiveWorldCode(api){"+body+"}\n"+
  "async function main(){"+firstMain+"}\n";
const guarded="assertLegacyWorldMutationDisabled('legacy-code-bootstrap');";
const valid=inspectWorldAstSource('world-branch-bootstrap.mjs',
  exportSource(guarded+"api._request('POST','/api/user/code')",guarded));
assert.deepEqual(valid.violations,[]);
assert.equal(valid.guardedExports,1);
assert.ok(valid.findings.some(f=>f.kind==='MUTATING_API_REQUEST'));
for(const injected of [
  exportSource("/*"+guarded+"*/api._request('POST','/api/user/code');",guarded),
  exportSource("void 0;"+guarded,guarded),
  exportSource(guarded,"// "+guarded+"\n console.log('before');"+guarded)
]){
  const result=inspectWorldAstSource('world-branch-bootstrap.mjs',injected);
  assert.ok(result.violations.some(x=>
    x.includes('FIRST_EXECUTABLE_HOLD_MISSING')),
    'Comment/late guards must fail the independent AST proof');
}
const missingImport=inspectWorldAstSource('world-branch-bootstrap.mjs',
  "export async function stageInactiveWorldCode(api){"+guarded+"}\n"+
  "async function main(){"+guarded+"}");
assert.ok(missingImport.violations.includes('LEGACY_GUARD_IMPORT_MISSING'));
assert.throws(()=>inspectWorldAstSource('world-invalid.mjs',
  "export async function broken("),
  /O51_WORLD_AST_AUDIT_HOLD_SYNTAX/);
// Source counts + categories only, with bounded metadata, no credentials or
// game code in reports. This is static analysis, not proof of runtime safety.
console.log('O51 AST World writer and alternate transport audit: PASS '+
  JSON.stringify({files:report.files,reviewed:report.reviewed,
    categories:report.counts,findings:report.findings,
    violations:report.errors.length}));
