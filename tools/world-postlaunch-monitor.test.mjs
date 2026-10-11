import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {decodeWorldMemory,assessWorldStartup,summarizeWorldRcl2Growth} from './world-postlaunch-monitor-core.mjs';
import {inspectCurrentWorldStartup,observeWorldFor100Ticks} from './world-postlaunch-monitor.mjs';

const original={tick:2500,cpu:7,bucket:10000};
const packed='gz:'+gzipSync(JSON.stringify(original)).toString('base64');
assert.deepEqual(decodeWorldMemory({data:packed}),original);
assert.deepEqual(decodeWorldMemory({data:{data:JSON.stringify(original)}}),original);
assert.deepEqual(decodeWorldMemory({data:original}),original);
assert.equal(decodeWorldMemory({data:'invalid-json'}),null);
assert.equal(decodeWorldMemory({data:'gz:broken'}),null);
assert.equal(decodeWorldMemory({data:null}),null);
assert.equal(decodeWorldMemory({data:{ok:false}}),null);

function fixture({
  tick=2400,session=2250,hostile=false,owned=true,spawn=true,
  active=true,creeps=2,bucket=10000,fatal=false,
  error=false,noStats=false,noSnapshot=false,retention=false,
  startupCritical=false,lateCritical=false,currentBucket=10000,
  rcl=1
}={}) {
  const record={t:2400,c:'STATUS_SNAPSHOT',x:{
    cpu:5.3,bucket,
    rooms:{W37N11:{
      rcl,creeps:{harvester:creeps,worker:0},
      spawnBusy:false,energyAvailable:250,energyCapacity:300
    }}
  }};
  return {account:{_id:'mine'},world:{status:'normal'},
    branches:{list:[{branch:'default'},{
      branch:'chatgpt',activeWorld:active}]},
    roomStatus:{room:{status:'normal'}},
    roomObjects:{objects:[
      {type:'controller',user:owned?'mine':'enemy',level:1},
      ...(spawn?[{type:'spawn',user:owned?'mine':'enemy',
        name:'Spawn1',x:12,y:13}]:[]),
      {type:'creep',user:'mine'},
      ...(hostile?[{type:'creep',user:'enemy'}]:[])
    ]},
    bot:{sessionStarted:session,sessionId:'W37N11-'+session,
      telemetryJournal:{events:[
        ...(fatal?[{c:'MAIN_FATAL',l:'ERROR',t:2399}]:[]),
        ...(error?[{c:'CREEP_EXCEPTION',l:'ERROR',t:2380}]:[]),
        ...(startupCritical?[{c:'CPU_BUCKET_CRITICAL',l:'WARN',t:2280}]:[]),
        ...(lateCritical?[{c:'CPU_BUCKET_CRITICAL',l:'WARN',t:2380}]:[])
      ],snapshots:noSnapshot?[]:[record],
      droppedThroughSeq:retention?50:0}},
    stats:noStats?null:{tick,bucket:currentBucket}};
}
let r=assessWorldStartup(fixture());
assert.equal(r.status,'PASS',JSON.stringify(r));
assert.equal(r.observedTicks,150);
assert.equal(r.ownedSpawn,true);
assert.equal(r.ownedController,true);
assert.equal(r.rcl,1);
assert.equal(r.roles.harvester,2);
assert.equal(r.minimumObservedBucket,10000);
assert.equal(r.maximumObservedCpu,5.3);
assert.equal(r.source,'AUTHENTICATED_SCREEPS_WORLD_GET_ONLY');
assert.equal(r.mutationsAttempted,false);
assert.equal(JSON.stringify(r).includes('mine'),false,
 'No account IDs, names or raw memory should appear');
for(const params of [
  [{tick:2290},'WAIT'],
  [{noSnapshot:true},'WAIT'],
  [{noStats:true},'WAIT'],
  [{retention:true},'WAIT'],
  [{owned:false},'FAIL'],
  [{spawn:false},'FAIL'],
  [{active:false},'FAIL'],
  [{fatal:true},'FAIL'],
  [{creeps:0},'FAIL'],
  [{bucket:999},'FAIL'],
  [{rcl:0},'FAIL'],
]){
  const result=assessWorldStartup(fixture(params[0]));
  assert.equal(result.status,params[1],JSON.stringify({params,result}));
}
// Initial World CPU bucket recovery: event before +100 ticks is a
// warning only if an actual post-100 snapshot and current bucket are healthy.
const warm=assessWorldStartup(fixture({startupCritical:true}));
assert.equal(warm.status,'PASS',JSON.stringify(warm));
assert.equal(warm.startupCriticalBucketEventCount,1);
assert.equal(warm.after100CriticalBucketEventCount,0);
assert.ok(warm.warnings.includes('CPU_BUCKET_CRITICAL_DURING_FIRST_100_TICKS'));
assert.equal(warm.fatalEventCodes.length,0);
const pendingWarm=assessWorldStartup(fixture({
  startupCritical:true,noSnapshot:true
}));
assert.equal(pendingWarm.status,'WAIT');
const postWarm=assessWorldStartup(fixture({lateCritical:true}));
assert.equal(postWarm.status,'FAIL');
assert.equal(postWarm.after100CriticalBucketEventCount,1);
const stillLow=assessWorldStartup(fixture({currentBucket:850}));
assert.equal(stillLow.status,'FAIL');
assert.ok(stillLow.failures.includes('CURRENT_CPU_BUCKET_STILL_CRITICAL'));
r=assessWorldStartup(fixture({hostile:true,error:true}));
assert.equal(r.status,'PASS');
assert.ok(r.warnings.includes('HOSTILE_CREEPS_CURRENTLY_PRESENT'));
assert.ok(r.warnings.includes('GAMEPLAY_ERROR_EVENTS_PRESENT'));

