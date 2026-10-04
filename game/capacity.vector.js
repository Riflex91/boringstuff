'use strict';

const SCHEMA_VERSION = 1;

function part(name) {
  if (typeof globalThis !== 'undefined' && typeof globalThis[name] !== 'undefined') return globalThis[name];
  return name.toLowerCase();
}

function empty() {
  return {
    workHarvest: 0,
    workBuild: 0,
    workRepair: 0,
    workUpgrade: 0,
    carry: 0,
    moveEffective: 0,
    claim: 0,
    reserve: 0,
    attack: 0,
    ranged: 0,
    heal: 0,
    dismantle: 0,
    toughEffective: 0
  };
}

function bodyCounts(body) {
  const counts = {};
  for (const item of body || []) {
    const type = typeof item === 'string' ? item : item && item.type;
    const hits = typeof item === 'object' && item ? item.hits : 100;
    if (!type || hits <= 0) continue;
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function creepCounts(creep) {
  if (!creep) return {};
  const names = ['WORK','CARRY','MOVE','CLAIM','ATTACK','RANGED_ATTACK','HEAL','TOUGH'];
  const counts = {};
  if (typeof creep.getActiveBodyparts === 'function') {
    for (const name of names) counts[part(name)] = Math.max(0, Number(creep.getActiveBodyparts(part(name))) || 0);
    return counts;
  }
  return bodyCounts(creep.body || []);
}

function fromCounts(counts, role) {
  const v = empty();
  const work = counts[part('WORK')] || 0;
  const carry = counts[part('CARRY')] || 0;
  const move = counts[part('MOVE')] || 0;
  const claim = counts[part('CLAIM')] || 0;
  const attack = counts[part('ATTACK')] || 0;
  const ranged = counts[part('RANGED_ATTACK')] || 0;
  const heal = counts[part('HEAL')] || 0;
  const tough = counts[part('TOUGH')] || 0;

  if (role === 'harvester') v.workHarvest = work;
  if (role === 'worker' || role === 'builder' || role === 'repairer') {
    v.workBuild = work;
    v.workRepair = work;
  }
  if (role === 'worker' || role === 'builder' || role === 'repairer' || role === 'upgrader') v.workUpgrade = work;
  if (role === 'hauler') v.carry = carry;
  v.moveEffective = move;
  v.claim = claim;
  v.reserve = claim;
  v.attack = attack;
  v.ranged = ranged;
  v.heal = heal;
  v.dismantle = work;
  v.toughEffective = tough;
  return v;
}

function fromCreep(creep) {
  const role = creep && creep.memory && creep.memory.role ? creep.memory.role : null;
  return fromCounts(creepCounts(creep), role);
}

function fromBody(body, role) {
  return fromCounts(bodyCounts(body), role);
}

function add(a, b) {
  const out = empty();
  for (const key in out) out[key] = (Number(a && a[key]) || 0) + (Number(b && b[key]) || 0);
  return out;
}

function sum(creeps) {
  let total = empty();
  for (const creep of creeps || []) total = add(total, fromCreep(creep));
  return total;
}

function capability(vector, name) {
  if (!vector) return 0;
  return Math.max(0, Number(vector[name]) || 0);
}

function requestCapability(request) {
  return request && request.demand ? request.demand.capability || null : null;
}

function deliveredForRequest(vector, request) {
  const name = requestCapability(request);
  if (name === 'bootstrap') {
    return Math.min(
      capability(vector, 'workHarvest') + capability(vector, 'workBuild'),
      capability(vector, 'carry') || capability(vector, 'moveEffective'),
      capability(vector, 'moveEffective')
    );
  }
  return capability(vector, name);
}

module.exports = {
  SCHEMA_VERSION,
  empty,
  bodyCounts,
  creepCounts,
  fromCounts,
  fromCreep,
  fromBody,
  add,
  sum,
  capability,
  requestCapability,
  deliveredForRequest,
  _test: { part }
};