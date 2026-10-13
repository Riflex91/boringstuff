'use strict';

const config = require('config');
const logger = require('logger');
const profiler = require('profiler');
const roomManager = require('room.manager');
const creepManager = require('creep.manager');
const consumerSupplyObserver = require('consumer.supply.observer');
const logisticsHaulerCpuEvidence = require('logistics.hauler.cpu.evidence');
const settledDeliveryEvidence = require('logistics.settled.delivery.evidence');
const pairedLogisticsEvidence = require('logistics.evidence.pair.shadow');
const stats = require('stats');
const visuals = require('visuals');
const commands = require('commands');
const runtimeCapabilities = require('runtime.capabilities');
const expansionReadinessShadow = require('expansion.readiness.shadow');
const expansionCandidatesShadow = require('expansion.candidates.shadow');
const expansionOperationShadow = require('expansion.operation.shadow');
const expansionBootstrapBudgetShadow = require('expansion.bootstrap.budget.shadow');
const expansionParentStabilityShadow = require('expansion.parent.stability.shadow');
const serverProfile = require('server.profile');
const processScheduler = require('process.scheduler');
const worldIntel = require('world.intel');
const colonyState = require('colony.state');
const plannerVNextShadow = require('planner.vnext.shadow');
const defenseMinCutShadow = require('defense.mincut.shadow');
const remoteRoiShadow = require('remote.roi.shadow');
const threatModelShadow = require('threat.model.shadow');
const defenseRequestsShadow = require('defense.requests.shadow');
const defenseRegistryPreview = require('defense.registry.preview');
const regionalDefenseShadow = require('defense.reinforcement.shadow');
const defenseTransitEvidence = require('defense.transit.evidence');

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
  const expansionReadiness = expansionReadinessShadow.evaluate(capabilities,roomStates,tickCpu);
  const expansionCandidates = expansionCandidatesShadow.evaluate(
    expansionReadiness,roomStates,Game,Memory);
  // The I4 site advisory must never progress on an isolated healthy
  // snapshot. Validate a fresh 100-consecutive-tick parent support witness
  // before accepting geometry or retaining a previously verified site.
  const expansionParentStability = expansionParentStabilityShadow.snapshot(
    Memory, Game.time);
  const expansionOperation = expansionOperationShadow.evaluate(
    expansionReadiness,expansionCandidates,roomStates,Game,Memory,
    expansionParentStability);
  const expansionParent = roomStates.find(state => state?.room?.name ===
    expansionOperation.parentRoom) || null;
  const expansionBootstrapBudget = expansionBootstrapBudgetShadow.assess(
    expansionReadiness,expansionOperation,expansionParent);
  const schedulerState = processScheduler.snapshot();
  const worldIntelState = worldIntel.snapshot();
  const transitEvidence = defenseTransitEvidence.snapshot(Game, Memory);
  // D2 is computed only for bounded snapshot evidence, never used by
  // legacy defense or spawn executors. No observed inter-room transit
  // evidence is available by default. Only consecutive observed travel from
  // a preexisting mission may populate the D2 route evidence map.
  let regionalDefense;
  try {
    regionalDefense = regionalDefenseShadow.evaluate(roomStates, transitEvidence.routes, Game);
  } catch (_) {
    regionalDefense = { summary: {
      schemaVersion: regionalDefenseShadow.SCHEMA_VERSION,
      authority: 'SHADOW', actionAuthority: 'NONE', tick: Game.time,
      targetCount: 0, selectedCount: 0, blockedCount: 0,
      byTarget: {}, executable: false, writesToGameMemory: false,
      status: 'UNVERIFIED', reason: 'D2_DIAGNOSTIC_ERROR'
    } };
  }
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
      threatModel: threatModelShadow.telemetrySummary(state.threatModelShadow),
      defenseRequests: defenseRequestsShadow.telemetrySummary(state.defenseRequestsShadow),
       defenseRegistryPreview: defenseRegistryPreview.telemetrySummary(state.defenseRegistryPreview)
    };
  }
  logger.info('STATUS_SNAPSHOT', 'Structured bot status snapshot', {
    cpu: Math.round(tickCpu * 1000) / 1000,
    bucket: Game.cpu.bucket,
    gcl: Game.gcl ? { level: Game.gcl.level, progress: Game.gcl.progress, progressTotal: Game.gcl.progressTotal } : null,
    totalCreeps: Object.keys(Game.creeps).length,
    capabilities,
    expansionReadiness,
    expansionCandidates,
    expansionOperation,
    expansionBootstrapBudget,
    expansionParentStability,
    serverProfile: profile,
    scheduler: schedulerState,
    worldIntel: worldIntelState,
    regionalDefense: regionalDefenseShadow.telemetrySummary(regionalDefense),
    regionalTransit: transitEvidence.summary,
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
    let waitingBeforeIntents = null;
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

    // Low-cost, optional I4 parent continuity witness. Each healthy tick is
    // individually observed; a skipped/low-CPU tick breaks the next streak.
    // Never let expansion diagnostics delay or interrupt authoritative creeps.
    if (!lowCpu && roomStates.length > 0 &&
        roomStates.length <= expansionParentStabilityShadow.MAX_OBSERVED_ROOMS &&
        Game.cpu.limit - Game.cpu.getUsed() >
          config.SHADOW_CPU_RESERVE + 2) {
      try {
        expansionParentStabilityShadow.observe(roomStates, Game, Memory);
      } catch (_) { /* advisory only: absence means UNKNOWN, not stable */ }
    }

    processScheduler.run({
      id: 'creeps',
      priorityClass: processScheduler.PRIORITY.CRITICAL,
      minimumInterval: 0
    }, function() {
      profiler.section('creeps', function() {
         // E5 measures original per-creep CPU deltas; no new CPU probes
         // inside role execution. Missing/low-bucket samples break evidence.
         const samples = Object.create(null);
         // Keep a copy of waiting identities BEFORE a hauler's accepted
         // transfer intent clears waitingEnergyTicks in legacy creep Memory.
         try {
           waitingBeforeIntents = !lowCpu ?
             settledDeliveryEvidence.capturePreIntentWaiting(roomStates, Game)
             : null;
         } catch (_) { waitingBeforeIntents = null; }
         const onHaulerRoleCpu = !lowCpu ? function(roomName, used) {
           const s = samples[roomName] ||
             (samples[roomName] = {haulers:0,roleCpu:0});
           s.haulers++;
           s.roleCpu += used;
         } : null;
         creepManager.runAll(onHaulerRoleCpu);
         if (!lowCpu) {
           try {
             const completed = logisticsHaulerCpuEvidence.observe(
               roomStates, samples, Game, Memory);
             for (const evidence of completed) {
               logger.info('E5_HAULER_ROLE_CPU_WINDOW',
                 'Measured hauler role CPU, not route CPU or settled delivery', {
                   room:evidence.room,evidence
                 }, {force:true,persist:true,dedupeTicks:0});
             }
           } catch (_) { /* optional observer must not block core gameplay */ }
         }
       });
    }, schedulerContext);

    // D2 observer is passive, bucket-gated and allowed to miss a tick.
    // Missing ticks invalidate a route witness rather than lowering ETA.
    processScheduler.run({
      id: 'defense-transit-shadow',
      priorityClass: processScheduler.PRIORITY.BACKGROUND,
      minimumInterval: 0
    }, function() {
      try {
        profiler.section('defense-transit-shadow', function() {
          defenseTransitEvidence.observe(Game, Memory);
        });
      } catch (_) {
        // An optional ETA observer must never block core gameplay.
      }
    }, schedulerContext);

    // E5 settlement witness reads last tick's actual Room.getEventLog()
    // after the active hauler handlers. Skip under CPU/bucket pressure; a
    // missed tick breaks the 100-real-tick evidence window. This is purely
    // lower-bound consumer delivery observation, NOT route/mode authority.
    if (!lowCpu && Game.time >= 1 &&
        Game.cpu.limit - Game.cpu.getUsed() >
          config.SHADOW_CPU_RESERVE + 3 && roomStates.length <= 3) {
      try {
        const completed = settledDeliveryEvidence.observe(
          roomStates, Game, Memory, waitingBeforeIntents);
        for (const result of completed) {
          logger.info('E5_SETTLED_CONSUMER_DELIVERY_WINDOW',
            'Previous-tick actual consumer energy transfers (lower bound only)', {
              room:result.room, evidence:result
            }, {force:true,persist:true,dedupeTicks:0});
          // Combine ONLY strictly matching completed CPU/settlement intervals.
          // No mode economics are inferred from generic role CPU divided by
          // a restricted subset of consumer-only confirmed energy events.
          const paired = pairedLogisticsEvidence.assess(
            result.room, Game.time,
            logisticsHaulerCpuEvidence.snapshot(result.room, Memory), result);
          logger.info('E5_PAIRED_EVIDENCE_STATUS',
            'Aligned E5 hauler CPU and settled consumer receipts, or explicit gap', {
              room:result.room, evidence:paired
            }, {force:true,persist:true,dedupeTicks:0});
        }
      } catch (_) { /* optional event observation must never block gameplay */ }
    }

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
          // D1 is an advisory derivative of D0, never an executor or a
          // request-registry mutation. A D1 diagnostic exception must not
          // interrupt survival, creep intents or the rest of the scheduler.
          try {
            state.defenseRequestsShadow = defenseRequestsShadow.evaluate(
              state, state.threatModelShadow, Game);
          } catch (_) {
            state.defenseRequestsShadow = {
              summary: {
                schemaVersion: defenseRequestsShadow.SCHEMA_VERSION,
                authority: 'SHADOW', actionAuthority: 'NONE',
                status: 'UNVERIFIED', reason: 'D1_DIAGNOSTIC_ERROR',
                roomName: state.room.name, tick: Game.time,
                requestCount: 0
              }
            };
          }
          // E0 is evaluated only inside a disposable shadow registry.
          // D1 remains an advisory producer and never writes Memory or
          // exposes executable defense requests to the real E0 queue.
          try {
            state.defenseRegistryPreview = defenseRegistryPreview.evaluate(
              state.defenseRequestsShadow, Game);
          } catch (_) {
            state.defenseRegistryPreview = {
              summary: {
                schemaVersion: defenseRegistryPreview.SCHEMA_VERSION,
                authority: 'SHADOW', actionAuthority: 'NONE',
                status: 'UNVERIFIED', reason: 'E0_PREVIEW_DIAGNOSTIC_ERROR',
                roomName: state.room.name, tick: Game.time,
                requestCount: 0, reservationCount: 0,
                executable: false, writesToGameMemory: false
              }
            };
          }
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
