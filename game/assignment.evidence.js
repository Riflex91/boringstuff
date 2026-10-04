'use strict';

const assignmentShadow = require('assignment.shadow');

const SCHEMA_VERSION = 1;
const WINDOW_TICKS = 100;
const TERMINAL = { SATISFIED: true, EXPIRED: true, CANCELLED: true };

function round(value, digits) {
  const scale = Math.pow(10, digits === undefined ? 3 : digits);
  return Math.round((Number(value) || 0) * scale) / scale;
}

function tick(game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  return game && Number.isFinite(game.time) ? game.time : 0;
}

function newWindow(startTick) {
  return {
    startTick,
    ticks: 0,
    requestsOpened: 0,
    requestsClosed: 0,
    requestLatencyTotal: 0,
    maxRequestLatency: 0,
    activeRequestTicks: 0,
    blockedRequestTicks: 0,
    blockedReasons: {},
    assignmentCount: 0,
    switchCount: 0,
    deferredTicks: 0,
    unfilledRequestTicks: 0,
    unfilledNeedTicks: 0,
    candidateExecutorTicks: 0,
    assignedExecutorTicks: 0,
    idleCompatibleExecutorTicks: 0,
    controllerProgress: 0,
    constructionProgress: 0
  };
}

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, rooms: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.assignmentEvidence || memoryRoot.bot.assignmentEvidence.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.assignmentEvidence = { schemaVersion: SCHEMA_VERSION, rooms: {} };
  }
  if (!memoryRoot.bot.assignmentEvidence.rooms) memoryRoot.bot.assignmentEvidence.rooms = {};
  return memoryRoot.bot.assignmentEvidence;
}

function ensureRoom(roomName, memoryRoot, now) {
  const root = ensure(memoryRoot);
  if (!root.rooms[roomName]) {
    root.rooms[roomName] = {
      window: newWindow(now),
      lastWindow: null,
      seenEpisodes: {},
      seenTerminals: {},
      lastController: null,
      lastSites: {}
    };
  }
  const room = root.rooms[roomName];
  if (!room.window) room.window = newWindow(now);
  if (!room.seenEpisodes) room.seenEpisodes = {};
  if (!room.seenTerminals) room.seenTerminals = {};
  if (!room.lastSites) room.lastSites = {};
  return room;
}

function episodeKey(request) {
  return String(request.id || request.dedupeKey || 'request') + '@' + String(request.createdTick);
}

function terminalKey(request) {
  return episodeKey(request) + '@' + String(request.status) + '@' + String(request.updatedTick);
}

function observeRequestLifecycle(roomState, requests, now) {
  const window = roomState.window;
  for (const request of requests || []) {
    const eKey = episodeKey(request);
    if (!roomState.seenEpisodes[eKey]) {
      roomState.seenEpisodes[eKey] = now;
      if (Number.isFinite(request.createdTick) && request.createdTick === now) window.requestsOpened += 1;
    }

    if (TERMINAL[request.status]) {
      const tKey = terminalKey(request);
      if (!roomState.seenTerminals[tKey]) {
        roomState.seenTerminals[tKey] = now;
        if (Number.isFinite(request.updatedTick) && request.updatedTick === now) {
          window.requestsClosed += 1;
          const latency = Number.isFinite(request.createdTick) ? Math.max(0, request.updatedTick - request.createdTick) : 0;
          window.requestLatencyTotal += latency;
          window.maxRequestLatency = Math.max(window.maxRequestLatency, latency);
        }
      }
      continue;
    }

    window.activeRequestTicks += 1;
    if (request.status === 'BLOCKED') {
      window.blockedRequestTicks += 1;
      const reason = request.blocked && request.blocked.reason ? String(request.blocked.reason) : 'UNKNOWN';
      window.blockedReasons[reason] = (window.blockedReasons[reason] || 0) + 1;
    }
  }
}

function compatibleExecutors(requests, creeps) {
  const active = (requests || []).filter(assignmentShadow._test.requestAssignable);
  const result = {};
  for (const creep of creeps || []) {
    if (!creep || creep.spawning || !(creep.id || creep.name)) continue;
    for (const request of active) {
      if (assignmentShadow._test.capabilityFor(creep, request) > 0) {
        result[creep.id || creep.name] = true;
        break;
      }
    }
  }
  return result;
}

function observeAssignment(roomState, state) {
  const window = roomState.window;
  const plan = state.assignmentShadow || { assignments: [], unfilled: [], summary: null };
  const summary = plan.summary || {};
  if (summary.deferred) {
    window.deferredTicks += 1;
    return;
  }

  const assignments = plan.assignments || [];
  const unfilled = plan.unfilled || [];
  window.assignmentCount += assignments.length;
  window.switchCount += Math.max(0, Number(summary.switchCount) || 0);
  window.assignedExecutorTicks += assignments.length;
  window.unfilledRequestTicks += unfilled.length;
  window.unfilledNeedTicks += unfilled.reduce((sum, item) => sum + Math.max(0, Number(item.remaining) || 0), 0);

  if (!unfilled.length) return;
  const unfilledIds = {};
  for (const item of unfilled) unfilledIds[item.requestId] = true;
  const requests = (state.requestShadow && state.requestShadow.requests || []).filter(request => unfilledIds[request.id]);
  const candidates = compatibleExecutors(requests, state.creeps || []);
  const assigned = {};
  for (const item of assignments) assigned[item.executorId] = true;
  const ids = Object.keys(candidates);
  window.candidateExecutorTicks += ids.length;
  for (const id of ids) {
    if (!assigned[id]) window.idleCompatibleExecutorTicks += 1;
  }
}

