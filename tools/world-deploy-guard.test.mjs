import assert from 'node:assert/strict';
import { assessWorldDeployment } from './world-deploy-guard.mjs';
const id='user123';
const controller={type:'controller',x:24,y:24,user:id,level:1};
const spawn={type:'spawn',x:25,y:25,user:id};
const baseline={account:{ok:1,_id:id},world:{ok:1,status:'normal'},
  branches:{ok:1,list:[{branch:'chatgpt',activeWorld:true}]},
  roomObjects:{objects:[controller,spawn],users:{}},status:{room:{status:'normal'}},
  code:{modules:{main:'module.exports.loop = function() {}'}},room:'E2S3',shard:'shard3'};
const valid=assessWorldDeployment(baseline);
assert.equal(valid.ok,true,JSON.stringify(valid));
const cases=[
  [{world:{status:'empty'}},'NO_ACTIVE_WORLD_SPAWN'],
  [{shard:'invalid'},'INVALID_WORLD_TARGET'],
  [{roomObjects:{objects:[controller]}},'OWNED_SPAWN_NOT_FOUND'],
  [{branches:{list:[{branch:'default',activeWorld:true}]}},'WORLD_BRANCH_NOT_ACTIVE'],
  [{status:{room:{status:'novice'}}},'ROOM_NOT_NORMAL'],
  [{code:{error:'not readable'}},'WORLD_BACKUP_CODE_UNAVAILABLE'],
  [{account:{ok:1,_id:'other'}},'ROOM_NOT_OWNED_BY_ACCOUNT']
];
for(const [change,expected] of cases) {
  const result=assessWorldDeployment({...baseline,...change});
  assert.equal(result.ok,false,expected);
  assert.ok(result.issues.includes(expected),JSON.stringify(result));
}
console.log('World deployment fail-closed policy (offline only): PASS');
