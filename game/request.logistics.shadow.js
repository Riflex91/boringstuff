'use strict';

const energy = require('energy');

const SCHEMA_VERSION = 1;
const KINDS = Object.freeze({
  PICKUP: 'PICKUP',
  DELIVER: 'DELIVER',
  BALANCE: 'BALANCE',
  RESERVE: 'RESERVE',
  EMERGENCY_DELIVER: 'EMERGENCY_DELIVER'
});

function energyResource() {
  return typeof RESOURCE_ENERGY !== 'undefined' ? RESOURCE_ENERGY : 'energy';
}

function structureType(name, fallback) {
  return typeof globalThis !== 'undefined' && typeof globalThis[name] !== 'undefined'
    ? globalThis[name]
    : fallback;
}

function storedEnergy(target) {
  if (!target) return 0;
  if (target.store) return Math.max(0, Number(target.store[energyResource()]) || 0);
  if (Number.isFinite(target.energy)) return Math.max(0, target.energy);
  return 0;
}

function freeEnergy(target) {
  if (!target) return 0;
  if (target.store && typeof target.store.getFreeCapacity === 'function') {
    return Math.max(0, Number(target.store.getFreeCapacity(energyResource())) || 0);
  }
  if (Number.isFinite(target.energyCapacity) && Number.isFinite(target.energy)) {
    return Math.max(0, target.energyCapacity - target.energy);
  }
  return 0;
}

function endpoint(object, roomName) {
  if (!object) return { roomName: roomName || null, id: null, pos: null };
  const pos = object.pos;
  return {
    roomName: pos && pos.roomName ? pos.roomName : (object.room && object.room.name ? object.room.name : roomName || null),
    id: object.id || null,
    pos: pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)
      ? { x: pos.x, y: pos.y, roomName: pos.roomName || roomName || null }
      : null
  };
}

function range(a, b) {
  const ap = a && a.pos ? a.pos : a;
  const bp = b && b.pos ? b.pos : b;
  if (!ap || !bp) return Infinity;
  if (typeof ap.getRangeTo === 'function') {
    try { return Math.max(0, Number(ap.getRangeTo(bp)) || 0); } catch (err) {}
  }
  if (!Number.isFinite(ap.x) || !Number.isFinite(ap.y) || !Number.isFinite(bp.x) || !Number.isFinite(bp.y)) return Infinity;
  return Math.max(Math.abs(ap.x - bp.x), Math.abs(ap.y - bp.y));
}

function isContainer(structure) {
  return !!structure && structure.structureType === structureType('STRUCTURE_CONTAINER', 'container');
}

function sourceContainers(state) {
  const sources = state && Array.isArray(state.sources) ? state.sources : [];
  return (state && Array.isArray(state.structures) ? state.structures : []).filter(structure => {
    if (!isContainer(structure)) return false;
    return sources.some(source => range(source, structure) <= 1);
  });
}

function controllerBuffer(state) {
  const controller = state && state.room ? state.room.controller : null;
  if (!controller) return null;
  let best = null;
  for (const structure of state.structures || []) {
    if (!isContainer(structure) || range(controller, structure) > 1) continue;
    if (!best || String(structure.id || '').localeCompare(String(best.id || '')) < 0) best = structure;
  }
  return best;
}

function infrastructurePriority(structure) {
  const type = structure && structure.structureType;
  if (type === structureType('STRUCTURE_SPAWN', 'spawn')) return 95;
  if (type === structureType('STRUCTURE_EXTENSION', 'extension')) return 90;
  if (type === structureType('STRUCTURE_TOWER', 'tower')) return 82;
  return 60;
}

function infrastructureTargets(state) {
  const spawn = structureType('STRUCTURE_SPAWN', 'spawn');
  const extension = structureType('STRUCTURE_EXTENSION', 'extension');
  const tower = structureType('STRUCTURE_TOWER', 'tower');
  return (state.structures || []).filter(structure => {
    if (!structure || structure.my === false) return false;
    if (structure.structureType !== spawn && structure.structureType !== extension && structure.structureType !== tower) return false;
    return freeEnergy(structure) > 0;
  });
}

