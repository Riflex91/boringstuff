'use strict';

// D9: read-only observed OWNED core shield pressure, strictly separated
// from productive Tower/Spawn/repair/Safe Mode intent authority.
// IDs exist ONLY in private bounded Memory for same-shield comparisons.
// Public telemetry exposes aggregates, never structure or enemy IDs.
const SCHEMA_VERSION=1;
const MAX_ROOMS=3,MAX_STRUCTURES=600,MAX_CORE=16,MAX_HOSTILES=40,MAX_PARTS=50;
const CORE=new Set(['spawn','tower','storage']);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const isTick=n=>Number.isSafeInteger(n)&&n>0;
const isRoom=n=>typeof n==='string'&&/^[WE][0-9]{1,3}[NS][0-9]{1,3}$/.test(n);
const posOk=p=>p&&Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y)&&
  p.x>=0&&p.x<=49&&p.y>=0&&p.y<=49;
const isId=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const plainNumber=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000000;
function damagePotential(enemy,target) {
  if(!enemy?.pos||!target||typeof enemy.pos.getRangeTo!=='function'||
     !Array.isArray(enemy.body)||enemy.body.length>MAX_PARTS)return null;
  let distance;
  try{distance=enemy.pos.getRangeTo(target);}catch(_){return null;}
  if(!Number.isSafeInteger(distance)||distance<0||distance>50)return null;
  let damage=0;
  for(const p of enemy.body) {
    if(!p||!Number.isFinite(p.hits)||p.hits<0)return null;
    if(p.hits===0)continue;
    const multiplier=p.boost?4:1;
    if(distance<=1&&p.type==='attack')damage+=30*multiplier;
    else if(distance<=1&&p.type==='work')damage+=50*multiplier;
    else if(distance<=3&&p.type==='ranged_attack')damage+=10*multiplier;
  }
  return damage;
}
function inspect(state) {
  const room=state?.room,objects=state?.structures,hostiles=state?.hostileCreeps;
  if(!room?.controller?.my||!isRoom(room.name)||
     !Array.isArray(objects)||objects.length>MAX_STRUCTURES||
     !Array.isArray(hostiles)||hostiles.length>MAX_HOSTILES||
     !Array.isArray(state.towers)||state.towers.length>6)return null;
  const core=objects.filter(s=>s?.my===true&&CORE.has(s.structureType));
  if(core.length>MAX_CORE||core.some(s=>!isId(s.id)||!posOk(s.pos)))
    return null;
  const shields=objects.filter(s=>s?.my===true&&s.structureType==='rampart');
  if(shields.some(s=>!isId(s.id)||!posOk(s.pos)||
    !plainNumber(s.hits)||!plainNumber(s.hitsMax)||s.hits>s.hitsMax))
    return null;
  const shieldByTile=new Map();
  for(const s of shields) {
    const key=s.pos.x+','+s.pos.y;
    if(shieldByTile.has(key))return null;
    shieldByTile.set(key,s);
  }
  const ids=new Set(),shieldIds=new Set(),record=[];
  let covered=0,uncovered=0,attackedUncovered=0;
  let minHits=null,minPredictedBreachTicks=null,maxThreat=0;
  let atRisk=0,imminent=0,activeHostiles=0;
  for(const h of hostiles){
    if(!Array.isArray(h?.body)||h.body.length>MAX_PARTS||!h.pos||
       typeof h.pos.getRangeTo!=='function')return null;
    if(h.body.some(p=>!p||!Number.isFinite(p.hits)||p.hits<0))
      return null;
    if(h.body.some(p=>p.hits>0&&['attack','ranged_attack','work','heal'].includes(p.type)))
      activeHostiles++;
  }
  for(const asset of core) {
    if(ids.has(asset.id))return null;
    ids.add(asset.id);
    const shield=shieldByTile.get(asset.pos.x+','+asset.pos.y);
    if(shield) {
      if(shieldIds.has(shield.id))return null;
      shieldIds.add(shield.id);
      covered++;
      minHits=minHits===null?shield.hits:Math.min(minHits,shield.hits);
      record.push({id:shield.id,hits:shield.hits});
    }else uncovered++;
    const target=shield||asset;
    let potential=0;
    for(const h of hostiles) {
      const d=damagePotential(h,target);
      if(d===null)return null;
      potential+=d;
    }
    if(!plainNumber(potential))return null;
    maxThreat=Math.max(maxThreat,potential);
    if(potential>0&&!shield)attackedUncovered++;
    if(potential>0&&shield) {
      const time=shield.hits/potential;
      minPredictedBreachTicks=minPredictedBreachTicks===null?
        time:Math.min(time,minPredictedBreachTicks);
      if(shield.hits<=potential*12)atRisk++;
      if(shield.hits<=potential*3)imminent++;
    }
  }
  let towerAmmo=0,lowAmmoTowers=0;
  for(const tower of state.towers) {
    if(tower?.my!==true||!tower.store)return null;
    const energy=tower.store.energy;
    if(!plainNumber(energy))return null;
    towerAmmo+=energy;
    if(energy<400)lowAmmoTowers++;
  }
  if(!plainNumber(towerAmmo))return null;
  const stored=state.energyStored;
  const defenders=state.byRole?.defender;
  if(stored!=null&&!plainNumber(stored))return null;
  if(defenders!=null&&!plainNumber(defenders))return null;
  const safeMode=room.controller.safeMode;
  if(safeMode!=null&&!plainNumber(safeMode))return null;
  let risk='QUIET';
  if(!core.length)risk='NO_CORE_OBJECTS';
  else if(attackedUncovered)risk='CORE_UNSHIELDED_UNDER_FIRE';
  else if(imminent)risk='CORE_SHIELD_BREACH_IMMINENT';
  else if(atRisk)risk='CORE_SHIELD_AT_RISK';
  else if(maxThreat>0)risk='CORE_UNDER_PRESSURE';
  else if(activeHostiles)risk='ARMED_HOSTILES_PRESENT';
  else if(uncovered)risk='CORE_EXPOSED';
  record.sort((a,b)=>a.id.localeCompare(b.id));
  return {risk,privateShields:record,summary:{
    risk,activeHostiles,coreBuildings:core.length,coveredCoreBuildings:covered,
    uncoveredCoreBuildings:uncovered,attackedUncoveredCore:attackedUncovered,
    endangeredCoreShields:atRisk,imminentCoreShields:imminent,
    minimumCoreShieldHits:minHits,
    shortestEstimatedCoreShieldBreachTicks:minPredictedBreachTicks===null?
      null:Math.max(0,Math.floor(minPredictedBreachTicks)),
    maximumInRangeEnemyCoreDamagePotential:maxThreat,
    towerAmmo,lowAmmoTowers,towerCount:state.towers.length,
    defenderCount:defenders??null,storedEnergy:stored??null,
    safeModeRemaining:safeMode??0
  }};
}
function validateRoot(root) {
  return root&&root.schemaVersion===SCHEMA_VERSION&&
    root.rooms&&typeof root.rooms==='object'&&
    !Array.isArray(root.rooms)&&Object.keys(root.rooms).length<=MAX_ROOMS;
}
function validPrivate(record) {
  return record&&isTick(record.tick)&&
    Array.isArray(record.shields)&&record.shields.length<=MAX_CORE&&
    record.shields.every(s=>isId(s?.id)&&plainNumber(s.hits))&&
    new Set(record.shields.map(s=>s.id)).size===record.shields.length;
}
function aggregateDelta(current,prior) {
  if(!prior)return {continuity:'NO_PREDECESSOR',matchedCoreShields:0,
    observedNetShieldHitLoss:0,observedNetShieldHitGain:0};
  const before=new Map(prior.shields.map(x=>[x.id,x.hits]));
  let matched=0,loss=0,gain=0;
  for(const after of current) {
    if(!before.has(after.id))continue;
    matched++;
    const delta=after.hits-before.get(after.id);
    if(delta<0)loss-=delta;
    else gain+=delta;
  }
  return {continuity:'CONSECUTIVE',matchedCoreShields:matched,
    observedNetShieldHitLoss:loss,observedNetShieldHitGain:gain};
}
function observe(states,game,memory) {
  if(!Array.isArray(states)||states.length>MAX_ROOMS||
     !isTick(game?.time)||!memory?.bot)return {
       status:'HOLD',reason:'INVALID_INPUT',observedRooms:0};
  let root=memory.bot.d9SiegePressure;
  if(!root){
    root={schemaVersion:SCHEMA_VERSION,rooms:{}};
    memory.bot.d9SiegePressure=root;
  }
  if(!validateRoot(root))return {
    status:'HOLD',reason:'INVALID_LEDGER',observedRooms:0};
  let observedRooms=0;
  for(const state of states){
    const name=state?.room?.name;
    if(!isRoom(name)||(!own(root.rooms,name)&&
       Object.keys(root.rooms).length>=MAX_ROOMS))continue;
    const prior=root.rooms[name];
    if(prior&&!validPrivate(prior.private))continue;
    if(prior?.private?.tick===game.time)continue;
    if(prior?.private?.tick>game.time)continue;
    const sample=inspect(state);
    if(!sample) {
      // Never retain a stale success as a current observation.
      if(prior)prior.status='GAP_UNKNOWN';
      continue;
    }
    const consecutive=prior?.private?.tick===game.time-1?
      prior.private:null;
    const delta=aggregateDelta(sample.privateShields,consecutive);
    root.rooms[name]={
      status:'OBSERVED',
      private:{tick:game.time,shields:sample.privateShields},
      result:{...sample.summary,...delta}
    };
    observedRooms++;
  }
  return {status:'OBSERVED',observedRooms};
}
function summary(room,memory,tick) {
  const root=memory?.bot?.d9SiegePressure;
  const unknown={authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
    status:'UNOBSERVED',risk:'UNKNOWN'};
  if(!isRoom(room)||!validateRoot(root)||!own(root.rooms,room))
    return unknown;
  const row=root.rooms[room];
  if(!row||!validPrivate(row.private))return {
    ...unknown,status:'UNVERIFIED'};
  if(row.status!=='OBSERVED'||!isTick(tick)||
     row.private.tick!==tick)return {
       ...unknown,status:'STALE_OR_UNKNOWN'};
  const x=row.result;
  if(!x||![
    'QUIET','NO_CORE_OBJECTS','CORE_UNSHIELDED_UNDER_FIRE',
    'CORE_SHIELD_BREACH_IMMINENT','CORE_SHIELD_AT_RISK',
    'CORE_UNDER_PRESSURE','ARMED_HOSTILES_PRESENT','CORE_EXPOSED'
  ].includes(x.risk)||!['CONSECUTIVE','NO_PREDECESSOR'].includes(x.continuity))
    return unknown;
  const counts=['activeHostiles','coreBuildings','coveredCoreBuildings',
    'uncoveredCoreBuildings','attackedUncoveredCore','endangeredCoreShields',
    'imminentCoreShields','maximumInRangeEnemyCoreDamagePotential',
    'towerAmmo','lowAmmoTowers','towerCount','matchedCoreShields',
    'observedNetShieldHitLoss','observedNetShieldHitGain'];
  if(counts.some(k=>!plainNumber(x[k])))return unknown;
  const nullable=['minimumCoreShieldHits','shortestEstimatedCoreShieldBreachTicks',
    'defenderCount','storedEnergy','safeModeRemaining'];
  if(nullable.some(k=>x[k]!=null&&!plainNumber(x[k])))return unknown;
  if(x.coreBuildings!==x.coveredCoreBuildings+x.uncoveredCoreBuildings||
     x.matchedCoreShields>x.coveredCoreBuildings)return unknown;
  return {authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
    status:'OBSERVED',observationTick:tick,
    damageEstimate:'IN_RANGE_UPPER_BOUND_NOT_SETTLED_DAMAGE',
    shieldDelta:'SAME_ID_CONSECUTIVE_TICK_NET_HITS_NOT_RAW_DAMAGE',
    risk:x.risk,continuity:x.continuity,
    ...Object.fromEntries(counts.map(k=>[k,x[k]])),
    ...Object.fromEntries(nullable.map(k=>[k,x[k]??null]))};
}
module.exports={SCHEMA_VERSION,MAX_ROOMS,inspect,observe,summary,
 _test:{damagePotential,aggregateDelta,validPrivate}};