// RCL2 infrastructure observation is sampled evidence, not a command.
// Two spaced RCL2 snapshots without capacity/sites are an actionable WATCH.
{
 const sample=fixture({rcl:2});
 const newer=sample.bot.telemetryJournal.snapshots[0];
 Object.assign(newer.x.rooms.W37N11,{
   controllerProgress:20,constructionSites:0,energyCapacity:300
 });
 const earlier=structuredClone(newer);
 earlier.t=2300;
 earlier.x.rooms.W37N11.controllerProgress=5;
 sample.bot.telemetryJournal.snapshots.push(earlier);
 const result=assessWorldStartup(sample);
 assert.equal(result.status,'PASS');
 assert.equal(result.infrastructureProgress.rcl,2);
 assert.equal(result.infrastructureProgress.capacity,300);
 assert.equal(result.infrastructureProgress.controllerProgressDelta,15);
 assert.equal(result.infrastructureProgress.lowInfrastructureAtTwoRcl2Snapshots,true);
 assert.ok(result.warnings.includes(
   'RCL2_NO_EXTENSION_OR_CONSTRUCTION_SITE_IN_TWO_SNAPSHOTS'));
 const active=structuredClone(sample);
 active.bot.telemetryJournal.snapshots[0].x.rooms.W37N11.constructionSites=4;
 const activeResult=assessWorldStartup(active);
 assert.equal(activeResult.status,'PASS');
 assert.equal(activeResult.infrastructureProgress.constructionSites,4);
 assert.equal(activeResult.infrastructureProgress.lowInfrastructureAtTwoRcl2Snapshots,false);
 assert.equal(activeResult.warnings.includes(
   'RCL2_NO_EXTENSION_OR_CONSTRUCTION_SITE_IN_TWO_SNAPSHOTS'),false);
 const complete=structuredClone(sample);
 complete.bot.telemetryJournal.snapshots[0].x.rooms.W37N11.energyCapacity=350;
 assert.equal(assessWorldStartup(complete).infrastructureProgress
   .lowInfrastructureAtTwoRcl2Snapshots,false);
 const justLeveled=structuredClone(sample);
 justLeveled.bot.telemetryJournal.snapshots[1].x.rooms.W37N11.rcl=1;
 const leveled=assessWorldStartup(justLeveled);
 assert.equal(leveled.infrastructureProgress.controllerProgressDelta,null);
 assert.equal(leveled.infrastructureProgress.lowInfrastructureAtTwoRcl2Snapshots,false);
 const unknown=structuredClone(sample);
 delete unknown.bot.telemetryJournal.snapshots[0].x.rooms.W37N11.constructionSites;
 assert.equal(assessWorldStartup(unknown).infrastructureProgress
   .lowInfrastructureAtTwoRcl2Snapshots,false);
 assert.equal(summarizeWorldRcl2Growth([]).status,'UNKNOWN');
}
const calls=[];
let stats=0;
const api={defaultShard:'shard0',
  async authMe(){calls.push('GET_AUTH');return {_id:'mine'};},
  async userWorldStatus(){calls.push('GET_STATUS');return {status:'normal'};},
  async userBranches(){calls.push('GET_BRANCHES');return fixture().branches;},
  async gameRoomStatus(room,shard){
    calls.push('GET_ROOM_STATUS');assert.equal(shard,'shard0');return fixture().roomStatus;
  },
  async gameRoomObjects(room,shard){
    calls.push('GET_OBJECTS');assert.equal(room,'W37N11');
    assert.equal(shard,'shard0');return fixture().roomObjects;
  },
  async userMemory(name,shard){
    calls.push('GET_MEMORY_'+name);assert.equal(shard,'shard0');
    if(name==='bot')return {data:JSON.stringify(fixture().bot)};
    assert.equal(name,'stats');
    stats++;
    return {data:JSON.stringify({tick:stats===1?2300:2400})};
  }
};
const first=await inspectCurrentWorldStartup(api);
assert.equal(first.status,'WAIT');
let waits=0;
const complete=await observeWorldFor100Ticks(api,{
  maxChecks:2,delayMs:0,sleep:async()=>{waits++;}
});
assert.equal(complete.status,'PASS');
assert.equal(waits,0);
assert.ok(calls.every(c=>c.startsWith('GET')));
assert.equal(await observeWorldFor100Ticks({...api,defaultShard:'shard1'},{
  maxChecks:1,delayMs:0
}).then(x=>x.status),'INCOMPLETE',
 'Wrong shard must never yield a green pass');
console.log('World startup read-only 100T evidence and lifecycle guards: PASS');
