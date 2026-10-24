import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.FIND_STRUCTURES = 1;
global.FIND_CREEPS = 2;
global.STRUCTURE_ROAD = 'road';
global.STRUCTURE_CONTAINER = 'container';
global.STRUCTURE_RAMPART = 'rampart';
global.STRUCTURE_EXTRACTOR = 'extractor';
global.OBSTACLE_OBJECT_TYPES = ['spawn', 'extension', 'tower', 'constructedWall'];
global.ERR_NO_PATH = -2;

const routeCache = require('../game/path.route.cache.js');

class FakeCostMatrix {
  constructor() {
    this.values = Object.create(null);
  }

  key(x, y) {
    return x + ':' + y;
  }

  set(x, y, cost) {
    this.values[this.key(x, y)] = cost;
  }

  get(x, y) {
    return this.values[this.key(x, y)] || 0;
  }
}

function pos(x, y, roomName = 'E1N1') {
  return { x, y, roomName };
}

function makeRoom(name = 'E1N1') {
  return {
    name,
    find(type) {
      if (type === FIND_STRUCTURES) {
        return [
          { structureType: 'road', pos: pos(2, 1, name) },
          { structureType: 'spawn', pos: pos(9, 9, name) }
        ];
      }
      if (type === FIND_CREEPS) return [];
      return [];
    }
  };
}

{
  const memory = {
    vnextPathCache: {
      schemaVersion: 999,
      world: { stale: true }
    }
  };
  const store = routeCache.ensure(memory);
  assert.equal(store.schemaVersion, 1);
  assert.equal(Object.keys(store.world).length, 0);
  assert.equal(Object.keys(store.local).length, 0);
}

{
  const a = routeCache.stableProfileKey({ plainCost: 2, swampCost: 10 });
  const b = routeCache.stableProfileKey({ plainCost: 3, swampCost: 10 });
  assert.notEqual(a, b);
}

{
  const memory = {};
  let routeCalls = 0;
  const map = {
    findRoute(from, to, opts) {
      routeCalls += 1;
      if (opts.routeCallback('E1N2', from) === Infinity) return ERR_NO_PATH;
      return [
        { exit: 3, room: 'E1N2' },
        { exit: 3, room: 'E1N3' }
      ];
    }
  };
  const confidence = {
    E1N1: 0.9,
    E1N2: 0.6,
    E1N3: 0.8
  };
  const intelProvider = roomName => ({ observation: { confidence: confidence[roomName] || 0 } });

  const first = routeCache.getWorldRoute('E1N1', 'E1N3', {
    tick: 100,
    map,
    intelProvider,
    profile: { plainCost: 2 }
  }, memory);
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  assert.deepEqual(first.rooms, ['E1N1', 'E1N2', 'E1N3']);
  assert.equal(first.confidence, 0.6);
  assert.equal(routeCalls, 1);

  const hit = routeCache.getWorldRoute('E1N1', 'E1N3', {
    tick: 101,
    map,
    intelProvider,
    profile: { plainCost: 2 }
  }, memory);
  assert.equal(hit.cached, true);
  assert.equal(routeCalls, 1);

  // Movement profile participates in the cache key.
  const profileMiss = routeCache.getWorldRoute('E1N1', 'E1N3', {
    tick: 102,
    map,
    intelProvider,
    profile: { plainCost: 3 }
  }, memory);
  assert.equal(profileMiss.cached, false);
  assert.equal(routeCalls, 2);

  // Hostile route filtering can reject an otherwise valid graph route.
  const hostile = routeCache.getWorldRoute('E1N1', 'E1N3', {
    tick: 103,
    map,
    hostileRooms: ['E1N2'],
    routeClass: 'avoid-hostile'
  }, memory);
  assert.equal(hostile.ok, false);
  assert.equal(hostile.reason, 'NO_PATH');
  assert.equal(routeCalls, 3);

  // A new hostile observation invalidates every cached route crossing the room.
  const removed = routeCache.invalidateHostileRoom('E1N2', memory);
  assert.equal(removed, 2);
  const afterInvalidation = routeCache.getWorldRoute('E1N1', 'E1N3', {
    tick: 104,
    map,
    intelProvider,
    profile: { plainCost: 2 }
  }, memory);
  assert.equal(afterInvalidation.cached, false);
  assert.equal(routeCalls, 4);

  const snap = routeCache.snapshot(memory);
  assert.equal(snap.stats.worldHits, 1);
  assert.equal(snap.stats.worldMisses, 4);
  assert.equal(snap.stats.invalidations, 1);
  assert.equal(snap.lastInvalidation.reason, 'HOSTILE_ROUTE_INVALIDATION');
}

