'use strict';

const config = require('config');
const logger = require('logger');
const profiler = require('profiler');
const roomManager = require('room.manager');
const creepManager = require('creep.manager');
const consumerSupplyObserver = require('consumer.supply.observer');
const stats = require('stats');
const visuals = require('visuals');
const commands = require('commands');
const runtimeCapabilities = require('runtime.capabilities');
const serverProfile = require('server.profile');
const processScheduler = require('process.scheduler');
const worldIntel = require('world.intel');
const colonyState = require('colony.state');
const plannerVNextShadow = require('planner.vnext.shadow');
const defenseMinCutShadow = require('defense.mincut.shadow');
const remoteRoiShadow = require('remote.roi.shadow');
const threatModelShadow = require('threat.model.shadow');

function bootstrapMemory() {
  if (!Memory.bot) Memory.bot = { version: config.VERSION, born: Game.time };
  if (Memory.bot.version !== config.VERSION) {
    logger.info('VERSION_CHANGE', 'Bot code version changed', { from: Memory.bot.version, to: config.VERSION }, { force: true, persist: true, dedupeTicks: 0 });
    Memory.bot.version = config.VERSION;
  }
  if (config.DEPLOYMENT_ID && Memory.bot.deploymentId !== config.DEPLOYMENT_ID) {
    logger.info('DEPLOYMENT_MARKER', 'Bot deployment activated', {
      deploymentId: config.DEPLOYMENT_ID,
      previousDeploymentId: Memory.bot.deploymentId || null,
      version: config.VERSION
    }, { force: true, persist: true, dedupeTicks: 0 });
    Memory.bot.deploymentId = config.DEPLOYMENT_ID;
    Memory.bot.deploymentTick = Game.time;
  }
  if (!Memory.creeps) Memory.creeps = {};
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.bot.worldIntelLegacyMigrated) {
    worldIntel.migrateLegacy();
    Memory.bot.worldIntelLegacyMigrated = true;
  }

  const spawnNames = Object.keys(Game.spawns);
  if (spawnNames.length) {
    const primary = Game.spawns[spawnNames.sort()[0]];
    if (Memory.bot.colonySpawnId !== primary.id) {
      const previous = Memory.bot.sessionId || null;
      Memory.bot.colonySpawnId = primary.id;
      Memory.bot.sessionId = primary.room.name + '-' + Game.time;
      Memory.bot.sessionStarted = Game.time;
      Memory.bot.logs = [];
      Memory.bot.logDedupe = {};
      logger.info('COLONY_SESSION_START', 'Colony session identified', {
        session: Memory.bot.sessionId,
        previousSession: previous,
        room: primary.room.name,
        spawn: primary.name
      }, { force: true, persist: true, dedupeTicks: 0 });
    }
  }
}

function consumerSupplySnapshot(state) {
  const energyKey = typeof RESOURCE_ENERGY !== 'undefined' ? RESOURCE_ENERGY : 'energy';
  const consumers = [];
  const reservations = [];
  for (const creep of state.creeps || []) {
    if (!creep || !creep.memory) continue;
    const role = creep.memory.role;
    if (role === 'hauler') {
      if (creep.memory.consumerTargetId) {
        reservations.push({
          hauler: creep.name || creep.id || null,
          targetId: creep.memory.consumerTargetId,
          carried: creep.store ? Math.max(0, Number(creep.store[energyKey]) || 0) : 0,
          delivering: !!creep.memory.delivering
        });
      }
      continue;
    }
    if (role !== 'builder' && role !== 'worker' && role !== 'repairer' && role !== 'upgrader') continue;
    const waiting = Math.max(0, Number(creep.memory.waitingEnergyTicks) || 0);
    const fallback = !!creep.memory.logisticsFallback;
    if (!waiting && !fallback) continue;
    consumers.push({
      name: creep.name || null,
      id: creep.id || null,
      role,
      energy: creep.store ? Math.max(0, Number(creep.store[energyKey]) || 0) : 0,
      capacity: creep.store && creep.store.getCapacity
        ? Math.max(0, Number(creep.store.getCapacity(energyKey)) || 0)
        : null,
      waiting,
      fallback
    });
  }
  return {
    criticalConsumers: consumers.slice(0, 8),
    consumerReservations: reservations.slice(0, 8)
  };
}

