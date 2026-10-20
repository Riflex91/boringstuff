'use strict';

// O70: bounded, passive next-tick reconciliation for O69 release-gated intents.
// Persistent Memory contains private identity correlations only; telemetry
// exposes aggregate counts. No gameplay calls, retries, or auto-release.
const MODEL_VERSION = 1;
const MAX_ROOMS = 16;
const MAX_INTENTS = 3;
const MAX_SPAWNS = 64;
const MAX_NAME = 128;
const VALID_STATES = new Set(['SUBMITTED','ACCEPTED','UNCERTAIN','REJECTED']);

function validName(value) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= MAX_NAME;
}
function validTick(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function empty() {
  return {modelVersion:MODEL_VERSION,rooms:{},last:{}};
}
function validRoot(root) {
  return root && root.modelVersion === MODEL_VERSION &&
    root.rooms && typeof root.rooms === 'object' && !Array.isArray(root.rooms) &&
    root.last && typeof root.last === 'object' && !Array.isArray(root.last) &&
    Object.keys(root.rooms).length <= MAX_ROOMS &&
    Object.keys(root.last).length <= MAX_ROOMS;
}
function receipt(memory, game, room, item) {
  if (!memory || !memory.bot || !validTick(game && game.time) ||
      !validName(room) || !item || !validName(item.spawnName) ||
      !validName(item.spawnId) || !validName(item.creepName) ||
      !validName(item.role) || !VALID_STATES.has(item.status)) return false;
  let root = memory.bot.spawnParallelReconcile;
  if (!root) root = empty();
  if (!validRoot(root)) return false;
  const rooms = root.rooms;
  const names = Object.keys(rooms);
  if (!own(rooms,room) && names.length >= MAX_ROOMS) return false;
  let entry = own(rooms,room) ? rooms[room] : null;
  if (entry && (entry.tick !== game.time ||
      !Array.isArray(entry.intents) || entry.intents.length > MAX_INTENTS))
    return false; // Never overwrite unresolved prior-tick receipts.
  if (!entry) entry = {tick:game.time,intents:[]};
  const existing = entry.intents.find(x=>x.spawnName === item.spawnName);
  if (existing) {
    if (existing.spawnId !== item.spawnId ||
        existing.creepName !== item.creepName ||
        existing.role !== item.role ||
        existing.status === 'REJECTED' || existing.status === 'ACCEPTED' ||
        (existing.status === 'UNCERTAIN' && item.status !== 'UNCERTAIN') ||
        (existing.status !== 'SUBMITTED' && existing.status !== item.status))
      return false;
    // Only SUBMITTED may advance to terminal state. Never silently reset.
    if (existing.status === 'SUBMITTED' && item.status === 'SUBMITTED')
      return false;
    existing.status = item.status;
  } else {
    if (item.status !== 'SUBMITTED' ||
        entry.intents.length >= MAX_INTENTS ||
        entry.intents.some(x=>x.creepName===item.creepName)) return false;
    entry.intents.push({
      spawnName:item.spawnName, spawnId:item.spawnId,
      creepName:item.creepName, role:item.role, status:'SUBMITTED'
    });
  }
  rooms[room]=entry;
  memory.bot.spawnParallelReconcile=root;
  return true;
}
function summarize(entry, game) {
  const data = {
    authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
    status:'UNVERIFIED',tick:game.time,
    predecessorTick:entry.tick,observedJobs:0,observedCreeps:0,
    notObserved:0,unknown:0,rejected:0,total:entry.intents.length
  };
  if (game.time !== entry.tick + 1) {
    data.status='GAP_UNKNOWN';
    data.unknown=data.total;
    return data;
  }
  for (const item of entry.intents) {
    if (!item || !validName(item.spawnName) ||
        !validName(item.spawnId) || !validName(item.creepName) ||
        !VALID_STATES.has(item.status)) {
      data.unknown++;
      continue;
    }
    if (item.status === 'REJECTED') { data.rejected++; continue; }
    const spawn=game.spawns[item.spawnName];
    const job=spawn && spawn.my === true && spawn.id === item.spawnId &&
      spawn.room && spawn.room.name && spawn.room.name === item.room &&
      spawn.spawning && spawn.spawning.name === item.creepName;
    const creep=game.creeps && game.creeps[item.creepName];
    const matchingCreep=creep && creep.my === true && creep.memory &&
      creep.memory.role === item.role &&
      creep.memory.home === item.room;
    if (job) data.observedJobs++;
    else if (matchingCreep) data.observedCreeps++;
    else if (item.status === 'ACCEPTED') data.notObserved++;
    else data.unknown++; // thrown/ambiguous intent is never a claimed failure.
  }
  const verified=data.observedJobs+data.observedCreeps;
  data.status=data.notObserved || data.unknown ? 'UNVERIFIED' :
    verified ? 'VERIFIED' : 'REJECTED_ONLY';
  return data;
}
function observe(game, memory) {
  if (!validTick(game && game.time) || !game.spawns ||
      !game.creeps || !memory || !memory.bot)
    return {status:'HOLD',reason:'INVALID_GAME',authority:'SHADOW_EVIDENCE'};
  const root=memory.bot.spawnParallelReconcile;
  if (!root) return {status:'NO_RECEIPTS',authority:'SHADOW_EVIDENCE'};
  if (!validRoot(root) || Object.keys(game.spawns).length > MAX_SPAWNS)
    return {status:'HOLD',reason:'INVALID_LEDGER_OR_SPAWN_LIMIT',authority:'SHADOW_EVIDENCE'};
  const results={};
  for (const room of Object.keys(root.rooms).sort()) {
    const entry=root.rooms[room];
    if (!validName(room) || !entry || !validTick(entry.tick) ||
        !Array.isArray(entry.intents) || entry.intents.length > MAX_INTENTS)
      return {status:'HOLD',reason:'MALFORMED_RECEIPT',authority:'SHADOW_EVIDENCE'};
    if (entry.tick >= game.time) continue;
    // Fill private room relation transiently, not in the stored receipt.
    const normalized={tick:entry.tick,intents:entry.intents.map(x=>({...x,room}))};
    results[room]=summarize(normalized,game);
  }
  // Commit summaries and retire only completed/expired older batches;
  // same-tick receipts remain pending. Never log private identities.
  for (const room of Object.keys(results)) {
    if (Object.keys(root.last).length >= MAX_ROOMS && !own(root.last,room)) {
      const eldest=Object.keys(root.last).sort(
        (a,b)=>(root.last[a].tick || 0)-(root.last[b].tick || 0))[0];
      delete root.last[eldest];
    }
    root.last[room]=results[room];
    delete root.rooms[room];
  }
  return {status:'OBSERVED',authority:'SHADOW_EVIDENCE',
    reconciledRooms:Object.keys(results).length};
}
function summary(room, memory) {
  const root=memory && memory.bot && memory.bot.spawnParallelReconcile;
  if (!validRoot(root) || !validName(room) || !own(root.last,room))
    return {authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
      status:'UNOBSERVED'};
  const x=root.last[room];
  return x && x.authority==='SHADOW_EVIDENCE'
    ? {...x} : {authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',status:'UNOBSERVED'};
}
module.exports={receipt,observe,summary,MODEL_VERSION,MAX_ROOMS,MAX_INTENTS};
