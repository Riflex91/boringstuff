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
  "const example='api._request(\"POST\",\"/api/user/code\")';",
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

// Reviewed read-only transports are an explicit AST-shape allowlist, not a
// blanket file-name exemption. A fetch POST or changed local child argv must
// become a new, independently reviewable violation.
const githubGetReadOnly=
  "async function githubGet(url){return fetch(url,{headers:{Accept:'application/json'}});}";
assert.deepEqual(inspectWorldAstSource(
  'world-first-spawn-live-gate.mjs',githubGetReadOnly).violations,[]);
assert.ok(inspectWorldAstSource('world-first-spawn-live-gate.mjs',
  "async function githubGet(url){return fetch(url,{headers:{},method:'POST'});}"
).violations.some(x=>x.startsWith('READONLY_TRANSPORT_CHANGED_OR_ADDED_')));
const scoutBase=
  "import {spawnSync} from 'node:child_process';"+
  "import {assertWorldScoutRoomArguments} from './o51-world-planner-readonly-gate.mjs';"+
  "const selected=['W37S79'];assertWorldScoutRoomArguments(selected);";
const scoutCall=(server)=>
  "spawnSync(process.execPath,['initial-spawn-planner.mjs','--server','"+
    server+"',...selected]);";
assert.deepEqual(inspectWorldAstSource('world-scout.mjs',
  scoutBase+scoutCall('world')).violations,[]);
assert.ok(inspectWorldAstSource('world-scout.mjs',
  scoutBase+scoutCall('newbieland')).violations.some(x=>
    x.startsWith('READONLY_TRANSPORT_CHANGED_OR_ADDED_')));
assert.ok(inspectWorldAstSource('world-scout.mjs',
  scoutBase.replace('assertWorldScoutRoomArguments(selected);','')+
    scoutCall('world')).violations.some(x=>
      x.includes('SCOUT_SUBPROCESS_ARGV_GUARD_MISSING')));
const guardedPlanner=
  "import {assertWorldPlannerReadOnly} from './o51-world-planner-readonly-gate.mjs';"+
  "async function main(){let args;try{args={};}catch(e){}"+
  "assertWorldPlannerReadOnly(args);await api.gamePlaceSpawn('W37S79',1,1,'Spawn1');}";
assert.deepEqual(inspectWorldAstSource('initial-spawn-planner.mjs',
  guardedPlanner).violations,[]);
assert.ok(inspectWorldAstSource('initial-spawn-planner.mjs',
  guardedPlanner.replace('assertWorldPlannerReadOnly(args);','')
).violations.includes('SCOUT_CHILD_PLANNER_WORLD_PLACE_HOLD_MISSING'));

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