// P1: dynamic threat exclusions must not reuse a route cached under
// different risk conditions. Array, Set and map forms describe the same
// exclusion set; a caller-owned callback is opaque and must bypass cache.
{
  const memory = {};
  let calls = 0;
  const map = {
    findRoute(from, to, options) {
      calls++;
      const blocked = options.routeCallback('E1N2', from) === Infinity;
      return blocked
        ? [{ exit: 3, room: 'E1N4' }, { exit: 3, room: to }]
        : [{ exit: 3, room: 'E1N2' }, { exit: 3, room: to }];
    }
  };
  const query = (tick, extra = {}) => routeCache.getWorldRoute(
    'E1N1', 'E1N3', { tick, map, ...extra }, memory);

  const plain = query(10);
  assert.equal(plain.cached, false);
  assert.deepEqual(plain.rooms, ['E1N1', 'E1N2', 'E1N3']);
  assert.equal(calls, 1);

  const blocked = new Set(['E1N2']);
  const avoid = query(11, { hostileRooms: blocked });
  assert.equal(avoid.cached, false,
    'A plain route must not bypass newly supplied hostile exclusions');
  assert.deepEqual(avoid.rooms, ['E1N1', 'E1N4', 'E1N3']);
  assert.notEqual(avoid.key, plain.key);
  assert.equal(calls, 2);

  const sameExclusion = query(12, {
    hostileRooms: { E1N2: true, E1N4: false }
  });
  assert.equal(sameExclusion.cached, true,
    'Set, Array and object exclusions share a canonical cache signature');
  assert.equal(calls, 2);
  assert.equal(routeCache.worldKey('E1N1', 'E1N3',
    { hostileRooms: ['E1N2', 'E1N2'] }), avoid.key);
  assert.equal(routeCache.worldKey('E1N1', 'E1N3',
    { hostileRooms: ['E1N2', 'E1N4'] }) === avoid.key, false);

  // Mutating caller-owned threat data on the following tick must not
  // accidentally reuse the route computed under the old exclusions.
  blocked.clear();
  const relaxed = query(13, { hostileRooms: blocked });
  assert.equal(relaxed.cached, true);
  assert.deepEqual(relaxed.rooms, plain.rooms);
  assert.equal(calls, 2);

  // A custom callback may depend on changing external intel even if its
  // routeClass/profile are identical. Do not read or write shared cache.
  let exclude = true;
  const mutableCallback = roomName =>
    roomName === 'E1N2' && exclude ? Infinity : 1;
  const customAvoid = query(14, { routeCallback: mutableCallback });
  assert.equal(customAvoid.cached, false);
  assert.deepEqual(customAvoid.rooms, avoid.rooms);
  assert.equal(calls, 3);
  exclude = false;
  const customAllow = query(15, { routeCallback: mutableCallback });
  assert.equal(customAllow.cached, false);
  assert.deepEqual(customAllow.rooms, plain.rooms);
  assert.equal(calls, 4);

  const afterCallback = query(16);
  assert.equal(afterCallback.cached, true);
  assert.deepEqual(afterCallback.rooms, plain.rooms);
  assert.equal(routeCache.snapshot(memory).worldRoutes, 2,
    'Opaque callback routes must not poison shared cached routes');
  assert.equal(calls, 4);
}

