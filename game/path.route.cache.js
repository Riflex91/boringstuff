'use strict';

const costField = require('path.cost.field');

const SCHEMA_VERSION = 1;
const DEFAULT_WORLD_TTL = 1500;
const DEFAULT_LOCAL_TTL = 500;
const DEFAULT_STUCK_WINDOW = 25;
const DEFAULT_STUCK_THRESHOLD = 2;
const MAX_WORLD_ROUTES = 200;
const MAX_LOCAL_PATHS = 500;

function nowTick(options) {
  if (options && Number.isFinite(options.tick)) return options.tick;
  if (typeof Game !== 'undefined' && Number.isFinite(Game.time)) return Game.time;
  return 0;
}

function memoryRoot(root) {
  if (root) return root;
  if (typeof Memory !== 'undefined') return Memory;
  return {};
}

function blankStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    roomVersions: {},
    world: {},
    local: {},
    stuck: {},
    lastInvalidation: null,
    stats: {
      worldHits: 0,
      worldMisses: 0,
      localHits: 0,
      localMisses: 0,
      invalidations: 0,
      pruned: 0
    }
  };
}

function ensure(root) {
  const memory = memoryRoot(root);
  if (!memory.vnextPathCache || memory.vnextPathCache.schemaVersion !== SCHEMA_VERSION) {
    memory.vnextPathCache = blankStore();
  }
  return memory.vnextPathCache;
}

function stableProfileKey(profile) {
  const p = costField.normalizeProfile(profile);
  return [
    p.plainCost,
    p.swampCost,
    p.roadCost,
    p.creepCost,
    p.stationaryCost,
    p.congestionCost,
    p.hostileCost,
    p.hostileRange,
    p.keeperCost,
    p.keeperRange
  ].join(',');
}

function worldKey(fromRoom, toRoom, options) {
  const routeClass = options && options.routeClass ? String(options.routeClass) : 'default';
  return String(fromRoom) + '>' + String(toRoom) + '|' + stableProfileKey(options && options.profile) + '|' + routeClass;
}

function posOf(value) {
  if (!value) return null;
  const p = value.pos || value;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return {
    x: Math.round(p.x),
    y: Math.round(p.y),
    roomName: p.roomName || null
  };
}

function localKey(origin, goal, options) {
  const from = posOf(origin);
  const to = posOf(goal);
  if (!from || !to) return null;
  const range = options && Number.isFinite(options.range) ? Math.max(0, Math.round(options.range)) : 0;
  const variant = options && options.variant ? String(options.variant) : 'default';
  return [
    from.roomName || to.roomName || '',
    from.x + ',' + from.y,
    to.x + ',' + to.y,
    'r' + range,
    stableProfileKey(options && options.profile),
    variant
  ].join('|');
}

function cacheFresh(entry, now, ttl) {
  return !!entry &&
    entry.schemaVersion === SCHEMA_VERSION &&
    Number.isFinite(entry.createdTick) &&
    now - entry.createdTick <= ttl;
}

function intelConfidence(roomName, provider) {
  if (typeof provider !== 'function') return null;
  const record = provider(roomName);
  if (!record) return 0;
  if (Number.isFinite(record.confidence)) return Math.max(0, Math.min(1, record.confidence));
  if (record.observation && Number.isFinite(record.observation.confidence)) {
    return Math.max(0, Math.min(1, record.observation.confidence));
  }
  return 0;
}

function routeConfidence(rooms, provider) {
  if (typeof provider !== 'function') return null;
  let confidence = 1;
  for (const roomName of rooms) confidence = Math.min(confidence, intelConfidence(roomName, provider));
  return confidence;
}

function routeRooms(fromRoom, route) {
  const rooms = [fromRoom];
  for (const step of route || []) {
    const roomName = step && (step.room || step.roomName);
    if (roomName && rooms[rooms.length - 1] !== roomName) rooms.push(roomName);
  }
  return rooms;
}

function isNoPath(result) {
  if (Array.isArray(result)) return false;
  if (typeof ERR_NO_PATH !== 'undefined' && result === ERR_NO_PATH) return true;
  return result === -2 || result === null || result === undefined;
}

