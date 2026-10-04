'use strict';

const config = require('config');
const logger = require('logger');
const profiler = require('profiler');
const roomManager = require('room.manager');
const creepManager = require('creep.manager');
const stats = require('stats');
const visuals = require('visuals');
const commands = require('commands');

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
      efficiency: state.efficiency || null
    };
  }
  logger.info('STATUS_SNAPSHOT', 'Structured bot status snapshot', {
    cpu: Math.round(tickCpu * 1000) / 1000,
    bucket: Game.cpu.bucket,
    gcl: Game.gcl ? { level: Game.gcl.level, progress: Game.gcl.progress, progressTotal: Game.gcl.progressTotal } : null,
    totalCreeps: Object.keys(Game.creeps).length,
    rooms
  }, { force: true, persist: false, dedupeTicks: 0 });
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
    bootstrapMemory();
    commands.install();
    logger.prune();
    cleanupMemory();

    const lowCpu = Game.cpu.bucket < config.CPU_BUCKET_LOW;
    const criticalCpu = Game.cpu.bucket < config.CPU_BUCKET_CRITICAL;
    if (criticalCpu && Game.time % 25 === 0) {
      logger.warn('CPU_BUCKET_CRITICAL', 'CPU bucket critically low; nonessential work suppressed', { bucket: Game.cpu.bucket }, { force: true, persist: true, dedupeTicks: 0 });
    }

    const roomStates = [];
    profiler.section('rooms', function() {
      for (const name in Game.rooms) {
        const room = Game.rooms[name];
        if (room.controller && room.controller.my) roomStates.push(roomManager.run(room, lowCpu));
      }
    });

    profiler.section('creeps', function() { creepManager.runAll(); });

    if (!criticalCpu) profiler.section('stats', function() { stats.collect(roomStates); });
    if (!lowCpu) profiler.section('visuals', function() { roomStates.forEach(visuals.draw); });

    profiler.finishTick();

    const tickCpu = Game.cpu.getUsed() - tickStart;
    if (Game.time % config.STATUS_SNAPSHOT_INTERVAL === 0) statusSnapshot(roomStates, tickCpu);

    if (Game.time % config.LOG_HEARTBEAT_INTERVAL === 0) {
      logger.info('BOT_HEARTBEAT', 'Bot tick completed', {
        cpu: Math.round(tickCpu * 1000) / 1000,
        bucket: Game.cpu.bucket,
        rooms: roomStates.length,
        creeps: Object.keys(Game.creeps).length
      }, { force: true, dedupeTicks: 0 });
    }
  } catch (err) {
    logger.error('MAIN_FATAL', 'Unhandled exception escaped main loop', err, { cpu: Game.cpu.getUsed(), bucket: Game.cpu.bucket });
  }
};
