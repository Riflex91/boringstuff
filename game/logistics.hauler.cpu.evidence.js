'use strict';

// E5 observational CPU baseline. The numbers are measured using the EXISTING
// getUsed() readings around legacy role handlers; no extra per-creep CPU reads.
// They are HAULER ROLE CPU, not CPU attributable to a particular energy route,
// and cannot authorize changing active topology or infer settled deliveries.
const SCHEMA_VERSION = 1;
const WINDOW_TICKS = 100;
const MAX_ROOMS = 3;

function valid(n) { return Number.isFinite(n) && n >= 0; }
function tick(g) { return g && Number.isSafeInteger(g.time) && g.time >= 0 ? g.time : null; }
function newWindow(now) {
  return { startTick:now, lastTick:null, ticks:0, totalRoleCpu:0,
    totalHaulerTicks:0, activeHaulerTicks:0 };
}
function ensure(root, now) {
  if (!root.bot) root.bot={};
  let record=root.bot.logisticsHaulerCpuEvidence;
  if (!record || record.schemaVersion !== SCHEMA_VERSION ||
      !record.rooms || typeof record.rooms !== 'object' ||
      Array.isArray(record.rooms)) {
    record={schemaVersion:SCHEMA_VERSION,rooms:{}};
    root.bot.logisticsHaulerCpuEvidence=record;
  }
  return record;
}
function summarize(w, endTick) {
  return {
    schemaVersion:SCHEMA_VERSION,
    authority:'SHADOW_EVIDENCE',
    source:'MEASURED_CREEP_ROLE_CPU_NOT_ROUTE_CPU',
    actionAuthority:'NONE',
    startTick:w.startTick,endTick,observedTicks:w.ticks,
    totalRoleCpu:Math.round(w.totalRoleCpu*10000)/10000,
    haulerRoleCpuPerTick:Math.round(w.totalRoleCpu/w.ticks*10000)/10000,
    totalHaulerCreepTicks:w.totalHaulerTicks,
    haulerRoleCpuPerCreepTick:w.totalHaulerTicks
      ? Math.round(w.totalRoleCpu/w.totalHaulerTicks*10000)/10000 : null,
    ticksWithActiveHaulers:w.activeHaulerTicks,
    settledEnergyPerTick:null,transportRouteCpuPerTick:null,
    comparableAlternativeCpuPerTick:null,topologySwitchAuthorized:false
  };
}
function observe(roomStates, samples, game, memoryRoot) {
  const now=tick(game || (typeof Game !== 'undefined'?Game:null));
  const root=memoryRoot || (typeof Memory !== 'undefined'?Memory:null);
  if (now===null || !root || !Array.isArray(roomStates) ||
      !samples || typeof samples!=='object') return [];
  const names=roomStates.map(s=>s && s.room && s.room.name);
  if (names.length>MAX_ROOMS ||
      names.some(n=>typeof n!=='string'||!n||n.length>20) ||
      new Set(names).size!==names.length) return [];
  // A missing optional callback cannot masquerade as zero hauling. The
  // existing room.state owned creep census independently bounds each sample.
  const counts=Object.create(null);
  for (const state of roomStates) {
    if (!Array.isArray(state.creeps)) return [];
    const ids=new Set();
    let total=0;
    for (const creep of state.creeps) {
      if (!creep || creep.spawning || !creep.memory ||
          creep.memory.role!=='hauler') continue;
      const id=creep.id||creep.name;
      if (typeof id!=='string'||!id||ids.has(id))return [];
      ids.add(id);
      total++;
    }
    counts[state.room.name]=total;
  }
  const record=ensure(root,now), completed=[];
  // Never report an arbitrary partial census of a >3-room colony.
  for(const room of names.sort()){
    const sample=samples[room] || {haulers:0,roleCpu:0};
    if(!Number.isSafeInteger(sample.haulers) || sample.haulers<0 ||
       sample.haulers!==counts[room] || !valid(sample.roleCpu)) {
      delete record.rooms[room];
      continue;
    }
    let entry=record.rooms[room];
    if(!entry || !entry.window || !Number.isSafeInteger(entry.window.ticks) ||
        entry.window.ticks<0 || entry.window.ticks>=WINDOW_TICKS ||
        !valid(entry.window.totalRoleCpu) ||
        !Number.isSafeInteger(entry.window.totalHaulerTicks) ||
        entry.window.totalHaulerTicks<0 ||
        !Number.isSafeInteger(entry.window.activeHaulerTicks) ||
        entry.window.activeHaulerTicks<0 ||
        (entry.window.ticks===0 ?
          entry.window.lastTick!==null :
          !Number.isSafeInteger(entry.window.lastTick) ||
          entry.window.lastTick-entry.window.startTick!==entry.window.ticks-1)) {
      entry={window:newWindow(now),lastWindow:null};
      record.rooms[room]=entry;
    }
    // Duplicate callbacks from a replayed main loop are idempotent even on
    // 100th-tick rollover. A simulation rewind invalidates previous evidence.
    if(entry.lastProcessedTick===now) continue;
    if(Number.isSafeInteger(entry.lastProcessedTick) && now<entry.lastProcessedTick){
      entry.window=newWindow(now);
      entry.lastWindow=null;
    }
    if(entry.window.ticks>0 && now!==entry.window.lastTick+1 ||
       entry.window.ticks===0 && entry.window.startTick!==now) {
      entry.window=newWindow(now);
    }
    const w=entry.window;
    w.ticks++;
    w.lastTick=now;
    w.totalRoleCpu+=sample.roleCpu;
    w.totalHaulerTicks+=sample.haulers;
    if(sample.haulers>0)w.activeHaulerTicks++;
    entry.lastProcessedTick=now;
    if(w.ticks===WINDOW_TICKS){
      const out=summarize(w,now);
      entry.lastWindow=out;
      completed.push({room,...out});
      entry.window=newWindow(now+1);
    }
  }
  // Keep memory usage bounded after colony room ownership changes.
  for(const room of Object.keys(record.rooms)){
    if(!names.includes(room))delete record.rooms[room];
  }
  return completed;
}
function snapshot(room,memoryRoot) {
  const root=memoryRoot|| (typeof Memory!=='undefined'?Memory:null);
  const rec=root&&root.bot&&root.bot.logisticsHaulerCpuEvidence;
  return rec&&rec.schemaVersion===SCHEMA_VERSION&&rec.rooms&&
    rec.rooms[room]&&rec.rooms[room].lastWindow||null;
}
module.exports={observe,snapshot,_test:{newWindow,summarize,tick}};
