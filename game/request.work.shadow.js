'use strict';

const config = require('config');

function partValue(name, fallback) {
  return typeof globalThis !== 'undefined' && Number.isFinite(globalThis[name]) ? globalThis[name] : fallback;
}

function workPart() {
  return typeof globalThis !== 'undefined' && typeof globalThis.WORK !== 'undefined' ? globalThis.WORK : 'work';
}

function activeWork(creep) {
  if (!creep) return 0;
  if (typeof creep.getActiveBodyparts === 'function') return Math.max(0, Number(creep.getActiveBodyparts(workPart())) || 0);
  if (!Array.isArray(creep.body)) return 0;
  return creep.body.reduce((sum, item) => {
    const type = typeof item === 'string' ? item : item && item.type;
    const hits = typeof item === 'object' && item ? item.hits : 100;
    return sum + (type === workPart() && hits > 0 ? 1 : 0);
  }, 0);
}

function productiveRole(creep) {
  const role = creep && creep.memory ? creep.memory.role : null;
  return role === 'worker' || role === 'builder' || role === 'repairer' || role === 'upgrader';
}

function totalProductiveWork(state) {
  let total = 0;
  for (const creep of state.creeps || []) {
    if (creep.spawning || !productiveRole(creep)) continue;
    total += activeWork(creep);
  }
  return total;
}

function structureType(name, fallback) {
  return typeof globalThis !== 'undefined' && typeof globalThis[name] !== 'undefined' ? globalThis[name] : fallback;
}

function constructionPriority(site) {
  const type = site && site.structureType;
  if (type === structureType('STRUCTURE_SPAWN', 'spawn')) return 0;
  if (type === structureType('STRUCTURE_EXTENSION', 'extension')) return 1;
  if (type === structureType('STRUCTURE_CONTAINER', 'container')) return 2;
  if (type === structureType('STRUCTURE_TOWER', 'tower')) return 3;
  if (type === structureType('STRUCTURE_STORAGE', 'storage')) return 4;
  if (type === structureType('STRUCTURE_LINK', 'link')) return 5;
  if (type === structureType('STRUCTURE_TERMINAL', 'terminal')) return 6;
  if (type === structureType('STRUCTURE_ROAD', 'road')) return 20;
  if (type === structureType('STRUCTURE_RAMPART', 'rampart')) return 30;
  if (type === structureType('STRUCTURE_WALL', 'constructedWall')) return 31;
  return 10;
}

function posTarget(object, roomName) {
  return {
    roomName,
    id: object && object.id ? object.id : null,
    pos: object && object.pos ? { x: object.pos.x, y: object.pos.y, roomName: object.pos.roomName || roomName } : null
  };
}

function buildSpecs(state) {
  const roomName = state.room && state.room.name;
  const buildPower = partValue('BUILD_POWER', 5);
  const specs = [];
  for (const site of state.sites || []) {
    const remainingProgress = Math.max(0, (Number(site.progressTotal) || 0) - (Number(site.progress) || 0));
    if (remainingProgress <= 0) continue;
    const priority = constructionPriority(site);
    const critical = priority <= 4;
    specs.push({
      dedupeKey: 'work:build:' + (site.id || (site.structureType + ':' + site.pos.x + ':' + site.pos.y)),
      domain: 'work',
      kind: 'BUILD',
      target: posTarget(site, roomName),
      demand: {
        capability: 'workBuild',
        amount: Math.max(1, Math.ceil(remainingProgress / Math.max(1, buildPower))),
        minimumUsefulAmount: 1
      },
      priority: {
        base: Math.max(20, 90 - Math.min(60, priority * 2)),
        urgency: critical ? 20 : 0,
        strategicClass: critical ? 'INFRASTRUCTURE' : 'PRODUCTIVE_WORK'
      },
      utility: { current: critical ? 80 : 50, marginalModel: 'LINEAR' },
      evidence: { source: 'legacy-construction-site', hypothesis: 'shadow work request from existing construction backlog' },
      shadow: true
    });
  }
  return specs;
}