function consumerPriority(creep) {
  const wait = creep && creep.memory ? Math.max(0, Number(creep.memory.waitingEnergyTicks) || 0) : 0;
  const fallback = !!(creep && creep.memory && creep.memory.logisticsFallback);
  const empty = storedEnergy(creep) <= 0;
  let base = 65;
  if (empty) base += 10;
  if (wait > 0) base += 10;
  if (fallback) base += 15;
  return {
    base,
    urgency: Math.min(100, wait * 5 + (fallback ? 30 : 0)),
    strategicClass: fallback || wait > 0 ? 'CORE_ECONOMY' : 'PRODUCTIVE_WORK'
  };
}

function pickupSpecs(state) {
  const roomName = state.room && state.room.name;
  const result = [];
  for (const container of sourceContainers(state)) {
    const amount = storedEnergy(container);
    if (amount <= 0) continue;
    result.push({
      dedupeKey: 'logistics:e3:pickup:' + (container.id || (container.pos && container.pos.x + ':' + container.pos.y)),
      domain: 'logistics',
      kind: KINDS.PICKUP,
      source: endpoint(container, roomName),
      target: { roomName },
      demand: {
        resourceType: energyResource(),
        capability: 'transportEnergy',
        amount,
        minimumUsefulAmount: Math.min(50, amount),
        maximumUsefulAmount: amount
      },
      priority: { base: 80, urgency: 0, strategicClass: 'CORE_ECONOMY' },
      utility: { current: amount, marginalModel: 'SATURATING' },
      evidence: { source: 'E3-source-container', hypothesis: 'source buffers publish available transport supply' },
      shadow: true
    });
  }
  return result;
}

function infrastructureDeliverySpecs(state) {
  const roomName = state.room && state.room.name;
  const reserveFloor = Math.min(300, Math.max(0, Number(state.energyCapacityAvailable) || 0));
  const lowInfrastructureEnergy = reserveFloor > 0 && Math.max(0, Number(state.energyAvailable) || 0) < reserveFloor;
  const result = [];
  for (const target of infrastructureTargets(state)) {
    const amount = freeEnergy(target);
    if (amount <= 0) continue;
    const emergency = !!state.emergency || lowInfrastructureEnergy;
    const base = infrastructurePriority(target);
    result.push({
      dedupeKey: 'logistics:e3:' + (emergency ? 'emergency-deliver:' : 'deliver:') + (target.id || target.structureType),
      domain: 'logistics',
      kind: emergency ? KINDS.EMERGENCY_DELIVER : KINDS.DELIVER,
      source: null,
      target: endpoint(target, roomName),
      demand: {
        resourceType: energyResource(),
        capability: 'transportEnergy',
        amount,
        minimumUsefulAmount: Math.min(50, amount),
        maximumUsefulAmount: amount
      },
      priority: {
        base: emergency ? Math.min(100, base + 5) : base,
        urgency: emergency ? 50 : 0,
        strategicClass: 'CORE_ECONOMY'
      },
      utility: { current: amount, marginalModel: 'SATURATING' },
      evidence: { source: 'E3-infrastructure-buffer', hypothesis: 'spawn/extensions/towers publish explicit energy delivery demand' },
      shadow: true
    });
  }
  return result;
}

function consumerDeliverySpecs(state) {
  const roomName = state.room && state.room.name;
  const result = [];
  for (const creep of state.creeps || []) {
    if (!energy.consumerNeedsDelivery(creep)) continue;
    const amount = freeEnergy(creep);
    if (amount <= 0) continue;
    const wait = creep.memory ? Math.max(0, Number(creep.memory.waitingEnergyTicks) || 0) : 0;
    const fallback = !!(creep.memory && creep.memory.logisticsFallback);
    const emergency = fallback || wait > 0;
    const id = creep.id || creep.name;
    result.push({
      dedupeKey: 'logistics:e3:' + (emergency ? 'emergency-consumer:' : 'deliver-consumer:') + id,
      domain: 'logistics',
      kind: emergency ? KINDS.EMERGENCY_DELIVER : KINDS.DELIVER,
      source: null,
      target: endpoint(creep, roomName),
      demand: {
        resourceType: energyResource(),
        capability: 'transportEnergy',
        amount,
        minimumUsefulAmount: Math.min(50, amount),
        maximumUsefulAmount: amount
      },
      priority: consumerPriority(creep),
      utility: { current: amount, marginalModel: 'SATURATING' },
      evidence: { source: 'E3-productive-consumer', hypothesis: 'productive consumers publish explicit energy delivery demand' },
      shadow: true
    });
  }
  return result;
}