function memoryFootprintSnapshot() {
  let rawBytes = null;
  try {
    if (typeof RawMemory !== 'undefined' && RawMemory && typeof RawMemory.get === 'function') {
      const raw = RawMemory.get();
      if (typeof raw === 'string') rawBytes = raw.length;
    }
  } catch (err) {}

  const journal = Memory.bot && Memory.bot.telemetryJournal || null;
  const snapshots = journal && Array.isArray(journal.snapshots) ? journal.snapshots.length : 0;
  const events = journal && Array.isArray(journal.events) ? journal.events.length : 0;
  const logs = Memory.bot && Array.isArray(Memory.bot.logs) ? Memory.bot.logs.length : 0;
  const cpuHistory = Memory.bot && Memory.bot.cpu && Array.isArray(Memory.bot.cpu.history)
    ? Memory.bot.cpu.history.length
    : 0;

  return {
    rawBytes,
    journalApproxBytes: journal && Number.isFinite(journal.approxBytes) ? journal.approxBytes : null,
    journalRecords: snapshots + events,
    journalDroppedThroughSeq: journal && Number.isFinite(journal.droppedThroughSeq)
      ? journal.droppedThroughSeq
      : 0,
    logs,
    cpuHistory
  };
}

function statusSnapshot(roomStates, tickCpu) {
  const rooms = {};
  const profile = serverProfile.snapshot();
  const capabilities = runtimeCapabilities.observe(undefined, profile);
  const schedulerState = processScheduler.snapshot();
  const worldIntelState = worldIntel.snapshot();
  for (const state of roomStates) {
    const controller = state.room.controller;
    rooms[state.room.name] = {
      rcl: state.rcl,
      controllerProgress: controller ? controller.progress : null,
      controllerProgressTotal: controller ? controller.progressTotal : null,
      ticksToDowngrade: controller ? controller.ticksToDowngrade : null,
      energyAvailable: state.energyAvailable,
      energyCapacity: state.energyCapacityAvailable,
      energyStored: state.energyStored,
      creeps: Object.assign({}, state.byRole),
      constructionSites: state.sites.length,
      hostiles: state.hostileCreeps.length,
      spawnBusy: !!(state.spawn && state.spawn.spawning),
      spawnRemainingTime: state.spawn && state.spawn.spawning ? state.spawn.spawning.remainingTime : 0,
      economy: state.economyMetrics || null,
      economyModel: state.economyModel || null,
      consumerSupply: consumerSupplySnapshot(state),
      health: state.health || null,
      efficiency: state.efficiency || null,
      // Keep E4 evidence shallow enough for logger.slim(). The canonical copy
      // remains in colonyState, but its window fields sit one level beyond the
      // configured serialization depth and otherwise become "[depth-limit]".
      logisticsMatchingEvidence: state.logisticsMatchingEvidence
        ? {
            authority: 'SHADOW_EVIDENCE',
            current: state.logisticsMatchingEvidence.current || null,
            lastWindow: state.logisticsMatchingEvidence.lastWindow || null
          }
        : null,
      colonyState: colonyState.telemetrySummary(state.colonyState),
      plannerVNext: plannerVNextShadow.telemetrySummary(state.plannerVNextShadow),
      defenseMinCut: defenseMinCutShadow.telemetrySummary(state.defenseMinCutShadow),
      remoteRoi: remoteRoiShadow.telemetrySummary(state.remoteRoiShadow),
      threatModel: threatModelShadow.telemetrySummary(state.threatModelShadow)
    };
  }
  logger.info('STATUS_SNAPSHOT', 'Structured bot status snapshot', {
    cpu: Math.round(tickCpu * 1000) / 1000,
    bucket: Game.cpu.bucket,
    gcl: Game.gcl ? { level: Game.gcl.level, progress: Game.gcl.progress, progressTotal: Game.gcl.progressTotal } : null,
    totalCreeps: Object.keys(Game.creeps).length,
    capabilities,
    serverProfile: profile,
    scheduler: schedulerState,
    worldIntel: worldIntelState,
    memoryFootprint: memoryFootprintSnapshot(),
    rooms
  }, { force: true, persist: false, dedupeTicks: 0 });
}

function measureMainDetail(name, fn) {
  const start = Game.cpu.getUsed();
  try {
    return fn();
  } finally {
    profiler.detailValue(name, Math.max(0, Game.cpu.getUsed() - start));
  }
}

function currentSectionTotal(names) {
  let total = 0;
  const sections = Memory.bot && Memory.bot.cpu && Memory.bot.cpu.sections || {};
  for (const name of names) {
    const sample = sections[name];
    if (sample && sample.lastTick === Game.time) total += Math.max(0, Number(sample.last) || 0);
  }
  return total;
}

function cleanupMemory() {
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }
  if (Memory.intel && Game.time % 1000 === 0) {
    for (const room in Memory.intel) if (Game.time - Memory.intel[room].tick > 20000) delete Memory.intel[room];
  }
}

