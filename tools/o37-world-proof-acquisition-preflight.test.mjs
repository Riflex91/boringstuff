import assert from 'node:assert/strict';
import {
  WORLD_TARGET,expectedWorldModules,assessCurrentWorldProofPlan,
  runWorldReadOnlyPreflight
} from './o37-world-proof-acquisition-preflight.mjs';
import {PREDECESSOR_MAIN,ORIGINAL_WORLD_RUN_SHA}
  from './o36-world-git-tree-equivalence.mjs';
const expected=expectedWorldModules();
assert.equal(Object.keys(expected).length,82);
const ME_ID='EXAMPLE_ACCOUNT_ID_DO_NOT_LOG';
const sample={
  me:{_id:ME_ID,username:'Riflex91'},
  branches:{list:[{branch:'chatgpt',activeWorld:true}]},
  status:{status:'normal'},
  room:{objects:[
    {type:'spawn',name:'Spawn1',x:37,y:26,user:ME_ID},
    {type:'creep',user:ME_ID,name:'EXAMPLE_CREEP_DO_NOT_LOG'},
    {type:'controller',user:ME_ID,level:3}
  ]},
  code:{modules:{...expected}},
  clock:{time:78367000}
};
const ok=assessCurrentWorldProofPlan(sample,expected);
assert.equal(ok.result,'WORLD_O16_IDENTICAL_NO_OPERATIONAL_DEPLOY_NEEDED');
assert.equal(ok.activeGameIdenticalToExactMain,true);
assert.equal(ok.ownedPinnedSpawnVerified,true);
assert.equal(ok.ownedCreepCount,1);
assert.equal(ok.historicalWorldOriginalExactMainSha,false);
assert.equal(ok.currentExactMainWorldCanonicalLive100tPass,false);
assert.equal(ok.mayUploadWorldCode,false);
assert.equal(ok.mayResetWorld,false);
assert.equal(ok.mayMergeCandidate,false);
assert.equal(ok.releaseAuthorized,false);
assert.equal(ok.apiMutationsAttempted,0);
assert.equal(ok.exactRequiredMain,PREDECESSOR_MAIN);
assert.equal(ok.sourceCommit,ORIGINAL_WORLD_RUN_SHA);
assert.equal(ok.safestOperationalAction,'PRESERVE_HEALTHY_RUNNING_WORLD');
for(const s of [ME_ID,'EXAMPLE_CREEP_DO_NOT_LOG','const x=']){
  assert.ok(!JSON.stringify(ok).includes(s));
}
const mutate=(callback)=>{const v=structuredClone(sample);callback(v);return v;};
const variants=[
  mutate(x=>{x.me.username='unknown';}),
  mutate(x=>{x.me._id='';}),
  mutate(x=>{x.branches.list[0].branch='chatgpt-w37s79-stage';}),
  mutate(x=>{x.branches.list.push({branch:'other',activeWorld:true});}),
  mutate(x=>{x.status.status='lost';}),
  mutate(x=>{x.status.status=null;}),
  mutate(x=>{x.room.objects=[];}),
  mutate(x=>{x.room.objects[0].x=38;}),
  mutate(x=>{x.room.objects[0].user='NOT_OWNED';}),
  mutate(x=>{x.room.objects.push({...x.room.objects[0]});}),
  mutate(x=>{x.room.objects[1].type='tombstone';}),
  mutate(x=>{x.room.objects[2].user='NOT_OWNED';}),
  mutate(x=>{x.room.objects[2].level=0;}),
  mutate(x=>{x.clock.time=0;}),
  mutate(x=>{x.code.modules.main='unexpected';}),
  mutate(x=>{delete x.code.modules.main;}),
  mutate(x=>{x.code.modules.unexpected='module';}),
  mutate(x=>{x.code.modules.config=null;}),
  mutate(x=>{x.code.modules=[];}),
  mutate(x=>{x.code=null;})
];
for(const [index,bad] of variants.entries()){
  const ans=assessCurrentWorldProofPlan(bad,expected);
  assert.equal(ans.runtimeReadOnlyVerified,false,'bad case '+index);
  assert.equal(ans.activeGameIdenticalToExactMain,false);
  assert.equal(ans.mayUploadWorldCode,false);
  assert.equal(ans.releaseAuthorized,false);
  assert.equal(ans.apiMutationsAttempted,0);
  assert.equal(ans.safestOperationalAction,'HOLD_AND_INVESTIGATE_READONLY');
}
const calls=[];
const api={
  defaultShard:'shard0',
  async authMe(){calls.push('authMe');return sample.me;},
  async userBranches(){calls.push('branches');return sample.branches;},
  async userWorldStatus(){calls.push('status');return sample.status;},
  async gameRoomObjects(room,shard){
    assert.equal(room,WORLD_TARGET.room);assert.equal(shard,WORLD_TARGET.shard);
    calls.push('objects');return sample.room;
  },
  async _request(method,url,params){
    assert.equal(method,'GET','never write Screeps gameplay');
    calls.push(url);
    if(url==='/api/user/code'){
      assert.equal(params.branch,'chatgpt');return sample.code;
    }
    if(url==='/api/game/time'){
      assert.equal(params.shard,'shard0');return sample.clock;
    }
    throw Error('UNEXPECTED_ENDPOINT');
  }
};
assert.equal((await runWorldReadOnlyPreflight(api,{expected})).runtimeReadOnlyVerified,true);
assert.equal(calls.length,6);
assert.ok(calls.includes('/api/user/code'));
assert.ok(calls.includes('/api/game/time'));
await assert.rejects(
  ()=>runWorldReadOnlyPreflight({...api,defaultShard:'shard1'},{expected}),
  /EXACT_WORLD_SHARD_REQUIRED/
);
console.log('O37 authentic World GET-only 82 module no-op decision and strict exact-SHA HOLD: PASS');