function reserveSpecs(state) {
  const roomName = state.room && state.room.name;
  const capacity = Math.max(0, Number(state.energyCapacityAvailable) || 0);
  const reserve = Math.min(300, capacity);
  const available = Math.max(0, Number(state.energyAvailable) || 0);
  const missing = Math.max(0, reserve - available);
  if (!state.spawn || reserve <= 0 || missing <= 0) return [];
  return [{
    dedupeKey: 'logistics:e3:reserve:spawn-energy',
    domain: 'logistics',
    kind: KINDS.RESERVE,
    source: null,
    target: endpoint(state.spawn, roomName),
    demand: {
      resourceType: energyResource(),
      capability: 'reserveEnergy',
      amount: missing,
      minimumUsefulAmount: Math.min(50, missing),
      maximumUsefulAmount: missing
    },
    priority: {
      base: 92,
      urgency: Math.min(100, Math.ceil((missing / Math.max(1, reserve)) * 100)),
      strategicClass: 'CORE_ECONOMY'
    },
    utility: { current: missing, marginalModel: 'SATURATING' },
    evidence: { source: 'legacy-spawn-energy-floor', hypothesis: 'make the existing minimum spawn-energy reserve explicit before E4 matching' },
    shadow: true
  }];
}

function balanceSpecs(state) {
  const roomName = state.room && state.room.name;
  const target = controllerBuffer(state);
  if (!target) return [];
  const free = freeEnergy(target);
  if (free <= 0) return [];
  const producers = sourceContainers(state)
    .filter(container => container.id !== target.id && storedEnergy(container) > 0)
    .sort((a, b) => storedEnergy(b) - storedEnergy(a) || String(a.id || '').localeCompare(String(b.id || '')));
  const source = producers[0];
  if (!source) return [];
  const amount = Math.min(free, storedEnergy(source));
  if (amount <= 0) return [];
  return [{
    dedupeKey: 'logistics:e3:balance:controller-buffer',
    domain: 'logistics',
    kind: KINDS.BALANCE,
    source: endpoint(source, roomName),
    target: endpoint(target, roomName),
    demand: {
      resourceType: energyResource(),
      capability: 'transportEnergy',
      amount,
      minimumUsefulAmount: Math.min(50, amount),
      maximumUsefulAmount: amount
    },
    priority: { base: 45, urgency: 0, strategicClass: 'PRODUCTIVE_WORK' },
    utility: { current: amount, marginalModel: 'SATURATING' },
    evidence: { source: 'E3-controller-buffer-balance', hypothesis: 'move surplus source-buffer energy toward controller-side productive demand' },
    shadow: true
  }];
}

function specs(state) {
  if (!state || !state.room || !Array.isArray(state.structures)) return [];
  const result = []
    .concat(pickupSpecs(state))
    .concat(infrastructureDeliverySpecs(state))
    .concat(consumerDeliverySpecs(state))
    .concat(reserveSpecs(state))
    .concat(balanceSpecs(state));
  result.sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
  return result;
}

function summary(requestSpecs) {
  const byKind = {};
  const amountByKind = {};
  let totalAmount = 0;
  for (const spec of requestSpecs || []) {
    const kind = spec.kind || 'UNKNOWN';
    const amount = spec.demand && Number.isFinite(spec.demand.amount) ? Math.max(0, spec.demand.amount) : 0;
    byKind[kind] = (byKind[kind] || 0) + 1;
    amountByKind[kind] = (amountByKind[kind] || 0) + amount;
    totalAmount += amount;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    total: (requestSpecs || []).length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    byKind,
    amountByKind
  };
}

module.exports = {
  SCHEMA_VERSION,
  KINDS,
  specs,
  summary,
  _test: {
    storedEnergy,
    freeEnergy,
    endpoint,
    range,
    sourceContainers,
    controllerBuffer,
    infrastructurePriority,
    infrastructureTargets,
    consumerPriority,
    pickupSpecs,
    infrastructureDeliverySpecs,
    consumerDeliverySpecs,
    reserveSpecs,
    balanceSpecs
  }
};
