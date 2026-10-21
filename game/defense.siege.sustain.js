'use strict';

// D10: strictly read-only, bounded alignment of D8 settled PREVIOUS-TICK
// event counters and D9 same-ID CURRENT-TICK Rampart hit deltas.
// D8(t) covers engine events in t-1, just as D9(t)-D9(t-1)
// covers net shield hit changes during t-1 -> t.
// Correlation across different shields is NOT per-target proof.
const VERSION=1,MAX_ROOMS=3,MAX_WINDOW=12,MAX_COUNT=100000000;
const FIELDS=['settledCoreShieldRepair','coreShieldRepairEvents',
  'settledTowerDamage','settledTowerHealing','settledOwnedDamage'];
const RISK=new Set(['QUIET','NO_CORE_OBJECTS',
  'CORE_UNSHIELDED_UNDER_FIRE','CORE_SHIELD_BREACH_IMMINENT',
  'CORE_SHIELD_AT_RISK','CORE_UNDER_PRESSURE',
  'ARMED_HOSTILES_PRESENT','CORE_EXPOSED']);
const owner=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const tickOk=t=>Number.isSafeInteger(t)&&t>0;
const roomOk=n=>typeof n==='string'&&/^[WE][0-9]{1,3}[NS][0-9]{1,3}$/.test(n);
const countOk=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_COUNT;
function getSettledWindow(d8,tick){
  if(!d8||d8.status!=='OBSERVING')return null;
  for(const s of [d8.lastCompletedWindow,d8.current]){
    if(!s||!['COMPLETE','PARTIAL'].includes(s.status)||
       s.source!=='SCREEPS_PREVIOUS_TICK_EVENT_LOG'||
       s.attribution!=='CURRENT_VISIBLE_OWNED_OBJECTS_ONLY_LOWER_BOUND'||
       s.actionAuthority!=='NONE'||!tickOk(s.startObservationTick)||
       s.endObservationTick!==tick||s.lastSettledEventTick!==tick-1||
       !Number.isSafeInteger(s.observedTicks)||s.observedTicks<1||
       s.observedTicks>100||s.startObservationTick+s.observedTicks-1!==tick||
       FIELDS.some(k=>!countOk(s[k])))continue;
    return s;
  }
  return null;
}
function crediblePressure(d9,tick){
  if(!d9||d9.status!=='OBSERVED'||d9.authority!=='SHADOW_EVIDENCE'||
     d9.actionAuthority!=='NONE'||d9.observationTick!==tick||
     !RISK.has(d9.risk)||d9.continuity!=='CONSECUTIVE'||
     d9.shieldDelta!=='SAME_ID_CONSECUTIVE_TICK_NET_HITS_NOT_RAW_DAMAGE'||
     d9.damageEstimate!=='IN_RANGE_UPPER_BOUND_NOT_SETTLED_DAMAGE')return false;
  const required=['matchedCoreShields','observedNetShieldHitLoss',
    'observedNetShieldHitGain','activeHostiles','towerAmmo','lowAmmoTowers',
    'towerCount','coreBuildings','coveredCoreBuildings','uncoveredCoreBuildings'];
  if(required.some(k=>!countOk(d9[k]))||
     d9.coreBuildings!==d9.coveredCoreBuildings+d9.uncoveredCoreBuildings||
     d9.matchedCoreShields>d9.coveredCoreBuildings||
     d9.lowAmmoTowers>d9.towerCount)return false;
  if(d9.storedEnergy!=null&&!countOk(d9.storedEnergy))return false;
  if(d9.defenderCount!=null&&!countOk(d9.defenderCount))return false;
  return true;
}
function alignedDelta(window,prior,tick){
  // The D8 100-tick rollover starts fresh. A one-tick first sample
  // contains this tick's settled event ONLY; never subtract prior window.
  if(window.observedTicks===1){
    return Object.fromEntries(FIELDS.map(k=>[k,window[k]]));
  }
  if(!prior||!tickOk(prior.tick)||prior.tick!==tick-1||
     prior.start!==window.startObservationTick||
     FIELDS.some(k=>!countOk(prior[k])||window[k]<prior[k]))return null;
  return Object.fromEntries(FIELDS.map(k=>[k,window[k]-prior[k]]));
}
function blank(status='UNOBSERVED'){
  return {authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
    status,diagnosis:'INSUFFICIENT_EVIDENCE'};
}
function validPoint(p){
  return p&&tickOk(p.tick)&&RISK.has(p.risk)&&
    typeof p.armedPressure==='boolean'&&
    (p.activeHostiles>0)===p.armedPressure &&
    (p.defenderCount===null||countOk(p.defenderCount))&&
    (p.storedEnergy===null||countOk(p.storedEnergy))&&
    ['CONSECUTIVE'].includes(p.shieldContinuity)&&
    ['SETTLED_PREVIOUS_TICK'].includes(p.settlement)&&
    ['CORE_UNSHIELDED_UNDER_FIRE','CORE_SHIELD_BREACH_IMMINENT',
     'CORE_SHIELD_AT_RISK','CORE_UNDER_PRESSURE',
     'ARMED_HOSTILES_PRESENT','CORE_EXPOSED',
     'QUIET','NO_CORE_OBJECTS'].includes(p.risk)&&
    ['activeHostiles','shieldLoss','shieldGain','matchedShields',
     'towerAmmo','lowAmmoTowers','towerCount',
     ...FIELDS].every(k=>countOk(p[k]));
}
function summarise(points,tick){
  const total={shieldNetHitLoss:0,shieldNetHitGain:0,
    settledCoreShieldRepair:0,settledTowerDamage:0,
    settledTowerHealing:0,settledOwnedDamage:0,
    ticksWithArmedHostiles:0,ticksWithNetShieldLoss:0,
    ticksWithSettledCoreRepair:0,ticksWithTowerAmmoBelowReserve:0};
  for(const p of points){
    total.shieldNetHitLoss+=p.shieldLoss;
    total.shieldNetHitGain+=p.shieldGain;
    total.settledCoreShieldRepair+=p.settledCoreShieldRepair;
    total.settledTowerDamage+=p.settledTowerDamage;
    total.settledTowerHealing+=p.settledTowerHealing;
    total.settledOwnedDamage+=p.settledOwnedDamage;
    if(p.armedPressure)total.ticksWithArmedHostiles++;
    if(p.shieldLoss>0)total.ticksWithNetShieldLoss++;
    if(p.settledCoreShieldRepair>0)total.ticksWithSettledCoreRepair++;
    if(p.armedPressure&&p.lowAmmoTowers>0)
      total.ticksWithTowerAmmoBelowReserve++;
  }
  const last=points[points.length-1];
  const pressured=last.armedPressure;
  const sustained=points.length>=3&&
    points.slice(-3).every(x=>x.armedPressure&&x.shieldLoss>0);
  let diagnosis='NO_CURRENT_CORE_PRESSURE';
  if(last.risk==='CORE_UNSHIELDED_UNDER_FIRE')
    diagnosis='CRITICAL_UNSHIELDED_CORE';
  else if(last.risk==='CORE_SHIELD_BREACH_IMMINENT')
    diagnosis='CRITICAL_CORE_SHIELD_BREACH';
  else if(sustained&&points.slice(-3).every(x=>x.settledCoreShieldRepair===0))
    diagnosis='SUSTAINED_ATTRITION_NO_OBSERVED_CORE_REPAIR';
  else if(sustained)
    diagnosis='SUSTAINED_ATTRITION_WITH_REPAIR_EVIDENCE';
  else if(pressured&&last.lowAmmoTowers>0)
    diagnosis='SIEGE_TOWER_AMMO_SHORTFALL';
  else if(pressured&&last.defenderCount===0)
    diagnosis='SIEGE_DEFENDER_ABSENT';
  else if(pressured&&last.storedEnergy!==null&&last.storedEnergy<1000)
    diagnosis='SIEGE_STORED_ENERGY_LOW';
  else if(pressured)
    diagnosis='ARMED_PRESSURE_WITHOUT_PROVEN_ATTRITION';
  const bounded={};
  for(const [k,v] of Object.entries(total))
    bounded[k]=countOk(v)?v:null;
  return {authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
    status:'ALIGNED',diagnosis,
    confidence:'TIMING_ALIGNED_AGGREGATES_NOT_TARGET_LEVEL_CAUSALITY',
    windowStartTick:points[0].tick,windowEndTick:tick,
    sampledConsecutiveTicks:points.length,
    latestPhysicalRisk:last.risk,
    latestTowerAmmo:last.towerAmmo,
    latestLowAmmoTowers:last.lowAmmoTowers,
    latestDefenderCount:last.defenderCount,
    latestStoredEnergy:last.storedEnergy,
    observationBasis:'D9_MATCHED_SHIELD_NET_HITS_AND_D8_PREVIOUS_TICK_SETTLED_EVENTS',
    ...bounded};
}
function validRoot(root){
  return root&&root.version===VERSION&&root.rooms&&
    typeof root.rooms==='object'&&!Array.isArray(root.rooms)&&
    Object.keys(root.rooms).length<=MAX_ROOMS;
}
function observe(states,game,memory,d8,d9){
  if(!Array.isArray(states)||states.length>MAX_ROOMS||
     !tickOk(game?.time)||!memory?.bot||
     !d8||typeof d8.summary!=='function'||
     !d9||typeof d9.summary!=='function')
    return {status:'HOLD',observedRooms:0};
  const t=game.time;
  let root=memory.bot.d10SiegeSustain;
  if(root===undefined){
    root={version:VERSION,rooms:{}};
    memory.bot.d10SiegeSustain=root;
  }
  if(!validRoot(root))return {status:'HOLD',observedRooms:0};
  let observedRooms=0;
  for(const state of states){
    const name=state?.room?.name;
    if(!roomOk(name)||state.room.controller?.my!==true||
       (!owner(root.rooms,name)&&Object.keys(root.rooms).length>=MAX_ROOMS))
      continue;
    const prev=root.rooms[name];
    if(prev&&(!tickOk(prev.tick)||!Array.isArray(prev.points)||
       prev.points.length>MAX_WINDOW||prev.points.some(p=>!validPoint(p))||
       (prev.lastD8&&(!tickOk(prev.lastD8.tick)||
         !tickOk(prev.lastD8.start)||FIELDS.some(k=>!countOk(prev.lastD8[k]))))))
      continue; // Corrupt memory must not turn into an optimistic diagnosis.
    if(prev?.tick===t||prev?.tick>t)continue;
    let pressure,settlement;
    try{
      pressure=d9.summary(name,memory,t);
      settlement=d8.summary(name,memory);
    }catch(_){pressure=null;settlement=null;}
    const window=getSettledWindow(settlement,t);
    const next={tick:t,points:[],lastD8:null,
      output:{...blank('GAP_UNKNOWN'),observationTick:t}};
    if(crediblePressure(pressure,t)&&window){
      const delta=alignedDelta(window,prev?.lastD8,t);
      if(delta){
        const p={tick:t,risk:pressure.risk,
          activeHostiles:pressure.activeHostiles,
          armedPressure:pressure.activeHostiles>0,
          shieldContinuity:'CONSECUTIVE',settlement:'SETTLED_PREVIOUS_TICK',
          shieldLoss:pressure.observedNetShieldHitLoss,
          shieldGain:pressure.observedNetShieldHitGain,
          matchedShields:pressure.matchedCoreShields,
          towerAmmo:pressure.towerAmmo,
          lowAmmoTowers:pressure.lowAmmoTowers,towerCount:pressure.towerCount,
          defenderCount:pressure.defenderCount??null,
          storedEnergy:pressure.storedEnergy??null,...delta};
        if(validPoint(p)){
          const history=prev?.tick===t-1?prev.points:[];
          next.points=[...history,p].slice(-MAX_WINDOW);
          next.output=summarise(next.points,t);
          observedRooms++;
        }
      }
    }
    // Keep the last D8 observed cumulative values ONLY for future
    // consecutive same-window delta validation. A malformed/missing
    // D9 sample is never counted as a valid observation.
    if(window)
      next.lastD8={tick:t,start:window.startObservationTick,
        ...Object.fromEntries(FIELDS.map(k=>[k,window[k]]))};
    root.rooms[name]=next;
  }
  return {status:'OBSERVED',observedRooms};
}
function summary(room,memory,tick){
  const root=memory?.bot?.d10SiegeSustain;
  if(!roomOk(room)||!validRoot(root)||!owner(root.rooms,room))
    return blank();
  const row=root.rooms[room];
  if(!row||!tickOk(row.tick)||row.tick!==tick)return blank('STALE_OR_UNKNOWN');
  if(!Array.isArray(row.points)||row.points.length>MAX_WINDOW||
     row.points.some(p=>!validPoint(p)))return blank('UNVERIFIED');
  if(!row.points.length||row.points.at(-1).tick!==tick)
    return {...blank('GAP_UNKNOWN'),observationTick:tick};
  const consecutive=row.points.every((x,i)=>
    i===0||x.tick===row.points[i-1].tick+1);
  if(!consecutive)return blank('UNVERIFIED');
  // Never expose stored/freeform output: recompute a whitelist summary.
  return summarise(row.points,tick);
}
module.exports={observe,summary,MAX_WINDOW,MAX_ROOMS,
  _test:{getSettledWindow,crediblePressure,alignedDelta,summarise,validPoint}};
