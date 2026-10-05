import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.WORK = 'work';
global.CARRY = 'carry';
global.MOVE = 'move';
global.RESOURCE_ENERGY = 'energy';
global.CARRY_CAPACITY = 50;
global.LOOK_STRUCTURES = 'structure';

const evidence = require('../game/assignment.evidence.js');

function creep(id, role, parts, energy = 0) {
  return {
    id, name: id, spawning: false,
    memory: { role },
    room: { name: 'E1N1' },
    pos: { x: 10, y: 10, roomName: 'E1N1', getRangeTo() { return 1; } },
    store: { energy },
    getActiveBodyparts(type) { return parts[type] || 0; }
  };
}

function request(overrides = {}) {
  return Object.assign({
    id: 'req|E1N1|work:build:x',
    dedupeKey: 'work:build:x',
    domain: 'work',
    kind: 'BUILD',
    createdTick: 1,
    updatedTick: 1,
    status: 'OPEN',
    target: { roomName: 'E1N1', pos: { x: 11, y: 10, roomName: 'E1N1' } },
    demand: { capability: 'workBuild', amount: 2 },
    priority: { base: 50, urgency: 0, strategicClass: 'PRODUCTIVE_WORK' },
    utility: { current: 2, marginalModel: 'LINEAR' },
    progress: { amount: 0, lastProgressTick: null },
    reservations: [],
    blocked: { untilTick: null, reason: null, failureCount: 0 }
  }, overrides);
}

function stateAt(tick, options = {}) {
  const controllerProgress = options.controllerProgress ?? 10;
  const siteProgress = options.siteProgress ?? 0;
  const site = {
    id: 'site1', structureType: 'extension', progress: siteProgress, progressTotal: 100,
    pos: { x: 20, y: 20, roomName: 'E1N1' }
  };
  const room = {
    name: 'E1N1',
    controller: { my: true, level: 3, progress: controllerProgress },
    lookForAt(type, x, y) {
      if (options.completedSite && type === LOOK_STRUCTURES && x === 20 && y === 20) {
        return [{ structureType: 'extension' }];
      }
      return [];
    }
  };
  return {
    room,
    sites: options.sites === false ? [] : [site],
    creeps: options.creeps || [],
    requestShadow: { requests: options.requests || [] },
    assignmentShadow: options.assignmentShadow || {
      assignments: [],
      unfilled: [],
      summary: { deferred: false, switchCount: 0 }
    }
  };
}

{
  const memory = {};
  const w = creep('w1', 'worker', { work: 2, carry: 2, move: 2 }, 50);
  const r = request();
  const first = evidence.observe(stateAt(1, {
    creeps: [w],
    requests: [r],
    assignmentShadow: {
      assignments: [{ executorId: 'w1', requestId: r.id }],
      unfilled: [{ requestId: r.id, remaining: 1 }],
      summary: { deferred: false, switchCount: 1 }
    }
  }), memory, { time: 1 });
  assert.equal(first.current.requestsOpened, 1);
  assert.equal(first.current.assignmentsPerTick, 1);
  assert.equal(first.current.switchesPerTick, 1);
  assert.equal(first.current.averageUnfilledRequests, 1);
  assert.equal(first.current.idleCompatibleExecutorRatio, 0);

  const closed = request({ status: 'SATISFIED', updatedTick: 2 });
  const second = evidence.observe(stateAt(2, {
    controllerProgress: 12,
    siteProgress: 5,
    creeps: [w],
    requests: [closed]
  }), memory, { time: 2 });
  assert.equal(second.current.requestsOpened, 1);
  assert.equal(second.current.requestsClosed, 1);
  assert.equal(second.current.averageRequestLatency, 1);
  assert.equal(second.current.maxRequestLatency, 1);
  assert.equal(second.current.controllerProgress, 2);
  assert.equal(second.current.constructionProgress, 5);
  assert.equal(second.current.usefulWorkPerTick, 3.5);
}

