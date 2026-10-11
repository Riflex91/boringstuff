import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_TARGET } from './world-target-selection.mjs';
import { validateTarget, decideWorldTarget,
  inspectSelectedWorldTarget } from './world-target-preflight.mjs';

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
  backup={modules:{main:'legacy',config:'old config'}}
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
      assert.deepEqual(params,{branch:'default'},
        'No other World code branch should be read or mutated');
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
  assert.equal(v.nextAction,'AWAIT_FINAL_EXPLICIT_PLACEMENT_APPROVAL');
  assert.equal(v.readyForPlacement,false,
    'Site and branch proof cannot automatically place World spawn');
  assert.equal(v.inactiveStageGate.preconditionsPass,false,
    'Existing World code branch must block an initial staging attempt');
  assert.ok(v.inactiveStageGate.failures.includes('WORLD_BRANCH_ALREADY_EXISTS'));
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