function mapApi(options) {
  if (options && options.map) return options.map;
  if (typeof Game !== 'undefined' && Game.map) return Game.map;
  return null;
}

function normalizeHostileRooms(value) {
  if (!value) return {};
  if (Array.isArray(value)) {
    const result = {};
    for (const roomName of value) result[roomName] = true;
    return result;
  }
  if (value instanceof Set) {
    const result = {};
    for (const roomName of value) result[roomName] = true;
    return result;
  }
  return value;
}

function getWorldRoute(fromRoom, toRoom, options, root) {
  const opts = options || {};
  const store = ensure(root);
  const tick = nowTick(opts);
  const ttl = Number.isFinite(opts.ttl) ? Math.max(0, opts.ttl) : DEFAULT_WORLD_TTL;
  const key = worldKey(fromRoom, toRoom, opts);
  const cached = store.world[key];

  if (cacheFresh(cached, tick, ttl)) {
    cached.lastUsedTick = tick;
    cached.hits = (cached.hits || 0) + 1;
    store.stats.worldHits += 1;
    return {
      ok: true,
      cached: true,
      key,
      rooms: cached.rooms.slice(),
      confidence: cached.confidence,
      createdTick: cached.createdTick
    };
  }

  store.stats.worldMisses += 1;
  const map = mapApi(opts);
  if (!map || typeof map.findRoute !== 'function') {
    return { ok: false, cached: false, key, reason: 'MAP_UNAVAILABLE', rooms: [] };
  }

  const hostileRooms = normalizeHostileRooms(opts.hostileRooms);
  const userCallback = typeof opts.routeCallback === 'function' ? opts.routeCallback : null;
  const route = map.findRoute(fromRoom, toRoom, {
    routeCallback(roomName, from) {
      if (hostileRooms[roomName] && roomName !== toRoom) return Infinity;
      if (userCallback) return userCallback(roomName, from);
      return 1;
    }
  });

  if (isNoPath(route)) {
    return { ok: false, cached: false, key, reason: 'NO_PATH', rooms: [] };
  }

  const rooms = routeRooms(fromRoom, route);
  const confidence = routeConfidence(rooms, opts.intelProvider);
  store.world[key] = {
    schemaVersion: SCHEMA_VERSION,
    fromRoom,
    toRoom,
    profileKey: stableProfileKey(opts.profile),
    routeClass: opts.routeClass || 'default',
    rooms,
    confidence,
    createdTick: tick,
    lastUsedTick: tick,
    hits: 0
  };

  trimOldest(store.world, MAX_WORLD_ROUTES);

  return {
    ok: true,
    cached: false,
    key,
    rooms: rooms.slice(),
    confidence,
    createdTick: tick
  };
}

function encodeLocalPath(path, roomName) {
  let result = '';
  for (const step of path || []) {
    const pos = posOf(step);
    if (!pos || (pos.roomName && roomName && pos.roomName !== roomName)) return null;
    if (pos.x < 0 || pos.x >= 50 || pos.y < 0 || pos.y >= 50) return null;
    result += String.fromCharCode(35 + pos.x);
    result += String.fromCharCode(35 + pos.y);
  }
  return result;
}

function decodeLocalPath(encoded, roomName) {
  if (typeof encoded !== 'string' || encoded.length % 2 !== 0) return [];
  const result = [];
  for (let i = 0; i < encoded.length; i += 2) {
    result.push({
      x: encoded.charCodeAt(i) - 35,
      y: encoded.charCodeAt(i + 1) - 35,
      roomName
    });
  }
  return result;
}

function pathFinderApi(options) {
  if (options && options.PathFinder) return options.PathFinder;
  if (typeof PathFinder !== 'undefined') return PathFinder;
  return null;
}

function roomFor(roomName, options) {
  if (options && options.room) return options.room;
  if (options && options.rooms && options.rooms[roomName]) return options.rooms[roomName];
  if (typeof Game !== 'undefined' && Game.rooms && Game.rooms[roomName]) return Game.rooms[roomName];
  return null;
}

