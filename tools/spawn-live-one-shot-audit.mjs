// One-shot GET-only Screeps live Spawn telemetry, never makes game mutations.
// Runtime data is treated as untrusted and only aggregate whitelisted fields
// are printed; credential material and Creep/Spawn identities remain private.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {parseBotMemory} from './ci-deployment-guard.mjs';
import {buildScreepsConfig} from './ci-deployment-credentials.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';

const target=[
  {server:'newbieland',room:'E8N1',shard:null,
    config:()=>buildScreepsConfig(process.env)},
  {server:'world',room:'W37S79',shard:'shard0',
    config:()=>buildWorldConfig(process.env)}
];
function int(v) { return Number.isSafeInteger(v) && v>=0 ? v : null; }
function flag(v) { return typeof v==='boolean' ? v : null; }
function boundedStatus(v) {
  return typeof v==='string' && /^[A-Z0-9_]{2,42}$/.test(v) ? v : null;
}
function snapshot(x) {
  if(!x || typeof x!=='object') return null;
  const f=x.spawnFleet||{},a=x.spawnParallelExecution||{},
    p=x.spawnParallel||{},e=x.spawnParallelReconciliation||{};
  return {
    actualEnergy:int(x.energyAvailable),capacity:int(x.energyCapacity),
    rcl:int(x.rcl),
    fleet:{size:int(f.fleetSize),busy:int(f.busy),idle:int(f.idleAvailable),
      inactive:int(f.inactive),unknown:int(f.unknown),
      hasIdleCapacity:flag(f.hasIdleCapacity)},
    planning:{status:boundedStatus(p.status),plannedCount:int(p.plannedCount),
      reservedEnergy:int(p.reservedEnergy)},
    execution:{status:boundedStatus(a.status),reason:boundedStatus(a.reason),
      acceptedCount:int(a.acceptedCount),attemptedCount:int(a.attemptedCount),
      spentEnergy:int(a.spentEnergy)},
    reconciliation:{status:boundedStatus(e.status),
      verifiedJobs:int(e.observedJobs),verifiedCreeps:int(e.observedCreeps),
      unobserved:int(e.notObserved),unknown:int(e.unknown)}
  };
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'screeps-live-spawn-audit-'));
try {
 for(const t of target){
  try {
   const configFile=path.join(dir,t.server+'.json');
   fs.writeFileSync(configFile,JSON.stringify(t.config()),{mode:0o600,flag:'wx'});
   const api=await ScreepsHttpClient.fromConfig(t.server,
     {file:configFile,shard:t.shard});
   const [memoryResult,roomResult,accountResult]=await Promise.all([
     api.userMemory('bot',t.shard),
     api.gameRoomObjects(t.room,t.shard),
     api.authMe()
   ]);
   const bot=parseBotMemory(memoryResult);
   const accountId=accountResult?._id||accountResult?.id;
   const objects=Array.isArray(roomResult?.objects)?roomResult.objects:[];
   const own=objects.filter(o=>o &&
     (o.type==='spawn'||o.structureType==='spawn') &&
     accountId && String(o.user)===String(accountId));
   const jobs=own.filter(o=>o.spawning && typeof o.spawning==='object').length;
   const since=int(bot?.deploymentTick);
   const samples=Array.isArray(bot?.telemetryJournal?.snapshots)
      ? bot.telemetryJournal.snapshots
        .filter(s=>s && s.c==='STATUS_SNAPSHOT' &&
          Number.isSafeInteger(s.t) && (since===null || s.t>=since) &&
          s.x && s.x.rooms && s.x.rooms[t.room])
        .sort((a,b)=>b.t-a.t).slice(0,4)
        .map(s=>({tick:s.t,room:snapshot(s.x.rooms[t.room])}))
      : [];
   const beats=Array.isArray(bot?.telemetryJournal?.events)
     ? bot.telemetryJournal.events.filter(e=>
       e && e.c==='ROOM_HEARTBEAT' && (!since || e.t>=since) &&
       e.x && e.x.room===t.room)
       .sort((a,b)=>b.t-a.t).slice(0,4)
       .map(e=>({tick:int(e.t),room:snapshot(e.x)}))
     : [];
   console.log('SPAWN_REAL_TICK_AUDIT '+JSON.stringify({
      server:t.server,shard:t.shard,room:t.room,
      inspectedOwnedSpawns:own.length,inspectedActiveJobs:jobs,
      deploymentTick:since,samples,heartbeats:beats,
      conclusion:samples.length||beats.length?'RUNTIME_SAMPLES':'NO_STATUS_SAMPLES'
   }));
  } catch(err) {
   console.log('SPAWN_REAL_TICK_AUDIT '+JSON.stringify({
    server:t.server,room:t.room,conclusion:'READ_ONLY_UNAVAILABLE',
    error:'QUERY_OR_AUTH_FAILED'
   }));
  }
 }
} finally {
 fs.rmSync(dir,{recursive:true,force:true});
}
