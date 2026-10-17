import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {assessRetainedReleaseEvidence,runReadOnlyReleaseAudit}
  from './o31-postdeploy-readonly-audit.mjs';

const TARGET_ROOM=process.env.SCREEPS_ROOM||'E8N1';
const secretId='PRIVATE_DEPLOYMENT_ID';
const secretUser='PRIVATE_USER_ID';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const modules=Object.fromEntries(Array.from({length:82},(_,i)=>[
  'testModule'+i,'// module '+i
]));
const expected=Object.fromEntries(Object.entries(modules).map(([k,v])=>[k,hash(v)]));
const bot={
  deploymentId:secretId,
  deploymentTick:1000,
  telemetryJournal:{
    events:[
      {c:'DEPLOYMENT_MARKER',t:1000,x:{deploymentId:secretId}},
      {c:'BOT_HEARTBEAT',t:1205,x:{creeps:2,rooms:1,bucket:8500}}
    ],
    snapshots:[{c:'STATUS_SNAPSHOT',t:1200,x:{
      cpu:8,bucket:8500,totalCreeps:2,
      rooms:{[TARGET_ROOM]:{rcl:4,creeps:{harvester:2},
        health:{status:'HEALTHY'},constructionSites:0}}
    }}]
  }
};
const goodPulse={ok:true,exactMainCodeVerified:true};
const memory=data=>({data:JSON.stringify(data)});
const good=assessRetainedReleaseEvidence(memory(bot),goodPulse);
assert.equal(good.result,'RETAINED_POSTDEPLOY_100T_SAMPLED');
assert.equal(good.retainedWindowStatus,'PASS');
assert.equal(good.observedJournalTicks,205);
assert.equal(good.checkedCpuSnapshots,1);
assert.equal(good.minimumSnapshotBucket,8500);
assert.equal(good.canonicalLive100tPass,false);
assert.equal(good.independentSameRunDeploymentReceiptVerified,false);
assert.equal(good.fatalFreeContinuousCoverageVerified,false);
assert.equal(good.releaseAuthorized,false);
assert.equal(good.apiMutationsAttempted,0);
assert.ok(good.blockers.includes('INDEPENDENT_SAME_RUN_DEPLOYMENT_RECEIPT_UNAVAILABLE'));

const fails=[
  {...bot,deploymentId:'OTHER_ID'},
  {...bot,telemetryJournal:{...bot.telemetryJournal,
    events:bot.telemetryJournal.events.filter(e=>e.c!=='DEPLOYMENT_MARKER')}},
  {...bot,telemetryJournal:{...bot.telemetryJournal,
    events:[...bot.telemetryJournal.events,
      {c:'MAIN_FATAL',t:1175,l:'FATAL',x:{secret:'DO_NOT_PRINT'}}]}},
  {...bot,telemetryJournal:{...bot.telemetryJournal,
    snapshots:[{...bot.telemetryJournal.snapshots[0],t:1050}]}},
  {...bot,telemetryJournal:{...bot.telemetryJournal,
    snapshots:[{...bot.telemetryJournal.snapshots[0],
      x:{...bot.telemetryJournal.snapshots[0].x,bucket:10}}]}}
];
for(const candidate of fails) {
  const audit=assessRetainedReleaseEvidence(memory(candidate),goodPulse);
  assert.equal(audit.result,'HOLD');
  assert.equal(audit.canonicalLive100tPass,false);
  assert.equal(audit.releaseAuthorized,false);
  assert.ok(!JSON.stringify(audit).includes(secretId));
  assert.ok(!JSON.stringify(audit).includes('DO_NOT_PRINT'));
}
assert.equal(assessRetainedReleaseEvidence(null,goodPulse).result,'HOLD');
assert.equal(assessRetainedReleaseEvidence(memory(bot),{ok:false}).result,'HOLD');

// Actual read adapter contract: only GET endpoints, no mutations, no raw
// source content and no account/deployment IDs in the output.
const calls=[];
const api={
  async authMe(){calls.push('authMe');return {_id:secretUser};},
  async userBranches(){calls.push('branches');return {
    list:[{branch:'chatgpt',activeWorld:true}]
  };},
  async userWorldStatus(){calls.push('status');return {status:'normal'};},
  async gameRoomObjects(){calls.push('objects');return {objects:[
    {type:'spawn',user:secretUser,name:'Spawn1'},
    {type:'creep',user:secretUser,role:'harvester'}]};},
  async userMemory(){calls.push('memory');return memory(bot);},
  async _request(method,endpoint){
    assert.equal(method,'GET','no mutation from read-only O31');
    calls.push(endpoint);
    if(endpoint==='/api/game/time')return {time:1210};
    if(endpoint==='/api/user/code')return {modules};
    throw Error('UNEXPECTED_ENDPOINT');
  }
};
const result=await runReadOnlyReleaseAudit(api,{
  server:'newbieland',room:TARGET_ROOM,shard:null,branch:'chatgpt'
},{expected});
assert.equal(result.result,'RETAINED_POSTDEPLOY_100T_SAMPLED');
assert.equal(result.currentServerTick,1210);
assert.equal(result.activeCodeModuleFingerprint.unexplainedMismatchCount,0);
assert.equal(result.canonicalLive100tPass,false);
assert.equal(result.apiMutationsAttempted,0);
assert.ok(calls.includes('/api/user/code'));
assert.ok(calls.includes('/api/game/time'));
assert.equal(calls.length,7);
assert.ok(!JSON.stringify(result).includes(secretId));
assert.ok(!JSON.stringify(result).includes(secretUser));
const badApi={...api,async _request(method,endpoint){
  const v=await api._request(method,endpoint);
  return endpoint==='/api/user/code'?
    {modules:{...modules,testModule0:'altered'}}:v;
}};
assert.equal((await runReadOnlyReleaseAudit(badApi,{
  server:'newbieland',room:TARGET_ROOM,shard:null,branch:'chatgpt'
},{expected})).result,'HOLD');

console.log('O31 bounded GET-only retained release provenance and no-false-LIVE_100T_PASS PASS');
