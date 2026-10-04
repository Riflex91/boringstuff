'use strict';

const FEATURE_KEYS = Object.freeze([
  'market',
  'powerCreeps',
  'factories',
  'labs',
  'observers',
  'nukers',
  'segments',
  'interShardMemory',
  'roomStatus',
  'heapStats'
]);

function root() {
  return typeof globalThis !== 'undefined' ? globalThis : {};
}

function hasGlobal(name) {
  const g = root();
  return typeof g[name] !== 'undefined' && g[name] !== null;
}

function hasFunction(value, name) {
  return !!value && typeof value[name] === 'function';
}

function probe(game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const g = root();
  const cpu = game && game.cpu ? game.cpu : null;
  const map = game && game.map ? game.map : null;

  return {
    market: !!(game && game.market),
    powerCreeps: !!(game && game.powerCreeps) || hasGlobal('POWER_CREEP_LIFE_TIME'),
    factories: hasGlobal('STRUCTURE_FACTORY'),
    labs: hasGlobal('STRUCTURE_LAB'),
    observers: hasGlobal('STRUCTURE_OBSERVER'),
    nukers: hasGlobal('STRUCTURE_NUKER'),
    segments: hasGlobal('RawMemory') && hasFunction(g.RawMemory, 'setActiveSegments'),
    interShardMemory: hasGlobal('InterShardMemory'),
    roomStatus: hasFunction(map, 'getRoomStatus'),
    heapStats: hasFunction(cpu, 'getHeapStatistics')
  };
}

function isAvailable(capabilities, feature) {
  if (!capabilities || !feature) return false;
  switch (feature) {
    case 'market': return !!(capabilities.systems && capabilities.systems.marketAvailable);
    case 'powerCreeps': return !!(capabilities.systems && capabilities.systems.powerCreepsAvailable);
    case 'factories': return !!(capabilities.systems && capabilities.systems.factoriesAvailable);
    case 'labs': return !!(capabilities.systems && capabilities.systems.labsAvailable);
    case 'observers': return !!(capabilities.systems && capabilities.systems.observersAvailable);
    case 'nukers': return !!(capabilities.systems && capabilities.systems.nukersAvailable);
    case 'segments': return !!(capabilities.persistence && capabilities.persistence.segmentsAvailable);
    case 'interShardMemory': return !!(capabilities.persistence && capabilities.persistence.interShardMemoryAvailable);
    case 'roomStatus': return !!(capabilities.world && capabilities.world.roomStatusAvailable);
    case 'heapStats': return !!(capabilities.cpu && capabilities.cpu.heapStatsAvailable);
    default: return false;
  }
}

function requirements(capabilities, features) {
  const list = Array.isArray(features) ? features : [features];
  const missing = list.filter(feature => !isAvailable(capabilities, feature));
  return {
    ready: missing.length === 0,
    missing
  };
}

module.exports = {
  FEATURE_KEYS,
  probe,
  isAvailable,
  requirements,
  _test: { hasGlobal, hasFunction }
};