import {gunzipSync} from 'node:zlib';

/**
 * Screeps' read-only Memory API may return nested JSON or compressed gz: data.
 * Never include decoded user memory or raw exceptions in exported evidence.
 */
export function decodeWorldMemory(raw) {
  let value=raw;
  for(let i=0;i<7;i++) {
    if(typeof value==='string') {
      try {
        const source=value.startsWith('gz:')
          ?gunzipSync(Buffer.from(value.slice(3),'base64'),{
            maxOutputLength:4_000_000
          }).toString('utf8')
          :value;
        value=JSON.parse(source);
      } catch {return null;}
      continue;
    }
    if(!value||typeof value!=='object'||Array.isArray(value)||
       value.ok===false)return null;
    if(Object.prototype.hasOwnProperty.call(value,'data')){
      value=value.data;continue;
    }
    return value;
  }
  return null;
}

const ROOM='W37N11';
const SHARD='shard0';
const fatalCodes=new Set(['MAIN_FATAL','CPU_BUCKET_CRITICAL',
  'CREEP_EXCEPTION','SPAWN_RC']);

function latestRecord(items,code,atLeast=0) {
  if(!Array.isArray(items))return null;
  return items.filter(e=>e?.c===code &&
    Number.isInteger(e?.t)&&e.t>=atLeast)
    .sort((a,b)=>b.t-a.t)[0]||null;
}

