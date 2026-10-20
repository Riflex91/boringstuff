// D3 actual colony-defense audit. GET-only, identity-sanitized,
// no placement, spawns, combat intents, credential logging or server writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {parseBotMemory} from './ci-deployment-guard.mjs';
import {buildScreepsConfig} from './ci-deployment-credentials.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';

const target=[
 {server:'newbieland',shard:null,room:'E8N1',
  build:()=>buildScreepsConfig(process.env)},
 {server:'world',shard:'shard0',room:'W37S79',
  build:()=>buildWorldConfig(process.env)}
];
const safeInt=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const clean=x=>typeof x==='string'&&/^[A-Z0-9_]{2,60}$/.test(x)?x:null;
const types=new Set(['spawn','tower','storage','rampart']);
function energyAmount(item){
 const n=Number(item?.store?.energy ?? item?.energy);
 return Number.isFinite(n)&&n>=0?n:null;
}
function tally(objects,me) {
 const mine=x=>x&&me&&String(x.user||'')===String(me);
 const core=objects.filter(o=>mine(o)&&types.has(o.type||o.structureType)&&
  ['spawn','tower','storage'].includes(o.type||o.structureType));
 const ramps=objects.filter(o=>mine(o)&&
  (o.type==='rampart'||o.structureType==='rampart'));
 const sites=objects.filter(o=>mine(o)&&
  (o.type==='constructionSite'||o.type==='construction_site'));
 const counts=types=>types.map(t=>objects.filter(o=>mine(o)&&
  (o.type===t||o.structureType===t)).length);
 const countsMine=counts(['spawn','tower','rampart']);
 const coresCovered=core.filter(s=>ramps.some(w=>w.x===s.x&&w.y===s.y)).length;
 const coreSite=sites.filter(s=>s.structureType==='rampart'&&
  core.some(k=>k.x===s.x&&k.y===s.y)).length;
 const towers=objects.filter(x=>mine(x)&&(x.type==='tower'||x.structureType==='tower'));
 const levels=towers.map(energyAmount).filter(x=>x!==null);
 const creeps=objects.filter(x=>mine(x)&&x.type==='creep');
 const defenders=creeps.filter(x=>x.memory?.role==='defender').length;
 const unidentified=creeps.filter(x=>!x.memory?.role).length;
 const hostile=objects.filter(x=>x.type==='creep'&&!mine(x)&&x.user!=null);
 const controller=objects.find(x=>x.type==='controller');
 return {rcl:safeInt(controller?.level),
  ownedSpawns:countsMine[0],ownedTowers:countsMine[1],
  ownedRamparts:countsMine[2],criticalCoreStructures:core.length,
  coreStructuresWithExistingRampart:coresCovered,
  pendingCoreRampartSites:coreSite,
  pendingSpawnSites:sites.filter(s=>s.structureType==='spawn').length,
  ownedCreeps:creeps.length,
  confirmedDefenders:defenders,creepsWithoutRoleInResponse:unidentified,
  visibleHostileCreeps:hostile.length,
  towerEnergyFloor:levels.length?Math.min(...levels):null,
  towerEnergyMax:levels.length?Math.max(...levels):null,
  totalTowerEnergy:levels.length?levels.reduce((x,y)=>x+y,0):null,
  towerEnergySamples:levels.length
 };
}
function latestSnapshots(bot,room){
 const markers=bot?.deploymentTick;
 return Array.isArray(bot?.telemetryJournal?.snapshots)
  ? bot.telemetryJournal.snapshots.filter(s=>s?.c==='STATUS_SNAPSHOT'&&
     safeInt(s.t)!==null && (!safeInt(markers)||s.t>=markers) &&
     s.x?.rooms?.[room])
     .sort((a,b)=>b.t-a.t).slice(0,3).map(s=>{
       const x=s.x.rooms[room];
       const d=x.spawnParallelExecution||{};
       const rec=x.spawnParallelReconciliation||{};
       const fleet=x.spawnFleet||{};
       return {tick:s.t,hostiles:safeInt(x.hostiles),
         defenderCount:safeInt(x.creeps?.defender),
         executionStatus:clean(d.status),executionReason:clean(d.reason),
         acceptedParallelIntents:safeInt(d.acceptedCount),
         observedReconciliationStatus:clean(rec.status),
         verifiedSpawnJobs:safeInt(rec.observedJobs),
         fleetSize:safeInt(fleet.fleetSize),
         activeSafeModeTicks:safeInt(x.safeModeRemainingTicks)
       };
     }) :[];
}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'screeps-defense-audit-'));
try{
 for(const t of target){
  try{
   const name=path.join(tmp,t.server+'.json');
   fs.writeFileSync(name,JSON.stringify(t.build()),{mode:0o600,flag:'wx'});
   const api=await ScreepsHttpClient.fromConfig(t.server,
     {file:name,shard:t.shard});
   const [account,objects,branches,raw]=await Promise.all([
     api.authMe(),api.gameRoomObjects(t.room,t.shard),
     api.userBranches(),api.userMemory('bot',t.shard)
   ]);
   const me=account?._id||account?.id;
   const arr=Array.isArray(objects?.objects)?objects.objects:[];
   const bot=parseBotMemory(raw);
   const active=Array.isArray(branches?.list)?branches.list.filter(b=>b.activeWorld===true):[];
   console.log('D3_DEFENSE_LIVE_GET '+JSON.stringify({
     server:t.server,room:t.room,shard:t.shard,
     activeBranch:active.length===1?active[0].branch:null,
     deploymentTick:safeInt(bot?.deploymentTick),
     observable:tally(arr,me),snapshots:latestSnapshots(bot,t.room),
     source:'AUTHENTIC_GAME_ROOM_OBJECTS_AND_MEMORY',gameWrites:0
   }));
  }catch(_){
   console.log('D3_DEFENSE_LIVE_GET '+JSON.stringify({
     server:t.server,room:t.room,
     status:'READ_ONLY_UNAVAILABLE',source:'NO_VERIFIED_EVIDENCE',gameWrites:0
   }));
  }
 }
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
