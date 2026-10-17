import assert from 'node:assert/strict';
import {checkApprovedWorldHoldings,checkSameTickWorldLoss,
  performApprovedWorldAutoRecovery} from './world-auto-respawn.mjs';

const roomSet={shards:{shard0:['W37S79'],shard1:[],shard2:[],
 shard3:[],sim:[]},reservations:{shard0:[]}};
const rooms=checkApprovedWorldHoldings(roomSet);
assert.equal(rooms.complete,true);
assert.equal(rooms.scopeVerified,true);
for(const extra of [
 {shards:{shard0:['W37S79','W40S80'],shard1:[],shard2:[],shard3:[]}},
 {shards:{shard0:['W37S79'],shard1:['E4N1'],shard2:[],shard3:[]}},
 {shards:{shard0:['W37S79'],shard1:[],shard2:[],shard3:[],sim:['E2S2']}},
 {shards:{shard0:['W37S79'],shard1:[],shard2:[],shard3:[],sim:[]},
  reservations:{shard0:['W37S79']}},
 {shards:{shard0:['W37S79']}}
 ])assert.equal(checkApprovedWorldHoldings(extra).scopeVerified,false);

const mem=t=>({data:JSON.stringify({deploymentId:'test-world-main',telemetryJournal:{
 snapshots:[{c:'STATUS_SNAPSHOT',t,x:{
  rooms:{W37S79:{health:{status:'CRITICAL',reasons:['SPAWN_MISSING']}}},
  totalCreeps:0}}],
 events:[{c:'BOT_HEARTBEAT',t,x:{creeps:0,rooms:1,
   secret:'private-creep-id'}}]
}})});
assert.equal(checkSameTickWorldLoss(mem(1000),1004).verified,true);
assert.equal(checkSameTickWorldLoss(mem(1000),1200).verified,false);
assert.equal(checkSameTickWorldLoss(mem(1000),995).verified,false);
const wrong=JSON.parse(mem(1000).data);
wrong.telemetryJournal.snapshots[0].x.totalCreeps=1;
assert.equal(checkSameTickWorldLoss({data:JSON.stringify(wrong)},1004).verified,false);

function mock({status='lost',statusAfter='empty',user='riflex91',
  holdings=roomSet,advanced=true,throwPost=false,rejectedPost=false,
  noHeartbeat=false}={}){
 const actions={respawnPosts:0,placements:0,worldChecks:0};
 let clockCalls=0,lossReads=0;
 const api={
  defaultShard:'shard0',
  async authMe(){return {_id:'private-id',username:user}},
  async userWorldStatus(){
   actions.worldChecks++;
   return {status:actions.respawnPosts?statusAfter:status};
  },
  async userRooms(id){assert.equal(id,'private-id');return holdings},
  async userMemory(){
   lossReads++;
   if(noHeartbeat)return {data:'{}'};
   return mem(advanced&&lossReads>1?1100:1000);
  },
  async gameRoomObjects(){return {objects:[
   {type:'controller',user:'private-id'}, // historical own controller
   {type:'spawn',user:'private-id'} // stale room-object API spawn ghost
  ]}},
  async _request(method,endpoint,body,opts){
   if(method==='GET'){
    assert.equal(endpoint,'/api/game/time');
    clockCalls++;
    return {time:advanced&&clockCalls>1?1105:1005};
   }
   assert.equal(method,'POST');
   assert.equal(endpoint,'/api/user/respawn');
   assert.equal(opts.max5xxRetries,0);
   assert.equal(opts.max429Retries,0);
   assert.equal(opts.retryAuth,false);
   assert.deepEqual(body,{});
   actions.respawnPosts++;
   if(throwPost)throw Error('uncertain after accepted POST');
   return rejectedPost?{ok:false,error:'rejected'}:{ok:1};
  }
 };
 const nowSeq=[1000,1421];
 const deps={
  wait:async()=>{},
  now:()=>nowSeq.shift()??1421,
  place:async(a,id,approval)=>{
   actions.placements++;
   assert.equal(id,'private-id');
   assert.equal(approval,'PLACE_W37S79_37_26_ONLY');
   return {status:'PASS',spawnVerified:true,placementApiCalls:1};
  }
 };
 return {api,deps,actions};
}
const normal=mock({status:'normal'});
assert.equal((await performApprovedWorldAutoRecovery(normal.api,
 normal.deps)).status,'NO_ACTION_WORLD_NORMAL');
assert.equal(normal.actions.respawnPosts,0);
assert.equal(normal.actions.placements,0);
const healthy=mock();
const successful=await performApprovedWorldAutoRecovery(healthy.api,
 healthy.deps);
assert.equal(successful.status,'RESPAWN_AND_SPAWN1_VERIFIED');
assert.equal(successful.respawnPosts,1);
assert.equal(successful.placementPosts,1);
assert.equal(healthy.actions.respawnPosts,1);
assert.equal(healthy.actions.placements,1);
for(const opts of [
 {user:'another-user'},{status:'empty'},{holdings:{
  shards:{shard0:['W37S79','W37S80'],shard1:[],shard2:[],shard3:[]}}},
 {noHeartbeat:true},{advanced:false}
 ]){
  const m=mock(opts);
  if(opts.user==='another-user'){
    await assert.rejects(()=>performApprovedWorldAutoRecovery(m.api,m.deps),
      /WORLD_ACCOUNT_IDENTITY_MISMATCH/);
  }else{
    const r=await performApprovedWorldAutoRecovery(m.api,m.deps);
    assert.ok(r.status.startsWith('HOLD'),r.status);
  }
  assert.equal(m.actions.respawnPosts,0);
  assert.equal(m.actions.placements,0);
}
const uncertain=mock({throwPost:true});
const noRepeat=await performApprovedWorldAutoRecovery(uncertain.api,uncertain.deps);
assert.equal(noRepeat.status,'RESPAWN_OUTCOME_UNCERTAIN_NO_RETRY');
assert.equal(uncertain.actions.respawnPosts,1);
assert.equal(uncertain.actions.placements,0);
const rejection=mock({rejectedPost:true});
assert.equal((await performApprovedWorldAutoRecovery(rejection.api,
 rejection.deps)).status,'RESPAWN_RESPONSE_REJECTED_NO_RETRY');
assert.equal(rejection.actions.respawnPosts,1);
assert.equal(rejection.actions.placements,0);
const noReset=mock({statusAfter:'lost'});
assert.equal((await performApprovedWorldAutoRecovery(noReset.api,
 noReset.deps)).status,'RESPAWN_READBACK_UNVERIFIED_NO_RETRY');
assert.equal(noReset.actions.respawnPosts,1);
assert.equal(noReset.actions.placements,0);
console.log('O23 executable auto-respawn exact-one-reset and protected placement offline regression PASS');
