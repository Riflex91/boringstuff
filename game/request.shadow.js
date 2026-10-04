'use strict';

const registry = require('request.registry');
const energy = require('energy');
const workRequests = require('request.work.shadow');

function roomName(state) {
  return state && state.room && state.room.name ? state.room.name : null;
}

function creepTarget(creep, fallbackRoom) {
  return {
    roomName: creep && creep.room && creep.room.name ? creep.room.name : fallbackRoom,
    id: creep ? creep.id || null : null,
    pos: creep && creep.pos ? { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName || fallbackRoom } : null
  };
}

function consumerPriority(creep) {
  const wait = creep && creep.memory ? Math.max(0, creep.memory.waitingEnergyTicks || 0) : 0;
  const fallback = !!(creep && creep.memory && creep.memory.logisticsFallback);
  const empty = energy.energyAmount(creep) <= 0;
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

function upsertActive(active, room, spec, memoryRoot, game) {
  const request = registry.upsert(room, spec, memoryRoot, game);
  active.push(request.dedupeKey);
  return request;
}

function produce(state, memoryRoot, game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const room = roomName(state);
  if (!room) return { activeDedupeKeys: [], summary: null, requests: [] };

  const active = [];
  const model = state.economyModel || {};

  if (state.emergency) {
    upsertActive(active, room, {
      dedupeKey: 'recovery:bootstrap',
      domain: 'recovery',
      kind: 'RECOVERY_CAPACITY',
      target: { roomName: room },
      demand: { capability: 'bootstrap', amount: 1, minimumUsefulAmount: 1, maximumUsefulAmount: 1 },
      priority: { base: 100, urgency: 100, strategicClass: 'RECOVERY' },
      utility: { current: 100, marginalModel: 'BINARY' },
      evidence: { source: 'legacy-emergency-flag', hypothesis: 'legacy recovery condition mirrored in E0 shadow registry' },
      shadow: true
    }, memoryRoot, game);
  }

  if (Number.isFinite(model.harvesterWorkDeficit) && model.harvesterWorkDeficit > 0) {
    upsertActive(active, room, {
      dedupeKey: 'economy:harvest-capacity',
      domain: 'economy',
      kind: 'HARVEST_CAPACITY',
      target: { roomName: room },
      demand: { capability: 'workHarvest', amount: model.harvesterWorkDeficit, minimumUsefulAmount: 1 },
      priority: { base: 95, urgency: Math.min(100, model.harvesterWorkDeficit * 15), strategicClass: 'CORE_ECONOMY' },
      utility: { current: model.harvesterWorkDeficit, marginalModel: 'LINEAR' },
      evidence: { source: 'economy.model.harvesterWorkDeficit', hypothesis: 'mirror legacy mining capacity deficit' },
      shadow: true
    }, memoryRoot, game);
  }

  if (Number.isFinite(model.haulerCarryDeficit) && model.haulerCarryDeficit > 0) {
    upsertActive(active, room, {
      dedupeKey: 'logistics:haul-capacity',
      domain: 'logistics',
      kind: 'HAUL_CAPACITY',
      target: { roomName: room },
      demand: { capability: 'carry', amount: model.haulerCarryDeficit, minimumUsefulAmount: 1 },
      priority: { base: 90, urgency: Math.min(100, model.haulerCarryDeficit * 10), strategicClass: 'CORE_ECONOMY' },
      utility: { current: model.haulerCarryDeficit, marginalModel: 'LINEAR' },
      evidence: { source: 'economy.model.haulerCarryDeficit', hypothesis: 'mirror legacy transport capacity deficit' },
      shadow: true
    }, memoryRoot, game);
  }

  for (const creep of state.creeps || []) {
    if (!energy.consumerNeedsDelivery(creep)) continue;
    const amount = Math.max(0, energy.freeEnergyCapacity(creep));
    if (amount <= 0) continue;
    const id = creep.id || creep.name;
    upsertActive(active, room, {
      dedupeKey: 'logistics:consumer-energy:' + id,
      domain: 'logistics',
      kind: 'ENERGY_DELIVERY',
      target: creepTarget(creep, room),
      demand: {
        resourceType: typeof RESOURCE_ENERGY !== 'undefined' ? RESOURCE_ENERGY : 'energy',
        amount,
        minimumUsefulAmount: Math.min(amount, 50),
        maximumUsefulAmount: amount
      },
      priority: consumerPriority(creep),
      utility: { current: amount, marginalModel: 'SATURATING' },
      evidence: { source: 'energy.consumerNeedsDelivery', hypothesis: 'mirror legacy consumer delivery request' },
      shadow: true
    }, memoryRoot, game);
  }

  for (const spec of workRequests.specs(state)) {
    upsertActive(active, room, spec, memoryRoot, game);
  }

  registry.reconcile(room, active, memoryRoot, game);
  return {
    activeDedupeKeys: active,
    summary: registry.snapshot(room, memoryRoot),
    requests: registry.list(room, memoryRoot)
  };
}

module.exports = {
  produce,
  _test: { roomName, creepTarget, consumerPriority }
};