function repairTargetHits(structure, rcl) {
  if (!structure || !Number.isFinite(structure.hits) || !Number.isFinite(structure.hitsMax)) return null;
  if (structure.hits >= structure.hitsMax) return null;
  const wall = structureType('STRUCTURE_WALL', 'constructedWall');
  const rampart = structureType('STRUCTURE_RAMPART', 'rampart');
  if (structure.structureType === wall || structure.structureType === rampart) {
    const multiplier = Number.isFinite(config.REPAIR_WALL_TARGET_RCL_MULTIPLIER) ? config.REPAIR_WALL_TARGET_RCL_MULTIPLIER : 10000;
    const cap = Math.max(10000, (Number(rcl) || 1) * multiplier);
    return structure.hits < cap ? Math.min(structure.hitsMax, cap) : null;
  }
  const threshold = Math.floor(structure.hitsMax * 0.65);
  return structure.hits < threshold ? threshold : null;
}

function repairSpecs(state) {
  const roomName = state.room && state.room.name;
  const repairPower = partValue('REPAIR_POWER', 100);
  const specs = [];
  for (const structure of state.structures || []) {
    const targetHits = repairTargetHits(structure, state.rcl);
    if (!Number.isFinite(targetHits) || targetHits <= structure.hits) continue;
    const gap = targetHits - structure.hits;
    const criticalType = structure.structureType === structureType('STRUCTURE_SPAWN', 'spawn') ||
      structure.structureType === structureType('STRUCTURE_TOWER', 'tower') ||
      structure.structureType === structureType('STRUCTURE_STORAGE', 'storage');
    specs.push({
      dedupeKey: 'work:repair:' + (structure.id || (structure.structureType + ':' + structure.pos.x + ':' + structure.pos.y)),
      domain: 'work',
      kind: 'REPAIR',
      target: posTarget(structure, roomName),
      demand: {
        capability: 'workRepair',
        amount: Math.max(1, Math.ceil(gap / Math.max(1, repairPower))),
        minimumUsefulAmount: 1
      },
      priority: {
        base: criticalType ? 70 : 55,
        urgency: criticalType ? 20 : 0,
        strategicClass: criticalType ? 'INFRASTRUCTURE' : 'MAINTENANCE'
      },
      utility: { current: Math.min(100, Math.ceil(gap / Math.max(1, repairPower))), marginalModel: 'LINEAR' },
      evidence: { source: 'legacy-repair-threshold', hypothesis: 'shadow repair request mirrors current worker repair eligibility' },
      shadow: true
    });
  }
  return specs;
}

function upgradeSpec(state) {
  const controller = state.room && state.room.controller;
  if (!controller || !controller.my || (Number(controller.level) || 0) >= 8) return null;
  const capacity = totalProductiveWork(state);
  if (capacity <= 0) return null;
  const downgrade = Number.isFinite(controller.ticksToDowngrade) ? controller.ticksToDowngrade : null;
  let urgency = 0;
  if (downgrade !== null && downgrade < 5000) urgency = 60;
  else if (downgrade !== null && downgrade < 10000) urgency = 30;
  return {
    dedupeKey: 'work:upgrade:controller',
    domain: 'work',
    kind: 'UPGRADE',
    target: posTarget(controller, state.room.name),
    demand: { capability: 'workUpgrade', amount: capacity, minimumUsefulAmount: 1 },
    priority: { base: 40, urgency, strategicClass: urgency ? 'CONTROLLER_SAFETY' : 'PRODUCTIVE_WORK' },
    utility: { current: urgency ? 80 : 30, marginalModel: 'LINEAR' },
    evidence: { source: 'owned-controller', hypothesis: 'shadow controller work absorbs productive capacity left after higher-value work' },
    shadow: true
  };
}

function specs(state) {
  if (!state || !state.room) return [];
  const result = buildSpecs(state).concat(repairSpecs(state));
  const upgrade = upgradeSpec(state);
  if (upgrade) result.push(upgrade);
  result.sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
  return result;
}

module.exports = {
  specs,
  _test: { activeWork, productiveRole, totalProductiveWork, constructionPriority, repairTargetHits, buildSpecs, repairSpecs, upgradeSpec }
};