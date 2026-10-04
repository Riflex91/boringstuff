'use strict';

const SCHEMA_VERSION = 1;

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function ownedRoomCount(game) {
  if (!game || !game.rooms) return 0;
  let count = 0;
  for (const name in game.rooms) {
    const room = game.rooms[name];
    if (room && room.controller && room.controller.my) count++;
  }
  return count;
}

function hasGlobal(name) {
  return typeof globalThis !== 'undefined' && typeof globalThis[name] !== 'undefined';
}

function observe(game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);

  const cpu = game && game.cpu ? game.cpu : null;
  const gcl = game && game.gcl ? game.gcl : null;
  const map = game && game.map ? game.map : null;

  return {
    schemaVersion: SCHEMA_VERSION,
    environment: {
      shardName: game && game.shard && game.shard.name ? String(game.shard.name) : null,
      serverFingerprint: null
    },
    cpu: {
      limit: finiteOrNull(cpu && cpu.limit),
      bucket: finiteOrNull(cpu && cpu.bucket),
      observedBucketMax: null,
      heapStatsAvailable: !!(cpu && typeof cpu.getHeapStatistics === 'function')
    },
    persistence: {
      segmentsAvailable: hasGlobal('RawMemory') && !!globalThis.RawMemory && typeof globalThis.RawMemory.setActiveSegments === 'function',
      interShardMemoryAvailable: hasGlobal('InterShardMemory') && !!globalThis.InterShardMemory
    },
    systems: {
      marketAvailable: !!(game && game.market),
      powerCreepsAvailable: !!(game && game.powerCreeps) || hasGlobal('POWER_CREEP_LIFE_TIME'),
      factoriesAvailable: hasGlobal('STRUCTURE_FACTORY'),
      labsAvailable: hasGlobal('STRUCTURE_LAB'),
      observersAvailable: hasGlobal('STRUCTURE_OBSERVER'),
      nukersAvailable: hasGlobal('STRUCTURE_NUKER')
    },
    ownership: {
      gclLevel: finiteOrNull(gcl && gcl.level),
      ownedRooms: ownedRoomCount(game),
      activeClaimCommitments: 0,
      discoveredClaimLimit: null,
      claimPolicyConfidence: 0,
      lastClaimFailure: null
    },
    world: {
      roomStatusAvailable: !!(map && typeof map.getRoomStatus === 'function'),
      worldStatusAvailable: false
    },
    observed: {
      tickDurationMsEMA: null,
      lastUpdatedTick: finiteOrNull(game && game.time)
    }
  };
}

module.exports = {
  SCHEMA_VERSION,
  observe,
  _test: { ownedRoomCount, finiteOrNull, hasGlobal }
};