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
// Preserve why a Spawn GET numeric field was not observable. A missing
// property, an explicit null and a malformed value are distinct evidence;
// none authorizes spending, spawning or a World deployment.
function spawnNumericFieldEvidence(spawn,field) {
  if(!spawn)return 'SPAWN_UNVERIFIED';
  if(!Object.hasOwn(spawn,field))return 'FIELD_ABSENT';
  if(spawn[field]===null)return 'EXPLICIT_NULL';
  return Number.isSafeInteger(spawn[field])&&spawn[field]>=0?
    'VALID':'INVALID_VALUE';
}
export function assessWorldRuntime({me,branches,status,room,memory},
  expectedActiveBranch=STAGING_BRANCH){
  const failures=[],warnings=[];
  const id=me?._id||me?.id;
  const ownerVerified=typeof id==='string'&&id.trim().length>0;
  // A partially malformed room GET is not a trustworthy census. Do not
  // infer a missing Spawn or zero owned creeps by silently dropping entries.
  const roomObjectsAvailable=Array.isArray(room?.objects);
  const roomObjectsMalformed=roomObjectsAvailable&&room.objects.some(o=>
    o===null||typeof o!=='object'||Array.isArray(o));
  const roomObjectsVerified=roomObjectsAvailable&&!roomObjectsMalformed;
  if(!ownerVerified)failures.push('AUTH_UNVERIFIED');
  const list=Array.isArray(branches?.list)?branches.list:[];
  const active=list.filter(b=>b?.activeWorld===true);
  if(active.length!==1||active[0]?.branch!==expectedActiveBranch)failures.push('EXPECTED_BRANCH_NOT_ACTIVE');
  if(status?.status==='empty'||typeof status?.status!=='string')failures.push('WORLD_STATUS_INVALID');
  if(!roomObjectsAvailable)failures.push('ROOM_OBJECTS_UNAVAILABLE');
  else if(roomObjectsMalformed)failures.push('ROOM_OBJECTS_MALFORMED');
  const objects=roomObjectsVerified?room.objects:[];
  // GET owner IDs must be non-empty strings. Empty/whitespace owner values
  // are unknown ownership, not evidence of a missing Spawn or empty crew.
  // Coercing numeric/object owners with
  // String(...) can fabricate ownership, and a malformed owner cannot
  // establish that a pinned Spawn or owned creep is absent.
  const pinnedSpawns=roomObjectsVerified?objects.filter(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&
    o.x===target.x&&o.y===target.y&&o.name===target.spawnName):[];
  // Conflicting pinned objects cannot establish which Spawn is current.
  // Never expose energy or spawning state from an arbitrary first match.
  const spawnAmbiguous=pinnedSpawns.length>1;
  const spawnOwnerUnverified=pinnedSpawns.some(o=>
    typeof o.user!=='string'||o.user.trim().length===0);
  const spawn=ownerVerified&&roomObjectsVerified&&!spawnAmbiguous&&
    !spawnOwnerUnverified?pinnedSpawns.find(o=>o.user===id):null;
  if(ownerVerified&&roomObjectsVerified) {
    if(spawnAmbiguous)failures.push('PINNED_SPAWN_AMBIGUOUS');
    else if(spawnOwnerUnverified)failures.push('PINNED_SPAWN_OWNER_UNVERIFIED');
    else if(!spawn)failures.push('OWNED_PINNED_SPAWN_MISSING');
  }
  const creepObjects=roomObjectsVerified?objects.filter(o=>o?.type==='creep'):[];
  const crewOwnerUnverified=creepObjects.some(o=>
    typeof o.user!=='string'||o.user.trim().length===0);
  // Repeated GET creep identities cannot establish a trustworthy crew
  // census. Names are unique in Screeps; IDs provide a second independent
  // check when supplied. Absent identity fields alone are not duplicates.
  const seenCreepIdentities=new Set();
  const crewDuplicate=creepObjects.some(o=>{
    // GET may expose both _id and id. Check both: preferring _id alone
    // would miss duplicate id aliases when the _id fields differ.
    // Deduplicate aliases within one object before comparing with others.
    const ids=[o?._id,o?.id].filter(v=>
      typeof v==='string'&&v.trim().length>0).map(v=>'id:'+v);
    const creepName=typeof o?.name==='string'&&o.name.trim().length?
      'name:'+o.name:null;
    const keys=[...new Set(ids)];
    if(creepName)keys.push(creepName);
    const duplicate=keys.some(key=>seenCreepIdentities.has(key));
    for(const key of keys)seenCreepIdentities.add(key);
    return duplicate;
  });
  const creeps=ownerVerified&&roomObjectsVerified?
    creepObjects.filter(o=>o.user===id):[];
  if(ownerVerified&&roomObjectsVerified&&crewOwnerUnverified)
    failures.push('ROOM_CREEP_OWNER_UNVERIFIED');
  if(ownerVerified&&roomObjectsVerified&&crewDuplicate)
    failures.push('ROOM_CREEP_DUPLICATE_IDENTITY');
  const crewVerified=ownerVerified&&roomObjectsVerified&&
    !crewOwnerUnverified&&!crewDuplicate;
  // Creep memory is untrusted. A null-prototype counter prevents inherited
  // names such as constructor/__proto__ from corrupting role observations.
  const ownedCreepRoles=Object.create(null);
  for(const creep of creeps) {
    const role=creep?.memory?.role;
    if(typeof role==='string'&&role.length>0&&role.length<50)
      ownedCreepRoles[role]=(ownedCreepRoles[role]||0)+1;
  }
  // Multiple controller GET objects in one room are ambiguous evidence.
  // Do not publish an arbitrary first match as an authoritative level.
  const controllers=objects.filter(o=>o?.type==='controller');
  const controllerAmbiguous=controllers.length>1;
  if(roomObjectsVerified&&controllerAmbiguous)
    failures.push('CONTROLLER_GET_AMBIGUOUS');
  const controller=controllerAmbiguous?null:controllers[0];
  if(roomObjectsVerified&&!controller&&!controllerAmbiguous)
    warnings.push('CONTROLLER_NOT_OBSERVED');
  if(crewVerified&&!creeps.length)
    warnings.push('NO_OWNED_CREEPS_OBSERVED');
  // Do not coerce absent/null/string GET fields into fabricated energy.
  // A zero is evidence only when the API supplied an actual numeric zero.
  const energy=spawn?.energy;
  const capacity=spawn?.energyCapacity;
  const validEnergy=Number.isSafeInteger(energy)&&energy>=0;
  const validCapacity=Number.isSafeInteger(capacity)&&capacity>=0;
  // A valid-looking energy value above the observed Spawn capacity is
  // internally inconsistent GET evidence, not spendable energy proof.
  const energyExceedsCapacity=validEnergy&&validCapacity&&energy>capacity;
  if(energyExceedsCapacity)warnings.push('SPAWN_ENERGY_EXCEEDS_CAPACITY');
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
  // A self-contradictory Spawn GET is a concrete integrity failure, not
  // merely unknown readiness. Preserve successful GET collection in `ok`.
  if(energyExceedsCapacity)
    operationalReasons.push('SPAWN_ENERGY_EXCEEDS_CAPACITY');
  if(status?.status!=='normal')operationalReasons.push('WORLD_STATUS_NOT_NORMAL');
  // OWNED_PINNED_SPAWN_MISSING is already included in failures above.
  if(recoveryEvidence.expansion?.home?.healthReasons?.includes('SPAWN_MISSING'))
    warnings.push('RETAINED_SNAPSHOT_SPAWN_MISSING');
  const recoveryConstructionRisk=retainedRecoveryConstructionRisk(recoveryEvidence);
  if(recoveryConstructionRisk.status==='POTENTIAL_STALL')
    warnings.push('RETAINED_RECOVERY_CONSTRUCTION_STALL_RISK');
  const currentRoomCrewRisk=currentRoomCrewConstructionRisk({
    id:crewVerified?id:null,room,spawn,creeps,evidence:recoveryEvidence
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
    spawnVerified:ownerVerified&&roomObjectsVerified&&!spawnAmbiguous&&
      !spawnOwnerUnverified?Boolean(spawn):null,
    spawnSpawning:spawn?.spawning??null,
    spawnEnergy:validEnergy&&!energyExceedsCapacity?energy:null,
    spawnEnergyCapacity:validCapacity?capacity:null,
    spawnEnergyEvidence:energyExceedsCapacity?'CONTRADICTORY':
      spawnNumericFieldEvidence(spawn,'energy'),
    spawnEnergyCapacityEvidence:spawnNumericFieldEvidence(spawn,'energyCapacity'),
    ownedCreepCount:crewVerified?creeps.length:null,
    ownedCreepRoles:crewVerified?ownedCreepRoles:null,
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
