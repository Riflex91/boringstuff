'use strict';

const stateBuilder = require('room.state');
const spawnManager = require('spawn.manager');
const towerManager = require('tower.manager');
const planner = require('room.planner');
const economyMetrics = require('economy.metrics');
const economyModel = require('economy.model');
const colonyHealth = require('colony.health');
const colonyEfficiency = require('colony.efficiency');
const colonyState = require('colony.state');
const requestShadow = require('request.shadow');
const assignmentShadow = require('assignment.shadow');
const assignmentEvidence = require('assignment.evidence');
const capacitySpawnShadow = require('spawn.capacity.shadow');
const logisticsMatchingShadow = require('logistics.matching.shadow');
const logisticsMatchingEvidence = require('logistics.matching.evidence');
const profiler = require('profiler');
const logger = require('logger');
const config = require('config');

function status(state) {
  return {
    room: state.room.name,
    rcl: state.rcl,
    energy: state.energyAvailable + '/' + state.energyCapacityAvailable,
    stored: state.energyStored,
    creeps: state.byRole,
    sites: state.sites.length,
    hostiles: state.hostileCreeps.length,
    economyModel: state.economyModel,
    health: state.health,
    efficiency: state.efficiency,
    requests: state.requestShadow ? state.requestShadow.summary : null,
    logisticsRequests: state.requestShadow ? state.requestShadow.logisticsGraph : null,
    scoutingFrontier: state.requestShadow ? state.requestShadow.scoutingFrontier : null,
    capacitySpawn: state.capacitySpawnShadow ? state.capacitySpawnShadow.summary : null,
    assignments: state.assignmentShadow ? state.assignmentShadow.summary : null,
    logisticsMatching: state.logisticsMatchingShadow ? state.logisticsMatchingShadow.summary : null,
    logisticsMatchingEvidence: state.logisticsMatchingEvidence ? (state.logisticsMatchingEvidence.lastWindow || state.logisticsMatchingEvidence.current) : null,
    assignmentEvidence: state.assignmentEvidence ? (state.assignmentEvidence.lastWindow || state.assignmentEvidence.current) : null,
    colonyStateAvailable: !!state.colonyState
  };
}

function maybeSafeMode(state) {
  if (!config.AUTO_SAFE_MODE || !state.room.controller || !state.room.controller.my) return;
  const controller = state.room.controller;
  if (!state.hostileCreeps.length || controller.safeMode || !controller.safeModeAvailable) return;
  const critical = state.structures.some(s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_STORAGE) && s.hits < s.hitsMax * 0.35);
  if (critical) {
    const rc = controller.activateSafeMode();
    logger.warn('SAFE_MODE_ATTEMPT', 'Automatic safe mode attempted', { room: state.room.name, rc, hostiles: state.hostileCreeps.length }, { force: true, persist: true, dedupeTicks: 0 });
  }
}

function maybeWarnUpgraderStall(state) {
  if (!state.room.controller || !state.room.controller.my || state.rcl >= 8) return;
  const upgraders = state.byRole.upgrader || 0;
  if (!upgraders) return;
  const idle = state.economyMetrics ? state.economyMetrics.controllerIdleTicks : 0;
  const present = state.economyMetrics ? state.economyMetrics.upgraderPresentStreak : 0;
  if (idle < config.UPGRADER_STALL_TICKS || present < config.UPGRADER_STALL_TICKS) return;

  logger.warn('UPGRADER_STALLED', 'Dedicated upgrader exists but controller progress has not advanced', {
    room: state.room.name,
    rcl: state.rcl,
    upgraders,
    controllerIdleTicks: idle,
    upgraderPresentStreak: present,
    energyAvailable: state.energyAvailable,
    energyCapacity: state.energyCapacityAvailable,
    sites: state.sites.length,
    economyMode: state.economyModel ? state.economyModel.mode : null
  }, { dedupeTicks: config.UPGRADER_STALL_TICKS });
}

const SHADOW_STAGE_FALLBACK_CPU = Object.freeze({
  'room.capacity-spawn': 2.5,
  'room.assignment': 2.5,
  'room.logistics-match': 1.0
});

function shadowCpuHeadroom(detailName, game, memoryRoot) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  if (!game || !game.cpu || typeof game.cpu.getUsed !== 'function' || !Number.isFinite(game.cpu.limit)) return true;

  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  const reserve = Number.isFinite(config.SHADOW_CPU_RESERVE)
    ? Math.max(0, config.SHADOW_CPU_RESERVE)
    : 0;
  const fallback = SHADOW_STAGE_FALLBACK_CPU[detailName] || 1;
  const sample = memoryRoot && memoryRoot.bot && memoryRoot.bot.cpu &&
    memoryRoot.bot.cpu.details && memoryRoot.bot.cpu.details[detailName];
  const historical = sample
    ? Math.max(0, Number(sample.avg) || 0, Number(sample.last) || 0)
    : 0;
  const estimated = Math.max(fallback, historical * 1.15);
  return game.cpu.getUsed() + estimated + reserve <= game.cpu.limit;
}