function getInRoomPath(origin, goal, options, root) {
  const opts = options || {};
  const from = posOf(origin);
  const to = posOf(goal);
  if (!from || !to) return { ok: false, cached: false, reason: 'INVALID_POSITION', path: [] };

  const roomName = from.roomName || to.roomName;
  if (!roomName || (from.roomName && to.roomName && from.roomName !== to.roomName)) {
    return { ok: false, cached: false, reason: 'CROSS_ROOM_LOCAL_PATH', path: [] };
  }

  const store = ensure(root);
  const tick = nowTick(opts);
  const ttl = Number.isFinite(opts.ttl) ? Math.max(0, opts.ttl) : DEFAULT_LOCAL_TTL;
  const key = localKey(from, to, opts);
  const roomVersion = store.roomVersions[roomName] || 0;
  const cached = store.local[key];

  if (cacheFresh(cached, tick, ttl) && cached.roomVersion === roomVersion) {
    cached.lastUsedTick = tick;
    cached.hits = (cached.hits || 0) + 1;
    store.stats.localHits += 1;
    return {
      ok: true,
      cached: true,
      key,
      path: decodeLocalPath(cached.encodedPath, roomName),
      cost: cached.cost,
      ops: cached.ops,
      incomplete: cached.incomplete,
      createdTick: cached.createdTick
    };
  }

  store.stats.localMisses += 1;
  const PF = pathFinderApi(opts);
  if (!PF || typeof PF.search !== 'function' || !PF.CostMatrix) {
    return { ok: false, cached: false, key, reason: 'PATHFINDER_UNAVAILABLE', path: [] };
  }

  const room = roomFor(roomName, opts);
  if (!room) return { ok: false, cached: false, key, reason: 'ROOM_UNAVAILABLE', path: [] };

  const goalRange = Number.isFinite(opts.range) ? Math.max(0, Math.round(opts.range)) : 0;
  const roomCallback = name => {
    if (name !== roomName) return false;
    return costField.buildRoomCostMatrix(room, Object.assign({}, opts.costFieldOptions || {}, {
      CostMatrix: PF.CostMatrix,
      profile: opts.profile
    }));
  };

  const searchOptions = Object.assign(
    {},
    costField.pathfinderOptions(opts.profile, roomCallback),
    {
      maxRooms: 1
    }
  );
  if (Number.isFinite(opts.maxOps)) searchOptions.maxOps = Math.max(1, Math.round(opts.maxOps));
  if (Number.isFinite(opts.maxCost)) searchOptions.maxCost = Math.max(0, opts.maxCost);

  const result = PF.search(from, { pos: to, range: goalRange }, searchOptions) || {};
  const path = Array.isArray(result.path) ? result.path : [];
  const encodedPath = encodeLocalPath(path, roomName);
  if (encodedPath === null) {
    return { ok: false, cached: false, key, reason: 'UNSERIALIZABLE_PATH', path: [] };
  }

  store.local[key] = {
    schemaVersion: SCHEMA_VERSION,
    roomName,
    roomVersion,
    profileKey: stableProfileKey(opts.profile),
    variant: opts.variant || 'default',
    range: goalRange,
    encodedPath,
    cost: Number.isFinite(result.cost) ? result.cost : null,
    ops: Number.isFinite(result.ops) ? result.ops : null,
    incomplete: !!result.incomplete,
    createdTick: tick,
    lastUsedTick: tick,
    hits: 0
  };

  trimOldest(store.local, MAX_LOCAL_PATHS);

  return {
    ok: true,
    cached: false,
    key,
    path: decodeLocalPath(encodedPath, roomName),
    cost: store.local[key].cost,
    ops: store.local[key].ops,
    incomplete: store.local[key].incomplete,
    createdTick: tick
  };
}

