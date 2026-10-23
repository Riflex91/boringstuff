import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {inspectWorldRecoveryEvidence} from './world-recovery-evidence.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {WORLD_NEXT_TARGET_CANDIDATE as target} from './world-next-target-candidate.mjs';
import {STAGING_BRANCH} from './world-next-staged-readiness.mjs';
import {WORLD_PROFILE} from './world-deployment-profile.mjs';
// R1 recovery can record a Spawn-site intent while the retained workforce
// has no modeled harvest throughput and construction is stalled. An upgrader
// has WORK/CARRY/MOVE, but the current role.worker upgrader path always
// upgrades the controller; that is NOT proof of available build execution.
// This is a bounded historical hypothesis, never a live builder count.
function retainedRecoveryConstructionRisk(evidence) {
  const events=Array.isArray(evidence?.events)?evidence.events:[];
  const snapshotTick=evidence?.latestSnapshotTick;
  const home=evidence?.expansion?.home;
  const intent=events.filter(e=>e.code==='R1_OWNED_SPAWN_REBUILD_SITE_INTENT'&&
    e.room===target.room&&Number.isSafeInteger(e.tick)&&
    Number.isSafeInteger(snapshotTick)&&e.tick<=snapshotTick)
    .reduce((best,e)=>!best||e.tick>best.tick?e:best,null);
  // A confirmation recorded after the retained STATUS_SNAPSHOT cannot
  // disprove the construction stall observed at that earlier snapshot.
  // Keep the event window bounded; this is historical risk, not live state.
  const confirmed=intent&&events.some(e=>
    e.code==='R1_OWNED_SPAWN_REBUILD_CONFIRMED'&&
    e.room===target.room&&Number.isSafeInteger(e.tick)&&
    e.tick>=intent.tick&&e.tick<=snapshotTick);
  const atRisk=Boolean(intent&&!confirmed&&
    home?.room===target.room&&
    home?.healthReasons?.includes('CONSTRUCTION_STALLED')&&
    Number.isSafeInteger(home.upgraderCount)&&home.upgraderCount>0&&
    home.harvestedCapacityPerTick===0&&
    Number.isSafeInteger(home.constructionSites)&&home.constructionSites>0);
  return {
    status:atRisk?'POTENTIAL_STALL':'UNVERIFIED',
    evidenceType:'RETAINED_STATUS_SNAPSHOT_AND_EVENTS_ONLY',
    lastSnapshotTick:Number.isSafeInteger(snapshotTick)?snapshotTick:null,
    lastSiteIntentTick:intent?.tick??null,
    currentBuilderAvailability:'UNVERIFIED',
    executionAuthority:false
  };
}
// A room GET with no owned creeps and a *retained* construction-stalled
// snapshot is a recovery continuity warning, not proof of current build
// execution or of a server-wide creep census. A missing/failed room GET,
// unknown owner, or unverified pinned Spawn cannot establish this signal.
function currentRoomCrewConstructionRisk({id,room,spawn,creeps,evidence}) {
  const currentObserved=Boolean(id)&&Boolean(spawn)&&Array.isArray(room?.objects);
  const home=evidence?.expansion?.home;
  const snapshotTick=evidence?.latestSnapshotTick;
  const retainedStall=Number.isSafeInteger(snapshotTick)&&snapshotTick>=0&&
    home?.room===target.room&&
    home?.healthReasons?.includes('CONSTRUCTION_STALLED')&&
    home.harvestedCapacityPerTick===0&&
    Number.isSafeInteger(home.constructionSites)&&home.constructionSites>0;
  return {
    status:currentObserved&&creeps.length===0&&retainedStall?
      'POTENTIAL_STALL':'UNVERIFIED',
    evidenceType:'PINNED_ROOM_GET_CREW_PLUS_RETAINED_STATUS_SNAPSHOT',
    observedRoomCreepCount:currentObserved?creeps.length:null,
    lastSnapshotTick:Number.isSafeInteger(snapshotTick)?snapshotTick:null,
    executionAuthority:false
  };
}
export function assessWorldRuntime({me,branches,status,room,memory},
  expectedActiveBranch=STAGING_BRANCH){
  const failures=[],warnings=[];
  const id=me?._id||me?.id;
  const ownerVerified=typeof id==='string'&&id.length>0;
  const roomObjectsVerified=Array.isArray(room?.objects);
  if(!ownerVerified)failures.push('AUTH_UNVERIFIED');
  const list=Array.isArray(branches?.list)?branches.list:[];
  const active=list.filter(b=>b?.activeWorld===true);
  if(active.length!==1||active[0]?.branch!==expectedActiveBranch)failures.push('EXPECTED_BRANCH_NOT_ACTIVE');
  if(status?.status==='empty'||typeof status?.status!=='string')failures.push('WORLD_STATUS_INVALID');
  if(!roomObjectsVerified)failures.push('ROOM_OBJECTS_UNAVAILABLE');
  const objects=roomObjectsVerified?room.objects:[];
  const spawn=ownerVerified&&roomObjectsVerified?objects.find(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&
    o.x===target.x&&o.y===target.y&&o.name===target.spawnName&&
    String(o.user||'')===id):null;
  // Failed owner/room GET cannot establish that a Spawn or crew is absent.
  if(ownerVerified&&roomObjectsVerified&&!spawn)
    failures.push('OWNED_PINNED_SPAWN_MISSING');
  const creeps=ownerVerified&&roomObjectsVerified?
    objects.filter(o=>o?.type==='creep'&&String(o.user||'')===id):[];
  // Creep memory is untrusted. A null-prototype counter prevents inherited
  // names such as constructor/__proto__ from corrupting role observations.
  const ownedCreepRoles=Object.create(null);
  for(const creep of creeps) {
    const role=creep?.memory?.role;
    if(typeof role==='string'&&role.length>0&&role.length<50)
      ownedCreepRoles[role]=(ownedCreepRoles[role]||0)+1;
  }
  const controller=objects.find(o=>o?.type==='controller');
  if(roomObjectsVerified&&!controller)warnings.push('CONTROLLER_NOT_OBSERVED');
  if(ownerVerified&&roomObjectsVerified&&!creeps.length)
    warnings.push('NO_OWNED_CREEPS_OBSERVED');
  // Do not coerce absent/null/string GET fields into fabricated energy.
  // A zero is evidence only when the API supplied an actual numeric zero.
  const energy=spawn?.energy;
  const capacity=spawn?.energyCapacity;
  const recoveryEvidence=inspectWorldRecoveryEvidence(memory);
  if(recoveryEvidence.availability==='UNKNOWN')
    warnings.push('RECOVERY_MEMORY_UNVERIFIED');
  // A successful GET-only inspection is not proof that the World is deployable.
  // The server's current status and observed spawn are independent of older
  // retained STATUS_SNAPSHOT health reasons. Never grant execution authority.
  // Any failed prerequisite makes operational readiness HOLD, even when
  // World status itself is normal. An unsuccessful GET inspection must not
  // be presented as an otherwise unblocked operational observation.
  const operationalReasons=[...failures];
  if(status?.status!=='normal')operationalReasons.push('WORLD_STATUS_NOT_NORMAL');
  // OWNED_PINNED_SPAWN_MISSING is already included in failures above.
  if(recoveryEvidence.expansion?.home?.healthReasons?.includes('SPAWN_MISSING'))
    warnings.push('RETAINED_SNAPSHOT_SPAWN_MISSING');
  const recoveryConstructionRisk=retainedRecoveryConstructionRisk(recoveryEvidence);
  if(recoveryConstructionRisk.status==='POTENTIAL_STALL')
    warnings.push('RETAINED_RECOVERY_CONSTRUCTION_STALL_RISK');
  const currentRoomCrewRisk=currentRoomCrewConstructionRisk({
    id,room,spawn,creeps,evidence:recoveryEvidence
  });
  if(currentRoomCrewRisk.status==='POTENTIAL_STALL')
    warnings.push('PINNED_ROOM_CREW_ABSENT_RETAINED_STALL');
  const operationalReadiness={
    status:operationalReasons.length?'HOLD':'UNVERIFIED',
    reasons:operationalReasons,
    evidenceType:'CURRENT_GET_ONLY_STATUS_AND_ROOM_OBJECTS',
    executionAuthority:false
  };
  const result={ok:failures.length===0,failures,warnings,mode:'GET_ONLY',
    operationalReadiness,recoveryConstructionRisk,currentRoomCrewRisk,
    target:{shard:target.shard,room:target.room,x:target.x,y:target.y},
    activeBranch:active.length===1?active[0].branch:null,
    worldStatus:status?.status??null,
    spawnVerified:ownerVerified&&roomObjectsVerified?Boolean(spawn):null,
    spawnSpawning:spawn?.spawning??null,
    spawnEnergy:Number.isSafeInteger(energy)&&energy>=0?energy:null,
    spawnEnergyCapacity:Number.isSafeInteger(capacity)&&capacity>=0?capacity:null,
    ownedCreepCount:ownerVerified&&roomObjectsVerified?creeps.length:null,
    ownedCreepRoles:ownerVerified&&roomObjectsVerified?ownedCreepRoles:null,
    controllerLevel:Number.isSafeInteger(controller?.level)&&controller.level>=0?
      controller.level:null,
    controllerProgress:Number.isSafeInteger(controller?.progress)&&controller.progress>=0?
      controller.progress:null,
    memoryAvailable:recoveryEvidence.availability!=='UNKNOWN',
    recoveryEvidence,
    placementAttempted:false,activationAttempted:false};
  return result;
}
export async function inspectWorldRuntime(api,expectedActiveBranch=STAGING_BRANCH){
  if(api?.defaultShard!==target.shard)throw new Error('EXACT_SHARD_REQUIRED');
  const [me,branches,status,room,memory]=await Promise.all([
    api.authMe(),api.userBranches(),api.userWorldStatus(),
    api.gameRoomObjects(target.room,target.shard),
    api.userMemory('bot',target.shard).catch(()=>null)]);
  return assessWorldRuntime({me,branches,status,room,memory},expectedActiveBranch);
}
async function main(){
  if(!process.env.RUNNER_TEMP)throw new Error('RUNNER_TEMP_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,'w37s79-runtime-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:target.shard});
    const result=await inspectWorldRuntime(api,WORLD_PROFILE.branch);
    console.log('WORLD_W37S79_RUNTIME '+JSON.stringify(result));
    if(!result.ok)process.exitCode=2;
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_W37S79_RUNTIME_FAILED',e.message);process.exitCode=1;});