{
  const memory = {};
  const room = makeRoom();
  let searches = 0;
  const PF = {
    CostMatrix: FakeCostMatrix,
    search(from, goal, opts) {
      searches += 1;
      assert.equal(opts.maxRooms, 1);
      assert.ok(opts.plainCost === 2 || opts.plainCost === 3);
      assert.equal(opts.swampCost, 10);
      const matrix = opts.roomCallback('E1N1');
      assert.equal(matrix.get(2, 1), 1);
      assert.equal(matrix.get(9, 9), 255);
      return {
        path: [pos(2, 1), pos(3, 1), pos(4, 1)],
        cost: 3,
        ops: 7,
        incomplete: false
      };
    }
  };

  const first = routeCache.getInRoomPath(pos(1, 1), pos(5, 1), {
    tick: 200,
    room,
    PathFinder: PF,
    range: 1,
    maxOps: 200
  }, memory);
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  assert.equal(first.cost, 3);
  assert.equal(first.ops, 7);
  assert.equal(first.incomplete, false);
  assert.deepEqual(first.path, [pos(2, 1), pos(3, 1), pos(4, 1)]);
  assert.equal(searches, 1);

  const encoded = routeCache.encodeLocalPath(first.path, 'E1N1');
  assert.equal(encoded.length, 6);
  assert.deepEqual(routeCache.decodeLocalPath(encoded, 'E1N1'), first.path);

  const hit = routeCache.getInRoomPath(pos(1, 1), pos(5, 1), {
    tick: 201,
    room,
    PathFinder: PF,
    range: 1,
    maxOps: 200
  }, memory);
  assert.equal(hit.cached, true);
  assert.equal(searches, 1);

  // Profile changes produce independent local paths.
  const profileMiss = routeCache.getInRoomPath(pos(1, 1), pos(5, 1), {
    tick: 202,
    room,
    PathFinder: PF,
    range: 1,
    profile: { plainCost: 3 }
  }, memory);
  assert.equal(profileMiss.cached, false);
  assert.equal(searches, 2);

  // Stuck feedback invalidates a repeatedly failing cached local path.
  const firstStuck = routeCache.reportStuck(first.key, {
    tick: 203,
    threshold: 2,
    windowTicks: 10
  }, memory);
  assert.equal(firstStuck.invalidated, false);
  assert.equal(firstStuck.count, 1);

  const secondStuck = routeCache.reportStuck(first.key, {
    tick: 204,
    threshold: 2,
    windowTicks: 10
  }, memory);
  assert.equal(secondStuck.invalidated, true);
  assert.equal(secondStuck.count, 2);

  const afterStuck = routeCache.getInRoomPath(pos(1, 1), pos(5, 1), {
    tick: 205,
    room,
    PathFinder: PF,
    range: 1
  }, memory);
  assert.equal(afterStuck.cached, false);
  assert.equal(searches, 3);

  // TTL expiry is version-independent and recomputes the path.
  const afterTtl = routeCache.getInRoomPath(pos(1, 1), pos(5, 1), {
    tick: 800,
    ttl: 100,
    room,
    PathFinder: PF,
    range: 1
  }, memory);
  assert.equal(afterTtl.cached, false);
  assert.equal(searches, 4);

  // Room invalidation clears all local paths for that room and bumps version.
  const removed = routeCache.invalidateRoom('E1N1', 'PLANNER_CHANGED', memory);
  assert.ok(removed >= 1);
  assert.equal(routeCache.snapshot(memory).roomVersions.E1N1, 1);

  const afterRoomInvalidation = routeCache.getInRoomPath(pos(1, 1), pos(5, 1), {
    tick: 801,
    room,
    PathFinder: PF,
    range: 1
  }, memory);
  assert.equal(afterRoomInvalidation.cached, false);
  assert.equal(searches, 5);
}

{
  const memory = {};
  let routeCalls = 0;
  const map = {
    findRoute() {
      routeCalls += 1;
      return [{ exit: 3, room: 'E2N2' }];
    }
  };
  routeCache.getWorldRoute('E2N1', 'E2N2', { tick: 10, map, ttl: 20 }, memory);
  assert.equal(routeCalls, 1);
  assert.equal(routeCache.prune({ tick: 31, worldTtl: 20, localTtl: 20 }, memory), 1);
  assert.equal(routeCache.snapshot(memory).worldRoutes, 0);
  assert.equal(routeCache.snapshot(memory).stats.pruned, 1);
}

{
  const memory = {};
  const crossRoom = routeCache.getInRoomPath(
    pos(1, 1, 'E1N1'),
    pos(1, 1, 'E1N2'),
    {},
    memory
  );
  assert.equal(crossRoom.ok, false);
  assert.equal(crossRoom.reason, 'CROSS_ROOM_LOCAL_PATH');
}

console.log('path route cache tests passed');
