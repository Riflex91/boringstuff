'use strict';

const featureRegistry = require('feature.registry');

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

function observe(game, serverProfile) {
  game = game || (typeof Game !== 'undefined' ? Game : null);

  const cpu = game && game.cpu ? game.cpu : null;
  const gcl = game && game.gcl ? game.gcl : null;
  const features = featureRegistry.probe(game);
  const claimPolicy = serverProfile && serverProfile.claimPolicy ? serverProfile.claimPolicy : null;

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
      heapStatsAvailable: features.heapStats
    },
    persistence: {
      segmentsAvailable: features.segments,
      interShardMemoryAvailable: features.interShardMemory
    },
    systems: {
      marketAvailable: features.market,
      powerCreepsAvailable: features.powerCreeps,
      factoriesAvailable: features.factories,
      labsAvailable: features.labs,
      observersAvailable: features.observers,
      nukersAvailable: features.nukers
    },
    ownership: {
      gclLevel: finiteOrNull(gcl && gcl.level),
      ownedRooms: ownedRoomCount(game),
      activeClaimCommitments: 0,
      discoveredClaimLimit: claimPolicy && Number.isFinite(claimPolicy.discoveredClaimLimit) ? claimPolicy.discoveredClaimLimit : null,
      claimPolicyConfidence: claimPolicy && Number.isFinite(claimPolicy.confidence) ? claimPolicy.confidence : 0,
      lastClaimFailure: claimPolicy ? claimPolicy.lastFailure || null : null
    },
    world: {
      roomStatusAvailable: features.roomStatus,
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
  _test: { ownedRoomCount, finiteOrNull }
};