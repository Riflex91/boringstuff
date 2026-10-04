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
    economy: state.economyMetrics,
    economyModel: state.economyModel,
    health: state.health,
    efficiency: state.efficiency,
    colonyState: state.colonyState || null
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

function run(room, lowCpu) {
  const state = stateBuilder.get(room);
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
  state.colonyState = colonyState.build(state, {
    tick: Game.time,
    bucket: Game.cpu.bucket
  });

  towerManager.run(state);
  maybeSafeMode(state);
  maybeWarnUpgraderStall(state);
  spawnManager.spawnOne(state);

  if (!lowCpu && Game.time % config.PLANNER_INTERVAL === 0) planner.plan(state);

  if (Game.time % config.LOG_HEARTBEAT_INTERVAL === 0) {
    logger.info('ROOM_HEARTBEAT', 'Room operational snapshot', status(state), { force: true, persist: false, dedupeTicks: 0 });
  }
  return state;
}

module.exports = { run };