module.exports.loop = function() {
  const tickStart = Game.cpu.getUsed();
  try {
    measureMainDetail('main.bootstrap', bootstrapMemory);
    measureMainDetail('main.commands', function() { commands.install(); });
    measureMainDetail('main.logger-prune', function() { logger.prune(); });
    measureMainDetail('main.cleanup', cleanupMemory);

    const schedulerSetupStart = Game.cpu.getUsed();
    const lowCpu = Game.cpu.bucket < config.CPU_BUCKET_LOW;
    const criticalCpu = Game.cpu.bucket < config.CPU_BUCKET_CRITICAL;
    if (criticalCpu && Game.time % 25 === 0) {
      logger.warn('CPU_BUCKET_CRITICAL', 'CPU bucket critically low; nonessential work suppressed', { bucket: Game.cpu.bucket }, { force: true, persist: true, dedupeTicks: 0 });
    }

    const schedulerContext = {
      game: Game,
      tick: Game.time,
      bucket: Game.cpu.bucket,
      thresholds: {
        critical: config.CPU_BUCKET_CRITICAL,
        low: config.CPU_BUCKET_LOW,
        healthy: config.CPU_BUCKET_HEALTHY
      }
    };

    const roomStates = [];
    profiler.detailValue('main.scheduler-setup', Math.max(0, Game.cpu.getUsed() - schedulerSetupStart));
    const scheduledStart = Game.cpu.getUsed();

    processScheduler.run({
      id: 'rooms',
      priorityClass: processScheduler.PRIORITY.CRITICAL,
      minimumInterval: 0
    }, function() {
      profiler.section('rooms', function() {
        for (const name in Game.rooms) {
          const room = Game.rooms[name];
          if (room.controller && room.controller.my) roomStates.push(roomManager.run(room, lowCpu));
        }
      });
    }, schedulerContext);

    processScheduler.run({
      id: 'creeps',
      priorityClass: processScheduler.PRIORITY.CRITICAL,
      minimumInterval: 0
    }, function() {
      profiler.section('creeps', function() { creepManager.runAll(); });
    }, schedulerContext);

    // Observations happen AFTER creep handlers issued intents, never inside
    // room.heartbeat (which is captured BEFORE creep actions). Sample every
    // 25 ticks only; skip entirely under CPU/bucket headroom pressure.
    if (Game.time % 25 === 0) {
      try {
        measureMainDetail('main.consumer-supply-observer', function() {
          consumerSupplyObserver.flush(roomStates, logger, Game);
        });
      } catch (err) {
        // Optional diagnosis must not abort later scheduler work or gameplay.
        // Even an unhealthy logger must not turn observer failure into MAIN_FATAL.
        try {
          logger.warn('CONSUMER_SUPPLY_DIAG_ERROR', 'Optional supply observation failed', {
            phase: 'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION'
          }, { dedupeTicks: 100 });
        } catch (_) { /* fail closed: missing sample is UNKNOWN */ }
      }
    }

    processScheduler.run({
      id: 'world-intel',
      priorityClass: processScheduler.PRIORITY.STANDARD,
      minimumInterval: config.INTEL_INTERVAL,
      freshnessRequirement: config.INTEL_INTERVAL
    }, function() {
      profiler.section('world-intel', function() { worldIntel.observeVisibleRooms(); });
    }, schedulerContext);

    processScheduler.run({
      id: 'threat-model-shadow',
      priorityClass: processScheduler.PRIORITY.BACKGROUND,
      minimumInterval: 0
    }, function() {
      profiler.section('threat-model-shadow', function() {
        for (const state of roomStates) {
          state.threatModelShadow = threatModelShadow.evaluate(state, Game);
        }
      });
    }, schedulerContext);

    const plannerVNextRun = processScheduler.run({
      id: 'planner-vnext-shadow',
      priorityClass: processScheduler.PRIORITY.OVERFLOW,
      minimumInterval: Math.max(1, config.PLANNER_INTERVAL * 2),
      freshnessRequirement: Math.max(1, config.PLANNER_INTERVAL * 6)
    }, function() {
      return profiler.section('planner-vnext-shadow', function() {
        const byRoom = {};
        for (const state of roomStates) {
          byRoom[state.room.name] = plannerVNextShadow.evaluate(state, undefined, Game, {
            maxAnchors: plannerVNextShadow.DEFAULT_MAX_ANCHORS,
            pathSearchBudget: plannerVNextShadow.DEFAULT_PATH_SEARCH_BUDGET
          });
        }
        return byRoom;
      });
    }, schedulerContext);

    const currentPlannerPlans = plannerVNextRun.ran && plannerVNextRun.result
      ? plannerVNextRun.result
      : {};
    for (const state of roomStates) {
      state.plannerVNextShadow = currentPlannerPlans[state.room.name] ||
        plannerVNextShadow.snapshot(state.room.name, undefined, Game);
    }

    const p3Eligible = roomStates.some(state =>
      state.plannerVNextShadow &&
      state.plannerVNextShadow.authority === 'SHADOW' &&
      state.plannerVNextShadow.status === 'READY' &&
      Number.isFinite(state.plannerVNextShadow.planTick) &&
      state.plannerVNextShadow.planTick < Game.time
    );

    let defenseMinCutRun = { ran: false, result: null };
    if (p3Eligible) {
      defenseMinCutRun = processScheduler.run({
        id: 'defense-mincut-shadow',
        priorityClass: processScheduler.PRIORITY.OVERFLOW,
        minimumInterval: Math.max(1, config.PLANNER_INTERVAL * 10),
        freshnessRequirement: Math.max(1, config.PLANNER_INTERVAL * 30)
      }, function() {
        return profiler.section('defense-mincut-shadow', function() {
          const byRoom = {};
          for (const state of roomStates) {
            const p2 = state.plannerVNextShadow;
            if (!p2 || p2.authority !== 'SHADOW' || p2.status !== 'READY') continue;
            byRoom[state.room.name] = defenseMinCutShadow.evaluate(state, p2, undefined, Game, {
              margin: defenseMinCutShadow.DEFAULT_MARGIN,
              maxGridTiles: defenseMinCutShadow.DEFAULT_MAX_GRID_TILES,
              maxAugmentations: defenseMinCutShadow.DEFAULT_MAX_AUGMENTATIONS
            });
          }
          return byRoom;
        });
      }, schedulerContext);
    }

    const currentDefensePlans = defenseMinCutRun.ran && defenseMinCutRun.result
      ? defenseMinCutRun.result
      : {};
    for (const state of roomStates) {
      state.defenseMinCutShadow = currentDefensePlans[state.room.name] ||
        defenseMinCutShadow.snapshot(state.room.name, undefined, Game);
    }

    let remoteRoiRun = { ran: false, result: null };
    const i2CanRun = !plannerVNextRun.ran && !defenseMinCutRun.ran;
    if (i2CanRun) {
      remoteRoiRun = processScheduler.run({
        id: 'remote-roi-shadow',
        priorityClass: processScheduler.PRIORITY.OVERFLOW,
        minimumInterval: Math.max(1, config.PLANNER_INTERVAL * 5),
        freshnessRequirement: Math.max(1, config.PLANNER_INTERVAL * 20)
      }, function() {
        return profiler.section('remote-roi-shadow', function() {
          const byRoom = {};
          for (const state of roomStates) {
            byRoom[state.room.name] = remoteRoiShadow.evaluate(state, undefined, Game);
          }
          return byRoom;
        });
      }, schedulerContext);
    }

    const currentRemoteRoi = remoteRoiRun.ran && remoteRoiRun.result
      ? remoteRoiRun.result
      : {};
    for (const state of roomStates) {
      state.remoteRoiShadow = currentRemoteRoi[state.room.name] ||
        remoteRoiShadow.snapshot(state.room.name, undefined, Game);
    }

    processScheduler.run({
      id: 'stats',
      priorityClass: processScheduler.PRIORITY.STANDARD,
      minimumInterval: 0
    }, function() {
      profiler.section('stats', function() { stats.collect(roomStates); });
    }, schedulerContext);

    processScheduler.run({
      id: 'visuals',
      priorityClass: processScheduler.PRIORITY.BACKGROUND,
      minimumInterval: 0
    }, function() {
      profiler.section('visuals', function() { roomStates.forEach(visuals.draw); });
    }, schedulerContext);

    const scheduledTotal = Math.max(0, Game.cpu.getUsed() - scheduledStart);
    const sectionTotal = currentSectionTotal(['rooms', 'creeps', 'world-intel', 'threat-model-shadow', 'planner-vnext-shadow', 'defense-mincut-shadow', 'remote-roi-shadow', 'stats', 'visuals']);
    profiler.detailValue('main.scheduler-overhead', Math.max(0, scheduledTotal - sectionTotal));

    profiler.finishTick(tickStart);

    const tickCpu = Game.cpu.getUsed() - tickStart;
    if (Game.time % config.STATUS_SNAPSHOT_INTERVAL === 0) statusSnapshot(roomStates, tickCpu);

    if (Game.time % config.LOG_HEARTBEAT_INTERVAL === 0) {
      const profile = profiler.currentHistorySample();
      logger.info('BOT_HEARTBEAT', 'Bot tick completed', {
        cpu: Math.round(tickCpu * 1000) / 1000,
        bucket: Game.cpu.bucket,
        rooms: roomStates.length,
        creeps: Object.keys(Game.creeps).length,
        profile: profile ? {
          sections: profile.sections,
          details: profile.details,
          attributed: profile.attributed,
          unattributed: profile.unattributed
        } : null
      }, { force: true, journal: true, dedupeTicks: 0 });
    }
  } catch (err) {
    logger.error('MAIN_FATAL', 'Unhandled exception escaped main loop', err, { cpu: Game.cpu.getUsed(), bucket: Game.cpu.bucket });
  }
};