function run(room, lowCpu) {
  const state = profiler.detailSection('room.state', function() {
    return stateBuilder.get(room);
  });

  profiler.detailSection('room.economy', function() {
    state.economyMetrics = economyMetrics.observe(state);
    state.economyModel = economyModel.analyze(state);

    const roomMemory = Memory.rooms[room.name] || (Memory.rooms[room.name] = {});
    const currentMode = state.economyModel ? state.economyModel.mode : null;
    if (roomMemory.lastEconomyMode !== undefined && roomMemory.lastEconomyMode !== currentMode) {
      logger.info('ECONOMY_MODE_CHANGE', 'Economy model changed operating mode', {
        room: room.name,
        from: roomMemory.lastEconomyMode,
        to: currentMode,
        rcl: state.rcl,
        sourceContainersReady: state.economyModel ? state.economyModel.sourceContainersReady : null
      }, { force: true, persist: true, dedupeTicks: 0 });
    }
    roomMemory.lastEconomyMode = currentMode;
    if (roomMemory.lastObservedRcl !== undefined && roomMemory.lastObservedRcl !== state.rcl) {
      logger.info('RCL_CHANGE', 'Controller level changed', {
        room: room.name,
        from: roomMemory.lastObservedRcl,
        to: state.rcl
      }, { force: true, persist: true, dedupeTicks: 0 });
    }
    roomMemory.lastObservedRcl = state.rcl;

    state.health = colonyHealth.evaluate(state);
    state.efficiency = colonyEfficiency.evaluate(state);
  });

  state.requestShadow = profiler.detailSection('room.requests', function() {
    return requestShadow.produce(state);
  });

  let shadowDeferred = !!lowCpu;
  let shadowDeferReason = lowCpu ? 'LOW_CPU' : null;
  function canRunShadowStage(detailName) {
    if (shadowDeferred) return false;
    if (shadowCpuHeadroom(detailName, Game, Memory)) return true;
    shadowDeferred = true;
    shadowDeferReason = 'CPU_HEADROOM';
    return false;
  }

  state.capacitySpawnShadow = profiler.detailSection('room.capacity-spawn', function() {
    const snapshot = canRunShadowStage('room.capacity-spawn')
      ? capacitySpawnShadow.plan(state, state.requestShadow.requests, Game)
      : capacitySpawnShadow.deferredSnapshot(shadowDeferReason);
    snapshot.summary.legacyDesired = spawnManager.desired(state);
    return snapshot;
  });

  state.assignmentShadow = profiler.detailSection('room.assignment', function() {
    return canRunShadowStage('room.assignment')
      ? assignmentShadow.plan(
          state.room.name,
          state.requestShadow.requests,
          state.creeps,
          undefined,
          Game
        )
      : {
          assignments: [],
          unfilled: [],
          summary: assignmentShadow.deferredSnapshot(state.room.name, shadowDeferReason)
        };
  });

  state.logisticsMatchingShadow = profiler.detailSection('room.logistics-match', function() {
    const snapshot = canRunShadowStage('room.logistics-match')
      ? logisticsMatchingShadow.plan(
          state,
          state.requestShadow.requests,
          undefined,
          Game
        )
      : logisticsMatchingShadow.deferredSnapshot(shadowDeferReason);
    if (snapshot.requestSummary) state.requestShadow.summary = snapshot.requestSummary;
    return snapshot;
  });

  state.logisticsMatchingEvidence = profiler.detailSection('room.logistics-evidence', function() {
    const evidence = logisticsMatchingEvidence.observe(state);
    if (evidence.completed) {
      logger.info('LOGISTICS_MATCHING_EVIDENCE_WINDOW', 'E4 shadow matching evidence window completed', {
        room: state.room.name,
        evidence: evidence.completed
      }, { force: true, persist: true, dedupeTicks: 0 });
    }
    return evidence;
  });

  state.assignmentEvidence = profiler.detailSection('room.evidence', function() {
    const evidence = assignmentEvidence.observe(state);
    if (evidence.completed) {
      logger.info('ASSIGNMENT_EVIDENCE_WINDOW', 'Shadow request/assignment evidence window completed', {
        room: state.room.name,
        evidence: evidence.completed
      }, { force: true, persist: true, dedupeTicks: 0 });
    }
    return evidence;
  });

  state.colonyState = profiler.detailSection('room.colony-state', function() {
    return colonyState.build(state, {
      tick: Game.time,
      bucket: Game.cpu.bucket
    });
  });

  profiler.detailSection('room.legacy', function() {
    towerManager.run(state);
    maybeSafeMode(state);
    maybeWarnUpgraderStall(state);
    spawnManager.spawnOne(state);
  });

  if (!lowCpu && Game.time % config.PLANNER_INTERVAL === 0) {
    profiler.detailSection('room.planner', function() {
      planner.plan(state);
    });
  }

  if (Game.time % config.LOG_HEARTBEAT_INTERVAL === 0) {
    profiler.detailSection('room.heartbeat', function() {
      logger.info('ROOM_HEARTBEAT', 'Room operational snapshot', status(state), { force: true, persist: false, dedupeTicks: 0 });
    });
  }
  return state;
}

module.exports = { run, _test: { status, shadowCpuHeadroom } };
