import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {decodeWorldMemory,assessWorldStartup,assessRetainedWorldWindow,summarizeWorldRcl2Growth,summarizeLiveWorldConstructionSites} from './world-postlaunch-monitor-core.mjs';
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

// The live room GET, not cadence snapshots, identifies the actual queued types.
{
 const x=fixture({rcl:2});
 x.bot.telemetryJournal.snapshots[0].x.rooms.W37N11.energyCapacity=300;
 x.roomObjects.objects.push(...Array.from({length:8},(_,i)=>({
   type:'constructionSite',user:'mine',structureType:'road',x:20+i,y:10
 })));
 const report=assessWorldStartup(x);
 assert.equal(report.status,'PASS');
 assert.equal(report.liveConstructionSites.status,'VERIFIED');
 assert.equal(report.liveConstructionSites.ownedCount,8);
 assert.equal(report.liveConstructionSites.byType.road,8);
 assert.equal(report.liveConstructionSites.progressEvidence,'PARTIAL');
 assert.equal(report.liveConstructionSites.unknownProgressSites,8);
 assert.equal(report.liveConstructionSites.progressCompleted,null,
   'Missing API progress fields are unknown, never reported as zero work');
 const progressed=structuredClone(x);
 for(let i=0;i<8;i++){
   const site=progressed.roomObjects.objects.filter(o=>
     o.type==='constructionSite')[i];
   site.progress=100*i;
   site.progressTotal=1000;
 }
 const progress=assessWorldStartup(progressed).liveConstructionSites;
 assert.equal(progress.progressEvidence,'VERIFIED');
 assert.equal(progress.knownProgressSites,8);
 assert.equal(progress.unknownProgressSites,0);
 assert.equal(progress.progressCompleted,2800);
 assert.equal(progress.progressTotal,8000);
 assert.equal(progress.progressRemaining,5200);
 const invalid=structuredClone(progressed);
 invalid.roomObjects.objects.at(-1).progress=1001;
 assert.equal(assessWorldStartup(invalid).liveConstructionSites.progressEvidence,
   'PARTIAL','A site beyond progressTotal invalidates aggregate sums');
 assert.equal(assessWorldStartup(invalid).liveConstructionSites.progressTotal,
   null);
 const ownedAndForeign=structuredClone(progressed);
 ownedAndForeign.roomObjects.objects.push({
   type:'constructionSite',user:'foreign-account',structureType:'road',
   progress:999,progressTotal:1000
 });
 const safe=assessWorldStartup(ownedAndForeign).liveConstructionSites;
 assert.equal(safe.progressEvidence,'VERIFIED');
 assert.equal(safe.progressCompleted,2800,
   'Foreign construction work must never enter our totals');

 assert.ok(report.warnings.includes('RCL2_LIVE_ROAD_SITES_COMPETE_WITH_EXTENSIONS'),
  'Eight real own road sites block the RCL2 critical-build slots');
 assert.equal(JSON.stringify(report).includes('mine'),false,
  'No World account IDs may escape into the sanitized receipt');
 const critical=structuredClone(x);
 critical.roomObjects.objects=critical.roomObjects.objects.filter(o=>
   o.type!=='constructionSite');
 critical.roomObjects.objects.push(
   ...Array.from({length:5},(_,i)=>({
     type:'constructionSite',user:'mine',structureType:'extension',x:22+i,y:12
   })),
   ...Array.from({length:3},(_,i)=>({
     type:'constructionSite',user:'mine',structureType:'container',x:28+i,y:13
   })));
 const criticalReport=assessWorldStartup(critical);
 assert.equal(criticalReport.status,'PASS');
 assert.equal(criticalReport.liveConstructionSites.ownedCount,8);
 assert.equal(criticalReport.liveConstructionSites.byType.extension,5);
 assert.equal(criticalReport.liveConstructionSites.byType.container,3);
 assert.equal(criticalReport.warnings.includes(
  'RCL2_LIVE_ROAD_SITES_COMPETE_WITH_EXTENSIONS'),false);
 const unknown=structuredClone(x);
 delete unknown.roomObjects.objects.at(-1).user;
 const partial=assessWorldStartup(unknown);
 assert.equal(partial.liveConstructionSites.status,'PARTIAL');
 assert.equal(partial.liveConstructionSites.unknownOwnerCount,1);
 assert.equal(partial.warnings.includes(
  'RCL2_LIVE_ROAD_SITES_COMPETE_WITH_EXTENSIONS'),false,
  'Unknown site ownership must not produce a confident diagnosis');
 const foreign=structuredClone(x);
 foreign.roomObjects.objects.at(-1).user='foreign-account';
 const foreignReport=assessWorldStartup(foreign);
 assert.equal(foreignReport.liveConstructionSites.foreignCount,1);
 assert.equal(foreignReport.liveConstructionSites.ownedCount,7);
 assert.equal(foreignReport.warnings.includes(
  'RCL2_LIVE_ROAD_SITES_COMPETE_WITH_EXTENSIONS'),false);
 const grown=structuredClone(x);
 grown.bot.telemetryJournal.snapshots[0].x.rooms.W37N11.energyCapacity=350;
 assert.equal(assessWorldStartup(grown).warnings.includes(
  'RCL2_LIVE_ROAD_SITES_COMPETE_WITH_EXTENSIONS'),false);
 const previous=structuredClone(x);
 previous.bot.telemetryJournal.snapshots[0].x.rooms.W37N11.rcl=3;
 assert.equal(assessWorldStartup(previous).warnings.includes(
  'RCL2_LIVE_ROAD_SITES_COMPETE_WITH_EXTENSIONS'),false);
 assert.equal(summarizeLiveWorldConstructionSites(null,'mine').status,'UNKNOWN');
}