function invalidateRoom(roomName, reason, root) {
  const store = ensure(root);
  store.roomVersions[roomName] = (store.roomVersions[roomName] || 0) + 1;

  let removed = 0;
  for (const key of Object.keys(store.world)) {
    if ((store.world[key].rooms || []).indexOf(roomName) >= 0) {
      delete store.world[key];
      removed += 1;
    }
  }
  for (const key of Object.keys(store.local)) {
    if (store.local[key].roomName === roomName) {
      delete store.local[key];
      removed += 1;
    }
  }

  store.stats.invalidations += 1;
  store.lastInvalidation = {
    roomName,
    reason: reason || 'ROOM_INVALIDATED',
    tick: nowTick()
  };
  return removed;
}

function invalidateHostileRoom(roomName, root) {
  return invalidateRoom(roomName, 'HOSTILE_ROUTE_INVALIDATION', root);
}

function reportStuck(pathKey, options, root) {
  const opts = options || {};
  const store = ensure(root);
  const tick = nowTick(opts);
  const windowTicks = Number.isFinite(opts.windowTicks)
    ? Math.max(1, Math.round(opts.windowTicks))
    : DEFAULT_STUCK_WINDOW;
  const threshold = Number.isFinite(opts.threshold)
    ? Math.max(1, Math.round(opts.threshold))
    : DEFAULT_STUCK_THRESHOLD;

  const previous = store.stuck[pathKey];
  const count = previous && tick - previous.lastTick <= windowTicks
    ? previous.count + 1
    : 1;

  store.stuck[pathKey] = { count, lastTick: tick };
  if (count < threshold) return { invalidated: false, count };

  let invalidated = false;
  if (store.local[pathKey]) {
    delete store.local[pathKey];
    invalidated = true;
  }
  delete store.stuck[pathKey];
  if (invalidated) {
    store.stats.invalidations += 1;
    store.lastInvalidation = {
      pathKey,
      reason: 'STUCK_PATH',
      tick
    };
  }
  return { invalidated, count };
}

function trimOldest(entries, maxEntries) {
  const keys = Object.keys(entries);
  if (keys.length <= maxEntries) return 0;
  keys.sort((a, b) => {
    const av = entries[a] && Number.isFinite(entries[a].lastUsedTick) ? entries[a].lastUsedTick : 0;
    const bv = entries[b] && Number.isFinite(entries[b].lastUsedTick) ? entries[b].lastUsedTick : 0;
    return av - bv;
  });
  const remove = keys.length - maxEntries;
  for (let i = 0; i < remove; i++) delete entries[keys[i]];
  return remove;
}

function prune(options, root) {
  const opts = options || {};
  const store = ensure(root);
  const tick = nowTick(opts);
  const worldTtl = Number.isFinite(opts.worldTtl) ? Math.max(0, opts.worldTtl) : DEFAULT_WORLD_TTL;
  const localTtl = Number.isFinite(opts.localTtl) ? Math.max(0, opts.localTtl) : DEFAULT_LOCAL_TTL;
  let removed = 0;

  for (const key of Object.keys(store.world)) {
    if (!cacheFresh(store.world[key], tick, worldTtl)) {
      delete store.world[key];
      removed += 1;
    }
  }
  for (const key of Object.keys(store.local)) {
    if (!cacheFresh(store.local[key], tick, localTtl)) {
      delete store.local[key];
      removed += 1;
    }
  }

  removed += trimOldest(store.world, MAX_WORLD_ROUTES);
  removed += trimOldest(store.local, MAX_LOCAL_PATHS);
  store.stats.pruned += removed;
  return removed;
}

function snapshot(root) {
  const store = ensure(root);
  return {
    schemaVersion: store.schemaVersion,
    worldRoutes: Object.keys(store.world).length,
    localPaths: Object.keys(store.local).length,
    roomVersions: Object.assign({}, store.roomVersions),
    stats: Object.assign({}, store.stats),
    lastInvalidation: store.lastInvalidation
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_WORLD_TTL,
  DEFAULT_LOCAL_TTL,
  ensure,
  stableProfileKey,
  worldKey,
  localKey,
  getWorldRoute,
  getInRoomPath,
  encodeLocalPath,
  decodeLocalPath,
  invalidateRoom,
  invalidateHostileRoom,
  reportStuck,
  prune,
  snapshot,
  _test: {
    routeRooms,
    routeConfidence,
    cacheFresh,
    trimOldest
  }
};
