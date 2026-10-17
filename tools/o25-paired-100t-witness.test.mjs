import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {assessReadOnlyPulse,compareReadOnlyPulses,runReadOnlyWitness}
 from './o25-paired-100t-witness.mjs';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const code=Object.fromEntries(Array.from({length:82},(_,i)=>['m'+i,'source'+i]));
const expected=Object.fromEntries(Object.entries(code).map(([k,v])=>[k,hash(v)]));
const me={_id:'private-player-id'};
const branch={list:[{branch:'chatgpt',activeWorld:true}]};
function raw(t,{status='normal',room='W37S79',hasCreep=true,
 hasSpawn=true,spoof=false,alternateCode=false,crash=false,
 codeSource=code}={}){
 const objects=[
   {type:'controller',user:'private-player-id'},
   ...(hasSpawn?[{type:'spawn',user:'private-player-id',name:'Spawn1'}]:[]),
   ...(hasCreep?[{type:'creep',user:'private-player-id',
      name:'PRIVATE_CREEP_NAME'}]:[])
 ];
 const snapshots=[{c:'STATUS_SNAPSHOT',t:t-5,x:{
   totalCreeps:1,
   rooms:{[room]:{health:{status:spoof?'CRITICAL':'HEALTHY'}}}
 }}];
 const events=[{c:'BOT_HEARTBEAT',t:t-1,
   x:{creeps:1,rooms:1,bucket:9000,private:'SECRET_DATA'}},
   ...(crash?[{c:'MAIN_FATAL',t:t-1,x:{error:'SECRET_DATA'}}]:[])];
 return {me,branches:branch,status:{status},clock:{time:t},
  objects:{objects},code:{modules:alternateCode?{...code,m1:'CHANGED'}:codeSource},
  memory:{data:JSON.stringify({deploymentId:'private-deployment-a',
   telemetryJournal:{snapshots,events}})}};
}
const config={room:'W37S79',branch:'chatgpt',expected};
const first=assessReadOnlyPulse(raw(1005),config);
const later=assessReadOnlyPulse(raw(1130),config);
assert.equal(first.ok,true);
assert.equal(later.ok,true);
assert.equal(first.canonicalLive100tPass,false);
assert.equal(first.exactMainCodeVerified,true);
assert.equal(first.snapshotTick,1000);
assert.equal(first.heartbeatTick,1004);
assert.ok(!JSON.stringify(first).includes('private-deployment-a'));
assert.ok(!JSON.stringify(first).includes('PRIVATE_CREEP_NAME'));
const cmp=compareReadOnlyPulses(first,later);
assert.equal(cmp.result,'GET_ONLY_100T_WITNESS');
assert.equal(cmp.serverGameTickSpan,125);
assert.equal(cmp.heartbeatGameTickSpan,125);
assert.equal(cmp.snapshotGameTickSpan,125);
assert.equal(cmp.fatalFreeContinuousCoverageVerified,false);
assert.equal(cmp.canonicalLive100tPass,false);
assert.equal(cmp.apiMutationsAttempted,0);
for(const scenario of [
 {status:'lost'}, {status:'empty'}, {hasCreep:false},{hasSpawn:false},
 {spoof:true},{alternateCode:true},{crash:true}
]){
 const bad=assessReadOnlyPulse(raw(1005,scenario),config);
 assert.equal(bad.ok,false,JSON.stringify(scenario));
 assert.equal(compareReadOnlyPulses(bad,later).result,'HOLD');
}
const missing=assessReadOnlyPulse({...raw(1005),memory:null},config);
assert.equal(missing.ok,false);
assert.ok(missing.failures.includes('BOT_MEMORY_UNVERIFIED'));
const stale=assessReadOnlyPulse({...raw(1005),
 clock:{time:1300}},config);
assert.equal(stale.ok,false);
assert.ok(stale.failures.includes('RECENT_IN_GAME_HEARTBEAT_UNVERIFIED'));
const otherDeployment={...later,deploymentFingerprint:hash('different')};
assert.ok(compareReadOnlyPulses(first,otherDeployment).failures
  .includes('DEPLOYMENT_ID_CHANGED'));
const noSnap={...later,snapshotTick:null};
assert.equal(compareReadOnlyPulses(first,noSnap).result,'HOLD');
const near={...later,serverTick:1050};
assert.ok(compareReadOnlyPulses(first,near).failures
 .includes('SERVER_GAME_TIME_SPAN_BELOW_100'));
const calls=[];
const r=await runReadOnlyWitness({},config,{
 expected,read:async()=>{
   calls.push('read');
   return calls.length<3?first:later;
 },sleep:async()=>{calls.push('sleep')},maxPolls:5,pollMs:0
});
assert.equal(r.result,'GET_ONLY_100T_WITNESS');
assert.equal(r.canonicalLive100tPass,false);
const badRun=await runReadOnlyWitness({},config,{
 expected,read:async()=>assessReadOnlyPulse(raw(1005,{hasCreep:false}),config),
 sleep:async()=>{throw Error('must not wait when first probe failed')}
});
assert.equal(badRun.result,'HOLD');
assert.equal(badRun.apiMutationsAttempted,0);
console.log('O25 independent 100-game-tick GET-only witness offline safety PASS');