// A sticky droppedThroughSeq proves historic pruning, NOT continuous loss.
// Prove an entirely retained, contiguous, current 100-tick journal window.
{
  const x=fixture();
  const j=x.bot.telemetryJournal;
  const firstSnapshot=structuredClone(j.snapshots[0]);
  firstSnapshot.t=2300;
  firstSnapshot.q=52;
  j.modelVersion=1;
  j.droppedThroughSeq=50;
  j.nextSeq=54;
  j.events=[{q:51,t:2280,c:'ROOM_HEARTBEAT',l:'INFO'}];
  j.snapshots=[firstSnapshot,{...structuredClone(firstSnapshot),q:53,t:2400}];
  const window=assessRetainedWorldWindow(j,2250,2400);
  assert.equal(window.status,'COMPLETE',JSON.stringify(window));
  assert.equal(window.startTick,2281);
  assert.equal(window.observedTicks,119);
  const verified=assessWorldStartup(x);
  assert.equal(verified.status,'PASS',JSON.stringify(verified));
  assert.equal(verified.verifiedWindowStartTick,2281);
  assert.equal(verified.verifiedWindowObservedTicks,119);
  assert.equal(verified.historicalTelemetryPruned,true);
  assert.equal(verified.verifiedJournalRecordCount,3);
  assert.ok(verified.warnings.includes(
    'HISTORICAL_TELEMETRY_PRUNED_ROLLING_WINDOW_VERIFIED'));
  assert.equal(verified.latestRoomSnapshotTick,2400);
  assert.equal(verified.minimumObservedBucket,10000);

  const broken=structuredClone(x);
  broken.bot.telemetryJournal.snapshots[0].q=54;
  assert.equal(assessWorldStartup(broken).status,'WAIT',
    'Sequence gaps after the last discarded record block green health');
  assert.ok(assessWorldStartup(broken).missing.includes(
    'TELEMETRY_RETENTION_GAP_UNVERIFIED'));
  const duplicate=structuredClone(x);
  duplicate.bot.telemetryJournal.snapshots[0].q=51;
  assert.equal(assessWorldStartup(duplicate).status,'WAIT');
  const retrograde=structuredClone(x);
  retrograde.bot.telemetryJournal.snapshots[1].t=2279;
  assert.equal(assessWorldStartup(retrograde).status,'WAIT',
    'Tick order must also be proven monotonically increasing with sequence');
  const unknown=structuredClone(x);
  delete unknown.bot.telemetryJournal.nextSeq;
  assert.equal(assessWorldStartup(unknown).status,'WAIT');
  const missingModel=structuredClone(x);
  delete missingModel.bot.telemetryJournal.modelVersion;
  assert.equal(assessWorldStartup(missingModel).status,'WAIT');
  const freshGap=structuredClone(x);
  freshGap.bot.telemetryJournal.events[0].t=2350;
  freshGap.bot.telemetryJournal.snapshots[0].t=2360;
  assert.equal(assessWorldStartup(freshGap).status,'WAIT',
    'Only 49 subsequent ticks: wait for a real retained 100T window');
  const noRecentSnapshot=structuredClone(x);
  noRecentSnapshot.bot.telemetryJournal.snapshots.pop();
  noRecentSnapshot.bot.telemetryJournal.nextSeq=53;
  assert.equal(assessWorldStartup(noRecentSnapshot).status,'WAIT',
    'Contiguous journal without post-100 snapshot cannot pass');
  const fatal=structuredClone(x);
  fatal.bot.telemetryJournal.events.push({
    q:54,t:2330,c:'MAIN_FATAL',l:'FATAL'
  });
  fatal.bot.telemetryJournal.nextSeq=55;
  assert.equal(assessWorldStartup(fatal).status,'FAIL',
    'Any retained real fatal within verified window must fail');
  const bucket=structuredClone(x);
  bucket.bot.telemetryJournal.events.push({
    q:54,t:2350,c:'CPU_BUCKET_CRITICAL',l:'WARN'
  });
  bucket.bot.telemetryJournal.nextSeq=55;
  assert.equal(assessWorldStartup(bucket).status,'FAIL',
    'A current low CPU event after warmup is not historical pruning');

  // An old record may still be present from a different bounded bucket,
  // despite the greatest discarded sequence belonging to another bucket.
  const older=structuredClone(x);
  older.bot.telemetryJournal.events.push({
    q:49,t:2255,c:'MAIN_FATAL',l:'FATAL'
  });
  const oldButNotCurrent=assessWorldStartup(older);
  assert.equal(oldButNotCurrent.status,'PASS',
    'Older retained events must not masquerade as errors in fresh 100T window');
  assert.equal(oldButNotCurrent.fatalEventCodes.length,0);
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