{
  const memory = {};
  const w = creep('w-idle', 'worker', { work: 2, carry: 2, move: 2 }, 50);
  const r = request({ id: 'idle-r', dedupeKey: 'idle-r', createdTick: 10, updatedTick: 10 });
  const result = evidence.observe(stateAt(10, {
    creeps: [w],
    requests: [r],
    assignmentShadow: {
      assignments: [],
      unfilled: [{ requestId: r.id, remaining: 2 }],
      summary: { deferred: false, switchCount: 0 }
    }
  }), memory, { time: 10 });
  assert.equal(result.current.averageCandidateExecutorsWhenUnfilled, 1);
  assert.equal(result.current.idleCompatibleExecutorRatio, 1);
}

{
  const memory = {};
  const blocked = request({
    id: 'blocked-r', dedupeKey: 'blocked-r', createdTick: 20, updatedTick: 20, status: 'BLOCKED',
    blocked: { untilTick: 30, reason: 'NO_PATH', failureCount: 1 }
  });
  const result = evidence.observe(stateAt(20, { requests: [blocked] }), memory, { time: 20 });
  assert.equal(result.current.averageBlockedRequests, 1);
  assert.equal(result.current.blockedReasons.NO_PATH, 1);
}

{
  const memory = {};
  const result = evidence.observe(stateAt(30, {
    assignmentShadow: { assignments: [], unfilled: [], summary: { deferred: true, deferReason: 'LOW_CPU', switchCount: 0 } }
  }), memory, { time: 30 });
  assert.equal(result.current.deferredRatio, 1);
}

{
  const memory = {};
  // Site completion: first observe a partial site, then remove it and expose the built structure.
  evidence.observe(stateAt(40, { siteProgress: 80 }), memory, { time: 40 });
  const result = evidence.observe(stateAt(41, { sites: false, completedSite: true }), memory, { time: 41 });
  assert.equal(result.current.constructionProgress, 20);
}

{
  const memory = {};
  let completed = null;
  for (let t = 100; t < 200; t++) {
    const result = evidence.observe(stateAt(t, { sites: false }), memory, { time: t });
    if (result.completed) completed = result.completed;
  }
  assert.ok(completed);
  assert.equal(completed.startTick, 100);
  assert.equal(completed.endTick, 199);
  assert.equal(completed.ticks, 100);
  assert.equal(completed.authority, 'SHADOW_EVIDENCE');
  assert.deepEqual(evidence.snapshot('E1N1', memory).lastWindow, completed);
}

{
  const roomState = {
    seenEpisodes: { old: 1, recent: 9990 },
    seenTerminals: { old: 2, recent: 9991 }
  };
  evidence._test.pruneSeen(roomState, 10000);
  assert.equal(roomState.seenEpisodes.old, undefined);
  assert.equal(roomState.seenTerminals.old, undefined);
  assert.equal(roomState.seenEpisodes.recent, 9990);
}

{
  // Evidence compatibility scans must reuse one static executor profile per
  // creep instead of re-reading body parts for every unfilled request.
  const w = creep('w-profile-cache', 'worker', { work: 2, carry: 2, move: 2 }, 50);
  let bodyPartReads = 0;
  const originalGetActiveBodyparts = w.getActiveBodyparts;
  w.getActiveBodyparts = function(type) {
    bodyPartReads += 1;
    return originalGetActiveBodyparts.call(this, type);
  };

  const delivery = request({
    id: 'profile-delivery',
    dedupeKey: 'profile-delivery',
    kind: 'ENERGY_DELIVERY',
    demand: { capability: null, amount: 50 }
  });
  const build = request({
    id: 'profile-build',
    dedupeKey: 'profile-build',
    kind: 'BUILD',
    demand: { capability: 'workBuild', amount: 2 }
  });

  const candidates = evidence._test.compatibleExecutors([delivery, build], [w]);
  assert.equal(candidates['w-profile-cache'], true);
  assert.equal(bodyPartReads, 2);
}

console.log('assignment evidence tests passed');