'use strict';

const productiveFlow = require('productive.flow');

// Bounded room-economy telemetry. It records what the colony actually does so
// control decisions can be compared against real throughput instead of fixed
// role ratios.

function ensure(roomName) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};
  if (!Memory.rooms[roomName].economyMetrics) {
    Memory.rooms[roomName].economyMetrics = {
      rcl: null,
      rclStarted: Game.time,
      lastProgress: null,
      lastProgressTick: Game.time,
      energyCappedStreak: 0,
      spawnIdleStreak: 0,
      upgraderPresentStreak: 0,
      windowStart: Game.time,
      windowTicks: 0,
      windowSpawnBusyTicks: 0,
      windowEnergyCappedTicks: 0,
      windowControllerProgress: 0,
      windowConstructionProgress: 0,
      windowSitesCompleted: 0,
      windowProductiveFlow: productiveFlow.newWindow(),
      lastWindow: null,
      lastSites: {}
    };
  }
  const m = Memory.rooms[roomName].economyMetrics;
  if (!m.lastSites) m.lastSites = {};
  if (m.windowConstructionProgress === undefined) m.windowConstructionProgress = 0;
  if (m.windowSitesCompleted === undefined) m.windowSitesCompleted = 0;
  if (m.upgraderPresentStreak === undefined) m.upgraderPresentStreak = 0;
  if (!m.windowProductiveFlow) m.windowProductiveFlow = productiveFlow.newWindow();
  return m;
}

function observeConstruction(state, m) {
  const current = {};
  for (const site of state.sites) {
    current[site.id] = {
      progress: site.progress || 0,
      total: site.progressTotal || 0,
      x: site.pos.x,
      y: site.pos.y,
      type: site.structureType
    };
    const previous = m.lastSites[site.id];
    if (previous && site.progress > previous.progress) {
      m.windowConstructionProgress += site.progress - previous.progress;
    }
  }

  // If a tracked site vanished and the matching structure now exists on that
  // tile, count the remaining progress as completed rather than losing the
  // final build tick from the window.
  for (const id in m.lastSites) {
    if (current[id]) continue;
    const previous = m.lastSites[id];
    const built = state.room.lookForAt(LOOK_STRUCTURES, previous.x, previous.y)
      .some(s => s.structureType === previous.type);
    if (built) {
      m.windowConstructionProgress += Math.max(0, previous.total - previous.progress);
      m.windowSitesCompleted += 1;
    }
  }
  m.lastSites = current;
}

function finishWindow(m, flow) {
  if (m.windowTicks < 100) return;
  m.lastWindow = {
    startTick: m.windowStart,
    endTick: Game.time,
    ticks: m.windowTicks,
    spawnUtilization: Math.round((m.windowSpawnBusyTicks / Math.max(1, m.windowTicks)) * 1000) / 1000,
    energyCappedRatio: Math.round((m.windowEnergyCappedTicks / Math.max(1, m.windowTicks)) * 1000) / 1000,
    controllerProgress: m.windowControllerProgress,
    constructionProgress: m.windowConstructionProgress,
    sitesCompleted: m.windowSitesCompleted,
    productiveFlow: productiveFlow.summarize(m.windowProductiveFlow, m.windowTicks, flow, {
      controllerProgress: m.windowControllerProgress,
      constructionProgress: m.windowConstructionProgress
    })
  };
  m.windowStart = Game.time + 1;
  m.windowTicks = 0;
  m.windowSpawnBusyTicks = 0;
  m.windowEnergyCappedTicks = 0;
  m.windowControllerProgress = 0;
  m.windowConstructionProgress = 0;
  m.windowSitesCompleted = 0;
  m.windowProductiveFlow = productiveFlow.newWindow();
}

function observe(state) {
  const room = state.room;
  const controller = room.controller;
  const m = ensure(room.name);
  const rcl = controller ? controller.level : 0;
  const progress = controller && typeof controller.progress === 'number' ? controller.progress : 0;

  if (m.rcl !== rcl) {
    m.rcl = rcl;
    m.rclStarted = Game.time;
    m.lastProgress = progress;
    m.lastProgressTick = Game.time;
    m.windowControllerProgress = 0;
  } else {
    if (m.lastProgress !== null && progress > m.lastProgress) {
      const delta = progress - m.lastProgress;
      m.windowControllerProgress += delta;
      m.lastProgressTick = Game.time;
    }
    m.lastProgress = progress;
  }

  observeConstruction(state, m);
  const flow = productiveFlow.observe(state);
  productiveFlow.accumulate(m.windowProductiveFlow, flow);

  const capped = state.energyCapacityAvailable > 0 && state.energyAvailable >= state.energyCapacityAvailable;
  m.energyCappedStreak = capped ? (m.energyCappedStreak || 0) + 1 : 0;

  const spawnBusy = !!(state.spawn && state.spawn.spawning);
  m.spawnIdleStreak = state.spawn && !spawnBusy ? (m.spawnIdleStreak || 0) + 1 : 0;
  m.upgraderPresentStreak = (state.byRole.upgrader || 0) > 0
    ? (m.upgraderPresentStreak || 0) + 1
    : 0;

  m.windowTicks += 1;
  if (spawnBusy) m.windowSpawnBusyTicks += 1;
  if (capped) m.windowEnergyCappedTicks += 1;
  finishWindow(m, flow);

  return snapshot(state, m, flow);
}

function snapshot(state, existing, currentFlow) {
  const m = existing || ensure(state.room.name);
  const flow = currentFlow || productiveFlow.observe(state);
  return {
    energyCappedStreak: m.energyCappedStreak || 0,
    spawnIdleStreak: m.spawnIdleStreak || 0,
    upgraderPresentStreak: m.upgraderPresentStreak || 0,
    controllerIdleTicks: Math.max(0, Game.time - (m.lastProgressTick || Game.time)),
    rclAge: Math.max(0, Game.time - (m.rclStarted || Game.time)),
    productiveFlow: flow,
    last100: m.lastWindow || null
  };
}

module.exports = { observe, snapshot };
