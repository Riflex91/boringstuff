'use strict';

// I4 passive cost reservation for a hypothetical minimal second-colony crew.
// No spawning, claiming, route scheduling, target selection or other intents.
// Positive affordability is NOT expansion authorization: building costs,
// creep lifetime, route travel time, defense and CPU remain unverified.
const parentSupport=require('expansion.parent.support.shadow');
const parentStability=require('expansion.parent.stability.shadow');
const siteEvidence=require('expansion.site.shadow');
const SCHEMA_VERSION=1;
const CREW=Object.freeze([
  {role:'claimer',count:1,body:['move','claim']},
  {role:'pioneer',count:2,body:['work','carry','move']},
  {role:'supplyHauler',count:1,body:['carry','carry','move']}
]);
const COMPONENTS=['move','claim','work','carry'];

function base(reason) {
  return {schemaVersion:SCHEMA_VERSION,authority:'SHADOW',
    actionAuthority:'NONE',claimActionEnabled:false,
    spawnActionEnabled:false,constructionActionEnabled:false,
    readyForClaim:false,status:'HOLD',reason,
    totalCrewEnergy:null,totalCrewSpawnTicks:null,
    parentReserveFloor:null,hypotheticalStoredEnergyAfterCrew:null,
    crew:[],unverified:['actualCreepRouteTravelTime',
      'claimerLifetimeAtArrival','constructionEnergyBudget',
      'defenseRisk','incrementalCpuCost','spawnQueueOpportunityCost']};
}
function costData() {
  if(typeof BODYPART_COST==='undefined'||!BODYPART_COST)
    return null;
  const prices={};
  for(const name of COMPONENTS){
    const part=typeof globalThis!=='undefined' && typeof globalThis[name.toUpperCase()]!=='undefined'
      ? globalThis[name.toUpperCase()] : name;
    const price=BODYPART_COST[part];
    if(!Number.isSafeInteger(price)||price<=0||price>10000)
      return null;
    prices[name]=price;
  }
  const ticks=typeof CREEP_SPAWN_TIME!=='undefined'
    ? CREEP_SPAWN_TIME : null;
  if(!Number.isSafeInteger(ticks)||ticks<=0||ticks>100)
    return null;
  return {prices,ticks};
}
function assess(readiness,operation,parent,continuity,tick){
  const out=base('EXPANSION_GEOMETRY_OR_BUDGET_UNVERIFIED');
  if(!readiness||readiness.authority!=='SHADOW'||
     readiness.claimActionEnabled!==false||
     readiness.status!=='PLANNING_CANDIDATE'||
     !Number.isSafeInteger(readiness.availableClaimSlots)||
     readiness.availableClaimSlots<1||
     !operation||operation.authority!=='SHADOW'||
     operation.claimActionEnabled!==false||
     operation.spawnActionEnabled!==false||
     operation.readyForClaim!==false||
     operation.phase!=='SITE_VERIFIED_ADVISORY'||
     operation.spawnTileVerified!==true||
     operation.tilePathVerified!==true||
     operation.routeLevel!=='ROOM_LEVEL_ONLY'||
     typeof operation.candidateRoom!=='string'||
     !/^[WE][0-9]+[NS][0-9]+$/.test(operation.candidateRoom)||
     !operation.spawnSite||
     operation.spawnSite.roomName!==operation.candidateRoom||
     !Number.isSafeInteger(operation.spawnSite.x)||
     !Number.isSafeInteger(operation.spawnSite.y)||
     operation.spawnSite.x<5||operation.spawnSite.x>44||
     operation.spawnSite.y<5||operation.spawnSite.y>44||
     !Number.isFinite(operation.pathCost)||operation.pathCost<0||
     !Number.isSafeInteger(operation.siteCandidatesChecked)||
     operation.siteCandidatesChecked<0||
     operation.siteCandidatesChecked>=siteEvidence.MAX_CANDIDATES||
     !Number.isSafeInteger(operation.routeHops)||
     operation.routeHops<1||operation.routeHops>3||
     typeof operation.parentRoom!=='string'||
     operation.parentRoom===operation.candidateRoom||
     operation.parentRoom!==parent?.room?.name)
    return out;

  const support=parentSupport.assess(parent);
  if(support.status!=='ADVISORY_OK')
    return {...out,reason:support.reason||'PARENT_SUPPORT_UNVERIFIED'};
  // A positive one-tick affordability calculation cannot stand on its own
  // after I4 site proof: require the exact current, independently observed
  // 100-tick parent support window. This grants no spending authority.
  if(!parentStability.qualifies(continuity,parent.room.name,tick))
    return {...out,reason:'PARENT_SUPPORT_CONTINUITY_UNVERIFIED'};
  const data=costData();
  if(!data)return {...out,status:'UNVERIFIED',reason:'BODY_COST_OR_SPAWN_RATE_UNVERIFIED'};
  const capacity=parent.energyCapacityAvailable;
  const available=parent.energyAvailable;
  const stored=parent.energyStored;
  if(!Number.isSafeInteger(capacity)||capacity<650||
     !Number.isSafeInteger(available)||available>capacity||
     !Number.isSafeInteger(stored)||stored<0)
    return {...out,status:'UNVERIFIED',reason:'PARENT_ENERGY_UNVERIFIED'};

  const crew=[];
  let total=0,totalSpawnTicks=0;
  for(const spec of CREW){
    const unitCost=spec.body.reduce((sum,part)=>sum+data.prices[part],0);
    const spawnTicks=spec.body.length*data.ticks;
    if(unitCost>capacity)
      return {...out,reason:'CREW_BODY_EXCEEDS_PARENT_SPAWN_CAPACITY'};
    total+=unitCost*spec.count;
    totalSpawnTicks+=spawnTicks*spec.count;
    crew.push({role:spec.role,count:spec.count,
      body:spec.body.slice(),unitCost,totalCost:unitCost*spec.count,
      unitSpawnTicks:spawnTicks});
  }
  const reserveFloor=Math.max(3000,capacity*3);
  const after=stored-total;
  const estimate={...out,crew,totalCrewEnergy:total,
    totalCrewSpawnTicks:totalSpawnTicks,
    parentReserveFloor:reserveFloor,
    // Not actual withdrawals: source stock after an *assumed* crew allocation.
    hypotheticalStoredEnergyAfterCrew:after};
  if(after<reserveFloor)
    return {...estimate,reason:'PARENT_CREW_COST_WOULD_EXHAUST_RESERVE'};
  return {...estimate,status:'COST_ESTIMATE_ONLY',reason:null};
}
module.exports={SCHEMA_VERSION,assess};
