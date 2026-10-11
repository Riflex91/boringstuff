import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_TARGET } from './world-target-selection.mjs';
import { validateTarget, decideWorldTarget,
  inspectSelectedWorldTarget,verifyStagedWorldCode } from './world-target-preflight.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const target=WORLD_TARGET;
assert.equal(target.room,'W37N11');
assert.equal(target.shard,'shard0');
assert.deepEqual([target.x,target.y],[12,13]);
assert.equal(target.placementApproved,false);
assert.equal(target.deploymentApproved,false);
assert.ok(validateTarget(target));
assert.throws(()=>validateTarget({...target,shard:'shardX'}),/read-only/);
assert.throws(()=>validateTarget({...target,placementApproved:true}),/read-only/);
assert.throws(()=>validateTarget({...target,branch:'default'}),/read-only/);
assert.throws(()=>validateTarget({...target,x:0}),/read-only/);

const ordinaryRoom=(owner,kind='normal')=>({
  status:{room:{status:kind}},
  objects:{objects:[
    {type:'controller',x:26,y:34,level:owner?8:0,
      ...(owner?{user:owner}:{})},
    {type:'source',x:14,y:8,id:'s1'},
    {type:'source',x:17,y:12,id:'s2'}
  ],users:owner?{[owner]:{username:'Somebody'}}:{}},
  terrain:{terrain:[{terrain:'0'.repeat(2500)}]}
});
function mockWorld({
  worldStatus='empty',site=ordinaryRoom(null),
  rival=ordinaryRoom('rival'),reserve=ordinaryRoom(null),
  branches=[{branch:'default',activeWorld:true}],missingSource=false,
  backup={modules:{main:'legacy',config:'old config'}},
  stagedModules={}
}={}) {
  const rooms={W37N11:site,W35N11:rival,W36N13:reserve};
  const calls=[];
  const api={defaultShard:'shard0',
    async authMe(){calls.push({method:'GET',endpoint:'authMe'});return {_id:'myId'};},
    async userWorldStatus(){calls.push({method:'GET',endpoint:'userWorldStatus'});return {status:worldStatus};},
    async userBranches(){calls.push({method:'GET',endpoint:'userBranches'});return {list:branches};},
    async _request(method,endpoint,params){
      calls.push({method,endpoint,params});assert.equal(method,'GET');
      if (endpoint==='/api/game/shards/info')
        return {shards:[{name:'shard0',rooms:6866,users:192}]};
      assert.equal(endpoint,'/api/user/code');
      assert.ok(['default','chatgpt'].includes(params?.branch),
        'Only read code of current default or isolated chatgpt branch');
      if (params.branch==='chatgpt') return {modules:stagedModules};
      if (backup instanceof Error) throw backup;
      return backup;
    },
    async gameRoomStatus(room,shard){
      calls.push({method:'GET',endpoint:'roomStatus',room,shard});
      assert.equal(shard,'shard0');
      return rooms[room].status;
    },
    async gameRoomObjects(room,shard){
      calls.push({method:'GET',endpoint:'roomObjects',room,shard});
      assert.equal(shard,'shard0');
      const result=rooms[room].objects;
      if(room==='W37N11' && missingSource)
        return {objects:result.objects.filter(o=>o.type!=='source'),users:{}};
      return result;
    },
    async gameRoomTerrain(room,shard){
      calls.push({method:'GET',endpoint:'roomTerrain',room,shard});
      assert.equal(shard,'shard0');
      return rooms[room].terrain;
    }
  };
  return {api,calls};
}
{
  const f=mockWorld();
  const result=await inspectSelectedWorldTarget(f.api);
  assert.equal(result.evidenceSource,'LIVE_SCREEPS_WORLD_API');
  assert.equal(result.mode,'GET_ONLY');
  assert.equal(result.siteChecksPass,true);
  assert.equal(result.room.tile.terrain,'plain');
  assert.deepEqual(result.room.tile.issues,[]);
  assert.equal(result.risk,'RIVAL_PRESENCE_REQUIRES_REVIEW');
  assert.equal(result.readyForPlacement,false);
  assert.equal(result.readyForDeployment,false);
  assert.equal(result.stagingRequired,true);
  assert.equal(result.inactiveStageGate.preconditionsPass,true);
  assert.deepEqual(result.inactiveStageGate.failures,[]);
  assert.equal(result.inactiveStageGate.manualApprovalRequired,true);
  assert.equal(result.inactiveStageGate.stagingAuthorized,false);
  assert.equal(result.inactiveStageGate.stagingAttempted,false);
  assert.equal(result.inactiveStageGate.defaultCodeContentsIncluded,false);
  assert.equal(JSON.stringify(result).includes('legacy'),false,
    'Default World branch source must not be printed in evidence');
  assert.equal(result.nextAction,'STAGE_ISOLATED_INACTIVE_WORLD_CODE');
  assert.equal(result.knownRivals[0].controllerLevel,8);
  assert.ok(f.calls.every(c=>c.method==='GET'),
    'World run must have no POST, including spawn-name check');
  assert.ok(f.calls.filter(c=>c.endpoint==='roomObjects').length===3);
  assert.ok(f.calls.filter(c=>c.endpoint==='roomObjects')
    .every(c=>c.shard==='shard0'));
}
{
  const f=mockWorld({rival:ordinaryRoom(null),
    branches:[{branch:'default',activeWorld:true},{branch:'chatgpt'}]});
  const v=await inspectSelectedWorldTarget(f.api);
  assert.equal(v.risk,'NO_RIVAL_IN_CHECKED_ROOMS');
  assert.equal(v.worldBranchPresent,true);
  assert.equal(v.nextAction,'INVESTIGATE_WORLD_CODE_READBACK');
  assert.equal(v.worldCodeReadiness.exactInactiveCode,false);
  assert.equal(v.worldCodeReadiness.presentButUnverified,true);
  assert.equal(v.readyForPlacement,false,
    'Site and branch proof cannot automatically place World spawn');
  assert.equal(v.inactiveStageGate.preconditionsPass,false,
    'Existing World code branch must block an initial staging attempt');
  assert.equal(v.stagedCodeReadback.status,'INCOMPLETE_OR_MISMATCHED_CODE');
  assert.ok(v.inactiveStageGate.failures.includes('WORLD_BRANCH_ALREADY_EXISTS'));
}
{
  const game=path.resolve(here,'..','game');
  const files=fs.readdirSync(game).filter(name=>name.endsWith('.js'));
  const stagedModules=Object.fromEntries(files.map(name=>[
    name.slice(0,-3),fs.readFileSync(path.join(game,name),'utf8')
  ]));
  assert.ok(files.length>=8);
  const f=mockWorld({branches:[
    {branch:'default',activeWorld:true},
    {branch:'chatgpt',activeWorld:false}
  ],stagedModules});
  const v=await inspectSelectedWorldTarget(f.api);
  assert.equal(v.stagedCodeReadback.status,'EXACT_INACTIVE_CODE');
  assert.equal(v.stagedCodeReadback.observedModuleCount,files.length);
  assert.equal(v.worldCodeReadiness.exactInactiveCode,true);
  assert.equal(v.worldCodeReadiness.presentButUnverified,false);
  assert.equal(v.nextAction,'MANUAL_RIVAL_RISK_REVIEW');
  assert.equal(v.worldCodeReadiness.placementAuthorized,false);
  assert.equal(v.worldCodeReadiness.operatorRiskAccepted,false);
  assert.equal(v.worldCodeReadiness.spawnNameUniquenessVerified,false);
  assert.equal(v.worldCodeReadiness.finalPlacementVerificationPassed,false);
  assert.equal(v.readyForPlacement,false);
  assert.equal(v.readyForDeployment,false);
  assert.equal(f.calls.some(x=>x.method!=='GET'),false);
  // A branch that is already active must be blocked even with correct code.
  const active=await inspectSelectedWorldTarget(mockWorld({branches:[
    {branch:'default',activeWorld:true},{branch:'chatgpt',activeWorld:true}
  ],stagedModules}).api);
  assert.equal(active.worldCodeReadiness.exactInactiveCode,false);
  assert.equal(active.nextAction,'INVESTIGATE_WORLD_CODE_READBACK');
}
{
  const site=ordinaryRoom(null);
  site.objects.objects.push({type:'spawn',x:12,y:13});
  const v=await inspectSelectedWorldTarget(mockWorld({site}).api);
  assert.equal(v.siteChecksPass,false);
  assert.ok(v.failures.includes('EXACT_SPAWN_TILE_BLOCKED'));
}
{
  const v=await inspectSelectedWorldTarget(mockWorld({
    site:ordinaryRoom('enemy')}).api);
  assert.ok(v.failures.includes('TARGET_ALREADY_OWNED'));
}
{
  const v=await inspectSelectedWorldTarget(mockWorld({
    site:ordinaryRoom(null,'novice')}).api);
  assert.ok(v.failures.includes('TARGET_ROOM_STATUS_NOT_NORMAL'));
}
{
  const v=await inspectSelectedWorldTarget(mockWorld({
    worldStatus:'normal'}).api);
  assert.ok(v.failures.includes('ACCOUNT_NOT_IN_EMPTY_INITIAL_SPAWN_STATE'));
}
{
  const v=await inspectSelectedWorldTarget(mockWorld({missingSource:true}).api);
  assert.ok(v.failures.includes('TARGET_SOURCE_GEOMETRY_CHANGED'));
}
{
  const site=ordinaryRoom(null);
  site.objects.objects=[...site.objects.objects.filter(o=>o.type!=='controller')];
  const v=await inspectSelectedWorldTarget(mockWorld({site}).api);
  assert.ok(v.failures.includes('TARGET_CONTROLLER_MISSING'));
}
{
  const v=await inspectSelectedWorldTarget(mockWorld({
    rival:{...ordinaryRoom('rival'),objects:{objects:null}}}).api);
  assert.equal(v.risk,'UNVERIFIED');
  assert.equal(v.readyForPlacement,false);
}
{
  const f=mockWorld();
  f.api.defaultShard='shard2';
  await assert.rejects(()=>inspectSelectedWorldTarget(f.api),/pinned/);
}
{
  const decision=decideWorldTarget({
    preflight:{authenticated:true,worldStatus:'empty',hasNoSpawn:true,
      shards:[{name:'shard0'}],branches:[]},
    room:{verified:true,status:'normal',controllerPresent:true,
      ownerPresent:false,reservationPresent:true,sourceCount:2,
      tile:{ok:true}},
    nearby:[]
  });
  assert.ok(decision.failures.includes('TARGET_RESERVED'));
  assert.equal(decision.risk,'UNVERIFIED');
}
{
  const f=mockWorld({backup:{error:'no modules'}});
  const v=await inspectSelectedWorldTarget(f.api);
  assert.equal(v.inactiveStageGate.preconditionsPass,false);
  assert.ok(v.inactiveStageGate.failures.includes('CURRENT_CODE_BACKUP_NOT_READABLE'));
  assert.equal(v.nextAction,'INVESTIGATE_INACTIVE_STAGE_GATE');
}
{
  const f=mockWorld({backup:new Error('permission denied')});
  const v=await inspectSelectedWorldTarget(f.api);
  assert.ok(v.inactiveStageGate.failures.includes(
    'WORLD_DEFAULT_CODE_BACKUP_OR_GATE_UNVERIFIED'));
}
{
  const f=mockWorld({branches:[{branch:'default',activeWorld:false}]});
  const v=await inspectSelectedWorldTarget(f.api);
  assert.ok(v.inactiveStageGate.failures.includes('DEFAULT_BRANCH_NOT_ACTIVE'));
}
{
  const f=mockWorld({rival:{...ordinaryRoom('rival'),
    objects:{objects:null}}});
  const v=await inspectSelectedWorldTarget(f.api);
  assert.ok(v.inactiveStageGate.failures.includes('KNOWN_RIVAL_ROOMS_UNVERIFIED'));
  assert.equal(v.inactiveStageGate.preconditionsPass,false);
}
{
  const f=mockWorld({worldStatus:'normal'});
  const v=await inspectSelectedWorldTarget(f.api);
  assert.ok(v.inactiveStageGate.failures.includes('ACCOUNT_NOT_EMPTY'));
}
{
  const expected={main:'main code',config:'config code'};
  const api={_request:async(method,endpoint,query)=>{
    assert.equal(method,'GET');assert.equal(endpoint,'/api/user/code');
    assert.deepEqual(query,{branch:'chatgpt'});
    return {modules:{main:'main code',config:'config code'}};
  }};
  const listed=[{branch:'default',activeWorld:true},
    {branch:'chatgpt',activeWorld:false}];
  const exact=await verifyStagedWorldCode(api,listed,expected);
  assert.equal(exact.status,'EXACT_INACTIVE_CODE');
  assert.equal(exact.exactSourceMatch,true);
  assert.equal(exact.observedModuleCount,2);
  const absent=await verifyStagedWorldCode(api,
    [{branch:'default',activeWorld:true}],expected);
  assert.equal(absent.status,'BRANCH_ABSENT');
  const active=await verifyStagedWorldCode(api,
    [{branch:'chatgpt',activeWorld:true}],expected);
  assert.equal(active.status,'ACTIVE_OR_DUPLICATE_BRANCH_BLOCKED');
  const duplicate=await verifyStagedWorldCode(api,
    [{branch:'chatgpt',activeWorld:false},{branch:'chatgpt',activeWorld:false}],expected);
  assert.equal(duplicate.status,'ACTIVE_OR_DUPLICATE_BRANCH_BLOCKED');
  const changed=await verifyStagedWorldCode({
    _request:async()=>({modules:{main:'tampered'}})},listed,expected);
  assert.equal(changed.status,'INCOMPLETE_OR_MISMATCHED_CODE');
  const failed=await verifyStagedWorldCode({
    _request:async()=>{throw new Error('authorization failed')}},listed,expected);
  assert.equal(failed.status,'BRANCH_CODE_GET_FAILED');
  const raw=JSON.stringify(changed)+JSON.stringify(failed);
  assert.equal(raw.includes('tampered'),false,'No source code in evidence');
  assert.equal(raw.includes('authorization failed'),false,'No API error in evidence');
}
const source=fs.readFileSync(path.join(here,'world-target-preflight.mjs'),'utf8');
for(const blocked of [
  /\.gamePlaceSpawn\s*\(/, /gamePlaceSpawn\s*\(/,
  /\.gameCheckUniqueObjectName\s*\(/,
  /\._request\s*\(\s*['"]POST['"]/,
  /\.userSetActiveBranch\s*\(/,
  /\.userSetCode\s*\(/
]) assert.equal(blocked.test(source),false,
  'No mutating HTTP/API method may be invoked by World preflight');
console.log('World W37N11 pinned-shard GET-only site/rival preflight tests passed');