function observeUsefulWork(roomState, state) {
  const window = roomState.window;
  const controller = state.room && state.room.controller;
  if (controller && controller.my) {
    const current = { level: Number(controller.level) || 0, progress: Number.isFinite(controller.progress) ? controller.progress : null };
    const previous = roomState.lastController;
    if (previous && previous.level === current.level && previous.progress !== null && current.progress !== null && current.progress > previous.progress) {
      window.controllerProgress += current.progress - previous.progress;
    }
    roomState.lastController = current;
  } else {
    roomState.lastController = null;
  }

  const currentSites = {};
  for (const site of state.sites || []) {
    const current = {
      progress: Number(site.progress) || 0,
      total: Number(site.progressTotal) || 0,
      x: site.pos && site.pos.x,
      y: site.pos && site.pos.y,
      type: site.structureType
    };
    currentSites[site.id] = current;
    const previous = roomState.lastSites[site.id];
    if (previous && current.progress > previous.progress) window.constructionProgress += current.progress - previous.progress;
  }

  if (state.room && typeof state.room.lookForAt === 'function' && typeof LOOK_STRUCTURES !== 'undefined') {
    for (const id in roomState.lastSites) {
      if (currentSites[id]) continue;
      const previous = roomState.lastSites[id];
      if (!Number.isFinite(previous.x) || !Number.isFinite(previous.y)) continue;
      let built = false;
      try {
        built = (state.room.lookForAt(LOOK_STRUCTURES, previous.x, previous.y) || []).some(s => s.structureType === previous.type);
      } catch (err) {}
      if (built) window.constructionProgress += Math.max(0, previous.total - previous.progress);
    }
  }
  roomState.lastSites = currentSites;
}

function summarize(window, endTick) {
  const ticks = Math.max(1, window.ticks || 0);
  const closed = Math.max(0, window.requestsClosed || 0);
  const useful = Math.max(0, window.controllerProgress || 0) + Math.max(0, window.constructionProgress || 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW_EVIDENCE',
    startTick: window.startTick,
    endTick,
    ticks: window.ticks,
    requestsOpened: window.requestsOpened,
    requestsClosed: closed,
    averageRequestLatency: round(window.requestLatencyTotal / Math.max(1, closed), 2),
    maxRequestLatency: window.maxRequestLatency,
    averageActiveRequests: round(window.activeRequestTicks / ticks, 2),
    averageBlockedRequests: round(window.blockedRequestTicks / ticks, 2),
    blockedReasons: window.blockedReasons,
    assignmentsPerTick: round(window.assignmentCount / ticks, 3),
    switchesPerTick: round(window.switchCount / ticks, 3),
    deferredRatio: round(window.deferredTicks / ticks),
    averageUnfilledRequests: round(window.unfilledRequestTicks / ticks, 2),
    averageUnfilledNeed: round(window.unfilledNeedTicks / ticks, 2),
    averageCandidateExecutorsWhenUnfilled: round(window.candidateExecutorTicks / ticks, 2),
    idleCompatibleExecutorRatio: round(window.idleCompatibleExecutorTicks / Math.max(1, window.candidateExecutorTicks)),
    controllerProgress: window.controllerProgress,
    constructionProgress: window.constructionProgress,
    usefulWorkPerTick: round(useful / ticks, 3)
  };
}

function pruneSeen(roomState, now) {
  const cutoff = now - 5000;
  for (const key in roomState.seenEpisodes) if (roomState.seenEpisodes[key] < cutoff) delete roomState.seenEpisodes[key];
  for (const key in roomState.seenTerminals) if (roomState.seenTerminals[key] < cutoff) delete roomState.seenTerminals[key];
}

function observe(state, memoryRoot, game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const now = tick(game);
  const roomName = state && state.room && state.room.name;
  if (!roomName) return { current: null, completed: null };
  const roomState = ensureRoom(roomName, memoryRoot, now);

  observeRequestLifecycle(roomState, state.requestShadow && state.requestShadow.requests || [], now);
  observeAssignment(roomState, state);
  observeUsefulWork(roomState, state);
  roomState.window.ticks += 1;

  let completed = null;
  if (roomState.window.ticks >= WINDOW_TICKS) {
    completed = summarize(roomState.window, now);
    roomState.lastWindow = completed;
    roomState.window = newWindow(now + 1);
    pruneSeen(roomState, now);
  }

  return {
    current: summarize(roomState.window, now),
    completed,
    lastWindow: roomState.lastWindow
  };
}

function snapshot(roomName, memoryRoot) {
  const root = ensure(memoryRoot);
  const room = root.rooms[roomName];
  if (!room) return { current: null, lastWindow: null };
  const now = typeof Game !== 'undefined' && Number.isFinite(Game.time) ? Game.time : (room.window.startTick || 0) + (room.window.ticks || 0) - 1;
  return {
    current: summarize(room.window, now),
    lastWindow: room.lastWindow || null
  };
}

module.exports = {
  SCHEMA_VERSION,
  WINDOW_TICKS,
  ensure,
  observe,
  snapshot,
  summarize,
  _test: {
    newWindow,
    ensureRoom,
    episodeKey,
    terminalKey,
    observeRequestLifecycle,
    compatibleExecutors,
    observeAssignment,
    observeUsefulWork,
    pruneSeen
  }
};