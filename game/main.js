'use strict';

const config = require('config');
const logger = require('logger');
const profiler = require('profiler');
const roomManager = require('room.manager');
const creepManager = require('creep.manager');
const stats = require('stats');
const visuals = require('visuals');
const commands = require('commands');
const runtimeCapabilities = require('runtime.capabilities');
const serverProfile = require('server.profile');
const processScheduler = require('process.scheduler');
const worldIntel = require('world.intel');

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
      health: state.health || null,
      efficiency: state.efficiency || null,
      colonyState: state.colonyState || null
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

    processScheduler.run({
      id: 'world-intel',
      priorityClass: processScheduler.PRIORITY.STANDARD,
      minimumInterval: config.INTEL_INTERVAL,
      freshnessRequirement: config.INTEL_INTERVAL
    }, function() {
      profiler.section('world-intel', function() { worldIntel.observeVisibleRooms(); });
    }, schedulerContext);

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
    const sectionTotal = currentSectionTotal(['rooms', 'creeps', 'world-intel', 'stats', 'visuals']);
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
