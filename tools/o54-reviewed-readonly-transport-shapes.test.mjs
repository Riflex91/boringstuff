import assert from 'node:assert/strict';
import {parse} from 'acorn';
import {inspectWorldAstSource,auditWorldAstRepo}
  from './o51-world-ast-egress-audit.mjs';
import {reviewedTransportFixtures,detectDynamicDispatch,
  isExactlyReviewedReadOnlyTransport}
  from './o54-reviewed-readonly-transport-shapes.mjs';

const {githubGet,scoutChild}=reviewedTransportFixtures();
const github="world-first-spawn-live-gate.mjs";
const scout="world-scout.mjs";
const githubSource=(call)=>"async function githubGet(url,token){return "+call+";}";
const scoutPrefix="import {spawnSync} from 'node:child_process';"+
  "import {assertWorldScoutRoomArguments} from './o51-world-planner-readonly-gate.mjs';"+
  "const selected=['W37S79'];assertWorldScoutRoomArguments(selected);";
const scoutSource=call=>scoutPrefix+call+";";
const assertReviewed=(filename,source)=>{
  const r=inspectWorldAstSource(filename,source);
  assert.deepEqual(r.violations,[],JSON.stringify(r.violations));
  assert.equal(r.findings.length,1);
};
const assertDenied=(filename,source,why)=>{
  const r=inspectWorldAstSource(filename,source);
  assert.ok(r.violations.some(x=>
    x.includes('READONLY_TRANSPORT_CHANGED_OR_ADDED')||
    x.includes('EXPECTED_REVIEWED_READONLY_TRANSPORT_NOT_UNIQUE')),
    why+': '+JSON.stringify(r.violations));
};
assertReviewed(github,githubSource(githubGet));
assertReviewed(scout,scoutSource(scoutChild));

const alteredFetch=[
  githubGet.replace("Accept:'application/vnd.github+json'","Accept:'text/plain'"),
  githubGet.replace("'Bearer '+token","makeHeaderWithSideEffects(token)"),
  githubGet.replace("'2022-11-28'","'2099-01-01'"),
  githubGet.replace("Accept:'application/vnd.github+json'",
    "get Accept(){return executeMutation();}"),
  githubGet.replace("headers:{","headers:{...sideEffect(),"),
  githubGet.replace("headers:{","headers:{method:'POST',"),
  githubGet.replace("fetch(url,","fetch(new URL('https://screeps.com/api/user/code'),"),
  githubGet.replace("fetch(url,","fetch.call(null,url,"),
  githubGet.replace("fetch(url,","fetch(url,{method:'POST'},"),
  githubGet.replace("}})","}}, {method:'POST'})"),
  githubGet.replace("fetch(url,","Reflect.apply(fetch,null,[url,")
];
for(const [i,call] of alteredFetch.entries()){
  // Syntactically invalid injected examples are not an allowed escape: the
  // parser must HOLD rather than accepting an unparseable reviewed source.
  try{assertDenied(github,githubSource(call),'changed GitHub GET '+i);}
  catch(err){
    if(!String(err).includes('O51_WORLD_AST_AUDIT_HOLD_SYNTAX'))throw err;
  }
}
// Introducing another call, even if an unchanged GET is still present,
// breaks the one-reviewed-transport contract.
assertDenied(github,githubSource(githubGet)+
  "Reflect.apply(fetch,null,['https://screeps.com/api/user/code',{method:'POST'}]);",
  'extra reflection transport');

const alteredScout=[
  scoutChild.replace("'--server','world'","'--server','newbieland'"),
  scoutChild.replace("'--server','world'","'--server','world','--place'"),
  scoutChild.replace("'--shard',shard","'--shard',shard,'--place'"),
  scoutChild.replace("'--concurrency','4'","'--concurrency','4','--place'"),
  scoutChild.replace("'--concurrency','4',...selected","'--concurrency','4',...selected,'--place'"),
  scoutChild.replace("stdio:['ignore',fd,fd]","stdio:'inherit'"),
  scoutChild.replace("timeout:7*60*1000","timeout:0"),
  scoutChild.replace("cwd:dir,env","cwd:dir,shell:true,env"),
  scoutChild.replace("cwd:dir,env","cwd:dir,env:{...env,SCREEPS_SERVER:'newbieland'}"),
  scoutChild.replace("process.execPath","'sh'"),
  scoutChild.replace("...selected","...['--place',...selected]"),
  scoutChild.replace("spawnSync(","spawnSync.call(null,")
];
for(const [i,call] of alteredScout.entries()){
  assertDenied(scout,scoutSource(call),'changed World scout subprocess '+i);
}

for(const [source,kind] of [
  ["Reflect.apply(fetch,null,['https://screeps.com/api/user/code',{method:'POST'}])",
    'REFLECT_DYNAMIC_DISPATCH'],
  ["Reflect.construct(WebSocket,['wss://screeps.com/socket/websocket'])",
    'REFLECT_DYNAMIC_DISPATCH'],
  ["fetch.call(null,'https://screeps.com/api/user/code',{method:'POST'})",
    'INDIRECT_NETWORK_CALL'],
  ["fetch.apply(null,['https://screeps.com/api/user/code',{method:'POST'}])",
    'INDIRECT_NETWORK_CALL'],
  ["api._request.call(api,'POST','/api/user/code',{})",
    'INDIRECT_NETWORK_CALL'],
  ["ws.send.bind(ws)('console Game.spawns.Spawn1.destroy()')",
    'INDIRECT_NETWORK_CALL']
]){
  const r=inspectWorldAstSource('world-new-indirect-writer.mjs',source);
  assert.ok(r.findings.some(x=>x.kind===kind),kind+' must be seen');
  assert.ok(r.violations.includes('UNREVIEWED_WORLD_EXECUTABLE_SINK'));
}
// Recognizing common reflection is not complete interprocedural JS analysis.
const ast=parse('Reflect.apply(fetch,null,[])',{ecmaVersion:'latest',sourceType:'module'});
assert.equal(detectDynamicDispatch(ast.body[0].expression),
  'REFLECT_DYNAMIC_DISPATCH');
assert.equal(isExactlyReviewedReadOnlyTransport(github,
  ast.body[0].expression,'FETCH_TRANSPORT',{consts:new Map(),imports:new Map()}),
  false);

const audit=auditWorldAstRepo(new URL('..',import.meta.url).pathname);
assert.deepEqual(audit.errors,[]);
assert.equal(audit.reviewed,8);
assert.ok(audit.files>=86);
console.log('O54 exact GitHub GET + World scout spawnSync shapes, injected mutations and Reflect indirection: PASS '+JSON.stringify({
  reviewed:audit.reviewed,files:audit.files,findings:audit.findings,
  violations:audit.errors.length,fetchMutations:alteredFetch.length,
  scoutMutations:alteredScout.length
}));
