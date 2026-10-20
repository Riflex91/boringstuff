'use strict';

// D8: observe settled PREVIOUS-TICK Screeps Room.getEventLog() outcomes.
// Never infer kills, wins, action success or enemy ownership from intent rc.
// Only current still-visible owned objects can be authenticated, therefore
// every amount is explicitly a lower bound (destroyed actors/targets absent).
const SCHEMA_VERSION=1, MAX_ROOMS=3, MAX_EVENTS=250, WINDOW_TICKS=100;
const FIELDS=['towerAttackEvents','settledTowerDamage','towerHealEvents',
  'settledTowerHealing','coreShieldRepairEvents','settledCoreShieldRepair',
  'incomingOwnedHitEvents','settledOwnedDamage','ticksWithArmedHostiles'];
const validTick=n=>Number.isSafeInteger(n)&&n>=1;
const validRoom=n=>typeof n==='string'&&/^[WE][0-9]+[NS][0-9]+$/.test(n);
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
function baseline(now){
  const sums={};
  for(const k of FIELDS)sums[k]=0;
  return {startTick:now,lastTick:now-1,observedTicks:0,...sums};
}
function cleanWindow(x){
  return !!x&&validTick(x.startTick)&&Number.isSafeInteger(x.lastTick)&&
    x.lastTick>=x.startTick-1&&Number.isSafeInteger(x.observedTicks)&&
    x.observedTicks>=0&&x.observedTicks<=WINDOW_TICKS&&
    x.lastTick===x.startTick+x.observedTicks-1&&
    FIELDS.every(k=>Number.isSafeInteger(x[k])&&x[k]>=0&&
      x[k]<=100000000);
}
function snapshot(w,status){
  if(!cleanWindow(w))return {status:'UNVERIFIED',authority:'SHADOW_EVIDENCE',
    actionAuthority:'NONE'};
  return {status,authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
    source:'SCREEPS_PREVIOUS_TICK_EVENT_LOG',
    attribution:'CURRENT_VISIBLE_OWNED_OBJECTS_ONLY_LOWER_BOUND',
    startObservationTick:w.startTick,endObservationTick:w.lastTick,
    firstSettledEventTick:w.startTick-1,lastSettledEventTick:w.lastTick-1,
    observedTicks:w.observedTicks,...Object.fromEntries(
      FIELDS.map(k=>[k,w[k]]))};
}
function safeNumber(value){
  return Number.isSafeInteger(value)&&value>=0&&value<=1000000;
}
function roomInspect(state){
  const room=state?.room;
  if(!room?.controller?.my||!validRoom(room.name)||
      !Array.isArray(state.structures)||state.structures.length>600||
      !Array.isArray(state.towers)||state.towers.length>6||
      !Array.isArray(state.creeps)||state.creeps.length>120||
      !Array.isArray(state.hostileCreeps)||state.hostileCreeps.length>40||
      typeof room.getEventLog!=='function')return null;
  const ownObjects=new Set(), ownActors=new Set(), towers=new Set();
  const core=new Set(), shields=new Set();
  const ownedCore=state.structures.filter(s=>s?.my===true&&s.pos&&
    ['spawn','tower','storage'].includes(s.structureType));
  for(const s of state.structures) {
    if(!s||s.my!==true||typeof s.id!=='string'||!s.id)continue;
    ownObjects.add(s.id);
    ownActors.add(s.id);
    if(s.structureType==='rampart'&&s.pos&&
       ownedCore.some(c=>c.pos.x===s.pos.x&&c.pos.y===s.pos.y))
      shields.add(s.id);
  }
  for(const t of state.towers) {
    if(t?.my===true&&typeof t.id==='string'&&t.id) {
      towers.add(t.id);ownActors.add(t.id);ownObjects.add(t.id);
    }
  }
  for(const c of state.creeps) {
    if(c?.my!==false&&typeof c?.id==='string'&&c.id) {
      ownObjects.add(c.id);ownActors.add(c.id);
    }
  }
  let events;
  try {events=room.getEventLog();}catch(_){return null;}
  if(!Array.isArray(events)||events.length>MAX_EVENTS)return null;
  const m={};for(const k of FIELDS)m[k]=0;
  m.ticksWithArmedHostiles=state.hostileCreeps.some(c=>Array.isArray(c.body)&&
    c.body.some(p=>p?.hits>0&&['attack','ranged_attack','work','heal'].includes(p.type)))?1:0;
  if(typeof EVENT_ATTACK==='undefined'||
      typeof EVENT_HEAL==='undefined'||
      typeof EVENT_REPAIR==='undefined')return null;
  for(const e of events) {
    if(!e||!e.data||typeof e.data!=='object')continue;
    const d=e.data;
    if(e.event===EVENT_ATTACK) {
      if(!safeNumber(d.damage))continue;
      if(towers.has(e.objectId)) {
        m.towerAttackEvents++;
        m.settledTowerDamage+=d.damage;
      } else if(ownObjects.has(d.targetId)&&!ownActors.has(e.objectId)) {
        m.incomingOwnedHitEvents++;
        m.settledOwnedDamage+=d.damage;
      }
    }else if(e.event===EVENT_HEAL&&towers.has(e.objectId)) {
      if(!safeNumber(d.amount)||!ownObjects.has(d.targetId))continue;
      m.towerHealEvents++;
      m.settledTowerHealing+=d.amount;
    }else if(e.event===EVENT_REPAIR&&shields.has(d.targetId)&&
      ownActors.has(e.objectId)&&safeNumber(d.amount)){
      m.coreShieldRepairEvents++;
      m.settledCoreShieldRepair+=d.amount;
    }
  }
  return m;
}
function ensure(memory){
  if(!memory||!memory.bot||typeof memory.bot!=='object')return null;
  let root=memory.bot.d8CombatSettlement;
  if(root===undefined){
    root={schemaVersion:SCHEMA_VERSION,rooms:{}};
    memory.bot.d8CombatSettlement=root;
  }
  if(!root||root.schemaVersion!==SCHEMA_VERSION||!root.rooms||
     typeof root.rooms!=='object'||Array.isArray(root.rooms)||
     Object.keys(root.rooms).length>MAX_ROOMS)return null;
  return root;
}
function observe(states,game,memory) {
  if(!Array.isArray(states)||states.length>MAX_ROOMS||
     !validTick(game?.time)||game.time<=1)
    return {status:'HOLD',reason:'INVALID_INPUT',observedRooms:0};
  const root=ensure(memory);
  if(!root)return {status:'HOLD',reason:'INVALID_MEMORY',observedRooms:0};
  let observedRooms=0,completed=[];
  for(const state of states){
    const room=state?.room?.name;
    if(!validRoom(room)||state.room.controller?.my!==true)continue;
    if(!own(root.rooms,room)&&Object.keys(root.rooms).length>=MAX_ROOMS)
      continue;
    let e=root.rooms[room];
    if(e&&(!e.current||!cleanWindow(e.current)||
       (e.lastWindow&&!cleanWindow(e.lastWindow)))){
      // A corrupted historic ledger must not be silently called a PASS.
      continue;
    }
    if(!e)e={current:baseline(game.time),lastWindow:null,
      lastAttemptTick:0,lastResult:'NOT_OBSERVED'};
    if(e.lastAttemptTick===game.time)continue;
    if(Number.isSafeInteger(e.lastAttemptTick)&&e.lastAttemptTick>game.time)
      continue;
    const m=roomInspect(state);
    let w=e.current;
    // A global reset or CPU-skipped tick breaks the contiguous evidence.
    if(w.lastTick!==game.time-1)w=baseline(game.time);
    if(!m){
      e.current=baseline(game.time+1);
      e.lastResult='UNAVAILABLE';
      e.lastAttemptTick=game.time;
      root.rooms[room]=e;
      continue;
    }
    for(const k of FIELDS)w[k]+=m[k];
    w.observedTicks++;
    w.lastTick=game.time;
    if(!cleanWindow(w)){
      e.lastResult='INVALID_SAMPLE';e.current=baseline(game.time+1);
    }else{
      observedRooms++;
      e.lastResult='OBSERVED';
      if(w.observedTicks===WINDOW_TICKS){
        e.lastWindow=w;
        completed.push({room,summary:snapshot(w,'COMPLETE')});
        e.current=baseline(game.time+1);
      }else e.current=w;
    }
    e.lastAttemptTick=game.time;
    root.rooms[room]=e;
  }
  return {status:'OBSERVED',observedRooms,completed};
}
function summary(room,memory){
  const root=memory?.bot?.d8CombatSettlement;
  if(!validRoom(room)||!root||root.schemaVersion!==SCHEMA_VERSION||
     !root.rooms||!own(root.rooms,room))return {
       status:'UNOBSERVED',authority:'SHADOW_EVIDENCE',
       actionAuthority:'NONE'};
  const e=root.rooms[room];
  if(!e||!cleanWindow(e.current))return {
    status:'UNVERIFIED',authority:'SHADOW_EVIDENCE',
    actionAuthority:'NONE'};
  return {
    status:e.lastResult==='UNAVAILABLE'?'GAP_UNKNOWN':'OBSERVING',
    authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
    current:snapshot(e.current,'PARTIAL'),
    lastCompletedWindow:e.lastWindow&&cleanWindow(e.lastWindow)
      ?snapshot(e.lastWindow,'COMPLETE'):null
  };
}
module.exports={SCHEMA_VERSION,MAX_EVENTS,WINDOW_TICKS,observe,summary,
  _test:{roomInspect,cleanWindow,baseline}};