export function assessWorldStartup({
  account,world,branches,roomStatus,roomObjects,
  bot,stats,nowVerified
}={}) {
  const failures=[],missing=[],warnings=[];
  const myId=account?._id||account?.id;
  if(!myId || account?.ok===false)failures.push('WORLD_ACCOUNT_NOT_AUTHENTICATED');
  if(world?.status!=='normal')failures.push('WORLD_ACCOUNT_NOT_ACTIVE');
  if(roomStatus?.room?.status!=='normal'&&roomStatus?.status!=='normal')
    failures.push('ROOM_NOT_NORMAL');
  const list=Array.isArray(branches?.list)?branches.list:[];
  const active=list.filter(b=>b?.activeWorld===true);
  if(active.length!==1||active[0]?.branch!=='chatgpt')
    failures.push('CHATGPT_NOT_SOLE_ACTIVE_WORLD_BRANCH');
  const objects=Array.isArray(roomObjects?.objects)?roomObjects.objects:null;
  if(!objects)failures.push('ROOM_OBJECTS_UNAVAILABLE');
  const ownedSpawn=Boolean(objects?.some(o=>
    (o.type==='spawn'||o.structureType==='spawn') &&
    o.name==='Spawn1'&&o.x===12&&o.y===13&&
    String(o.user||'')===String(myId)));
  if(!ownedSpawn)failures.push('PINNED_OWNED_SPAWN_MISSING');
  const controller=objects?.find(o=>o?.type==='controller');
  const ownedController=Boolean(controller&&String(controller.user||'')===String(myId));
  if(!ownedController)failures.push('CONTROLLER_OWNERSHIP_UNVERIFIED');
  const ownCreeps=objects?objects.filter(o=>
    o?.type==='creep'&&String(o.user||'')===String(myId)).length:null;
  const hostiles=objects?objects.filter(o=>
    o?.type==='creep'&&o.user&&String(o.user)!==String(myId)).length:null;
  const sessionStart=Number(bot?.sessionStarted);
  const sessionId=bot?.sessionId;
  if(!Number.isInteger(sessionStart)||sessionStart<=0||
     typeof sessionId!=='string'||!sessionId.startsWith(ROOM+'-'))
    missing.push('NEW_WORLD_COLONY_SESSION_NOT_VERIFIED');
  const statTick=Number(stats?.tick);
  if(!Number.isInteger(statTick)||statTick<=0)
    missing.push('STATS_TICK_UNAVAILABLE');
  const journal=bot?.telemetryJournal;
  if(!journal||typeof journal!=='object')missing.push('TELEMETRY_JOURNAL_UNAVAILABLE');
  const allEvents=Array.isArray(journal?.events)?journal.events:[];
  const snapshots=Array.isArray(journal?.snapshots)?journal.snapshots:[];
  const elapsed=Number.isInteger(sessionStart)&&sessionStart>0&&
    Number.isInteger(statTick)&&statTick>=sessionStart
      ?statTick-sessionStart:null;
  const minTick=Number.isInteger(sessionStart)?sessionStart+100:null;
  if(elapsed===null||elapsed<100)
    missing.push('HUNDRED_REAL_WORLD_TICKS_NOT_OBSERVED');
  const statusRecords=Number.isInteger(sessionStart)?
    snapshots.filter(s=>s?.c==='STATUS_SNAPSHOT'&&
      Number.isInteger(s?.t)&&s.t>=sessionStart&&
      s.t<=statTick&&s.x&&typeof s.x==='object' &&
      s.x.rooms&&typeof s.x.rooms[ROOM]==='object')
      .sort((a,b)=>a.t-b.t):[];
  const after100=Number.isInteger(minTick)
    ?latestRecord(statusRecords,'STATUS_SNAPSHOT',minTick):null;
  if(!after100)missing.push('POST_100T_ROOM_STATUS_SNAPSHOT_MISSING');
  const during=Number.isInteger(sessionStart)?
    allEvents.filter(e=>Number.isInteger(e?.t)&&
      e.t>=sessionStart&&e.t<=statTick):[];
  const fatal=during.filter(e=>e?.l==='FATAL'||e?.c==='MAIN_FATAL');
  const bucketEvents=during.filter(e=>e?.c==='CPU_BUCKET_CRITICAL');
  const startupBucketEvents=Number.isInteger(minTick)?
    bucketEvents.filter(e=>e.t<minTick):[];
  const postStartupBucketEvents=Number.isInteger(minTick)?
    bucketEvents.filter(e=>e.t>=minTick):bucketEvents;
  // First-spawn CPU buckets can start unfilled. Preserve the warning but
  // require a post-100-tick healthy snapshot before declaring recovery.
  if(fatal.length||postStartupBucketEvents.length)
    failures.push('WORLD_RUNTIME_FATAL_OR_CRITICAL_CPU');
  if(startupBucketEvents.length)
    warnings.push('CPU_BUCKET_CRITICAL_DURING_FIRST_100_TICKS');
  const otherErrors=during.filter(e=>e?.l==='ERROR'||
    (fatalCodes.has(e?.c)&&e?.c!=='CPU_BUCKET_CRITICAL'))
    .map(e=>e.c).filter(Boolean);
  if(otherErrors.length)warnings.push('GAMEPLAY_ERROR_EVENTS_PRESENT');
  if(Number(journal?.droppedThroughSeq)>0)
    missing.push('TELEMETRY_RETENTION_GAP_UNVERIFIED');
  const cpuSamples=statusRecords.map(s=>({
    tick:s.t,cpu:Number(s.x.cpu),bucket:Number(s.x.bucket)
  }));
  if(after100&&(!Number.isFinite(Number(after100.x.cpu))||
     !Number.isFinite(Number(after100.x.bucket))))
    failures.push('CPU_SNAPSHOT_INVALID');
  // The post-warmup 100T window is authoritative. Never hide an ongoing
  // bucket emergency by averaging it with older pre-warmup observations.
  if(cpuSamples.some(s=>s.tick>=minTick&&
      Number.isFinite(s.bucket)&&s.bucket<1000))
    failures.push('OBSERVED_POST_STARTUP_CRITICAL_BUCKET');
  const currentBucket=Number(stats?.bucket);
  if(Number.isFinite(currentBucket)&&currentBucket<1000&&elapsed>=100)
    failures.push('CURRENT_CPU_BUCKET_STILL_CRITICAL');
  const latestRoom=after100?.x?.rooms?.[ROOM]||null;
  const roleCounts=latestRoom?.creeps;
  const roles=roleCounts&&typeof roleCounts==='object'&&!Array.isArray(roleCounts)
    ?Object.fromEntries(Object.entries(roleCounts).filter(([r,n])=>
      /^[a-z]+$/.test(r)&&Number.isInteger(n)&&n>=0)):null;
  const activeRoles=roles?Object.values(roles).reduce((a,n)=>a+n,0):null;
  const spawning=typeof latestRoom?.spawnBusy==='boolean'?
    latestRoom.spawnBusy:null;
  if(after100&&(!Number.isInteger(latestRoom?.rcl)||latestRoom.rcl<1))
    failures.push('WORLD_RCL_INVALID');
  if(after100&&activeRoles===null)
    missing.push('CREEP_ROLE_COUNTS_UNAVAILABLE');
  if(after100&&activeRoles===0&&spawning!==true)
    failures.push('NO_CREEPS_OR_SPAWN_ACTIVITY_AFTER_100T');
  if(hostiles>0)warnings.push('HOSTILE_CREEPS_CURRENTLY_PRESENT');
  const minBucket=cpuSamples.length
    ?Math.min(...cpuSamples.filter(s=>Number.isFinite(s.bucket))
      .map(s=>s.bucket)):null;
  const maxCpu=cpuSamples.length
    ?Math.max(...cpuSamples.filter(s=>Number.isFinite(s.cpu))
      .map(s=>s.cpu)):null;
  if(minBucket!==null&&!Number.isFinite(minBucket))missing.push('CPU_BUCKET_UNVERIFIED');
  if(maxCpu!==null&&!Number.isFinite(maxCpu))missing.push('CPU_USED_UNVERIFIED');
  const status=failures.length?'FAIL':missing.length?'WAIT':'PASS';
  return {status,reason:status==='PASS'?'LIVE_WORLD_100T_VERIFIED':
    status==='FAIL'?'WORLD_RUNTIME_OR_OWNERSHIP_GATE_FAILED':
      'WORLD_RUNTIME_EVIDENCE_PENDING',
    failures:[...new Set(failures)],missing:[...new Set(missing)],
    warnings:[...new Set(warnings)],
    target:{shard:SHARD,room:ROOM,spawn:'Spawn1',x:12,y:13},
    sessionTick:Number.isInteger(sessionStart)&&sessionStart>0?sessionStart:null,
    currentTick:Number.isInteger(statTick)&&statTick>0?statTick:null,
    observedTicks:elapsed,latestRoomSnapshotTick:after100?.t||null,
    rcl:latestRoom?.rcl??null,roles,spawnBusy:spawning,
    energyAvailable:latestRoom?.energyAvailable??null,
    energyCapacity:latestRoom?.energyCapacity??null,
    ownedSpawn,ownedController,ownCreeps,hostiles,
    minimumObservedBucket:Number.isFinite(minBucket)?minBucket:null,
    maximumObservedCpu:Number.isFinite(maxCpu)?maxCpu:null,
    snapshotCount:statusRecords.length,
    latestAvailableRoomSnapshotTick:statusRecords.at(-1)?.t||null,
    startupCriticalBucketEventCount:startupBucketEvents.length,
    after100CriticalBucketEventCount:postStartupBucketEvents.length,
    currentCpuBucket:Number.isFinite(currentBucket)?currentBucket:null,
    fatalEventCodes:[...new Set([...fatal,...postStartupBucketEvents].map(e=>e.c))],
    errorEventCodes:[...new Set(otherErrors)].slice(0,12),
    // No raw Screeps tokens, user identifiers, actor names or full memory.
    source:'AUTHENTICATED_SCREEPS_WORLD_GET_ONLY',
    mutationsAttempted:false};
}
