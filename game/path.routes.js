'use strict';

const costs = require('path.costs');
const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 48;
const MAX_BYTES = 120000;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';

function root(memory) {
  if (!memory.bot) memory.bot = {};
  let value = memory.bot.pathRoutes;
  if (!value || value.schemaVersion !== SCHEMA_VERSION || !value.paths || !value.graphs) {
    value = memory.bot.pathRoutes = { schemaVersion: SCHEMA_VERSION, paths: {}, graphs: {},
      hits: 0, misses: 0, invalidations: 0, lastInvalidation: null };
  }
  return value;
}

function pack(path) {
  const chunks = [];
  for (const p of path) {
    if (!costs.position(p) || typeof p.roomName !== 'string') throw new Error('Invalid path position');
    let chunk = chunks[chunks.length - 1];
    if (!chunk || chunk.roomName !== p.roomName) chunks.push(chunk = { roomName: p.roomName, coordinates: '' });
    chunk.coordinates += ALPHABET[p.x] + ALPHABET[p.y];
  }
  return chunks;
}

function unpack(chunks) {
  if (!Array.isArray(chunks)) return null;
  const result = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk.roomName !== 'string' || typeof chunk.coordinates !== 'string' || chunk.coordinates.length % 2) return null;
    for (let i = 0; i < chunk.coordinates.length; i += 2) {
      const x = ALPHABET.indexOf(chunk.coordinates[i]);
      const y = ALPHABET.indexOf(chunk.coordinates[i + 1]);
      if (x < 0 || y < 0) return null;
      result.push({ x, y, roomName: chunk.roomName });
    }
  }
  return result;
}

function trim(cache, now) {
  for (const type of ['paths', 'graphs']) {
    const entries = cache[type];
    for (const key of Object.keys(entries)) {
      if (!entries[key] || entries[key].expiresTick <= now || entries[key].createdTick > now) delete entries[key];
    }
    const ordered = Object.keys(entries).sort((a, b) => entries[a].lastUsedTick - entries[b].lastUsedTick || a.localeCompare(b));
    while (ordered.length > MAX_ENTRIES) delete entries[ordered.shift()];
  }
  // Byte cap also covers adversarially long custom room names and paths.
  let text = JSON.stringify(cache);
  while (text.length * 2 > MAX_BYTES && (Object.keys(cache.paths).length || Object.keys(cache.graphs).length)) {
    let oldest = null;
    for (const type of ['paths', 'graphs']) for (const key of Object.keys(cache[type])) {
      const age = cache[type][key].lastUsedTick;
      if (!oldest || age < oldest.age) oldest = { type, key, age };
    }
    delete cache[oldest.type][oldest.key];
    text = JSON.stringify(cache);
  }
}

function invalidateRoom(roomName, reason, memory) {
  const cache = root(memory);
  let removed = 0;
  for (const type of ['paths', 'graphs']) for (const key of Object.keys(cache[type])) {
    if ((cache[type][key].rooms || []).includes(roomName)) { delete cache[type][key]; removed++; }
  }
  cache.invalidations += removed;
  cache.lastInvalidation = { roomName, reason: String(reason || 'ROOM_CHANGED').slice(0, 80) };
  return removed;
}

function feedback(key, event, memory) {
  const cache = root(memory);
  const entry = cache.paths[key];
  if (!entry) return false;
  if (event === 'STUCK' || event === 'BLOCKED' || event === 'HOSTILE') {
    for (const room of entry.rooms) invalidateRoom(room, event, memory);
    return true;
  }
  return false;
}

function roomSafety(roomName, options, game) {
  const room = game.rooms && game.rooms[roomName];
  if (options.avoidHostileRooms !== false && room && room.controller && room.controller.owner && !room.controller.my) {
    return { allowed: false, confidence: 0 };
  }
  if (room && room.controller && room.controller.my) return { allowed: true, confidence: 1 };
  const intel = options.intel && options.intel[roomName];
  const observation = intel && intel.observation;
  const maxAge = Number.isFinite(options.intelMaxAge) ? Math.max(0, options.intelMaxAge) : 1500;
  const fresh = observation && Number.isFinite(observation.lastSeenTick) &&
    observation.lastSeenTick <= game.time && game.time - observation.lastSeenTick <= maxAge;
  if (intel && intel.classification && intel.classification.roomStatus === 'closed') return { allowed: false, confidence: 0 };
  if (options.avoidHostileRooms !== false && intel && ((intel.controller && intel.controller.owner && !intel.controller.my) ||
      (intel.threat && intel.threat.hostileCreeps > 0))) return { allowed: false, confidence: 0 };
  if (room) return { allowed: true, confidence: 1 };
  return { allowed: !!fresh || options.allowUnknown === true,
    confidence: fresh ? Math.max(0, Math.min(1, Number(observation.confidence) || 0)) : 0 };
}

function failure(reason, extra) {
  return Object.assign({ schemaVersion: SCHEMA_VERSION, authority: 'SHADOW', complete: false,
    reason, path: [], cacheHit: false, confidence: 0 }, extra || {});
}

function validPath(path, origin, target, range, rooms, fields) {
  const last = path[path.length - 1] || origin;
  if (last.roomName !== target.roomName || Math.max(Math.abs(last.x - target.x), Math.abs(last.y - target.y)) > range) return false;
  let previous = origin;
  for (const p of path) {
    if (!costs.position(p) || !rooms.includes(p.roomName) || (fields[p.roomName] && fields[p.roomName].get(p.x, p.y) === 255)) return false;
    if (p.roomName === previous.roomName) {
      if (Math.max(Math.abs(p.x - previous.x), Math.abs(p.y - previous.y)) !== 1) return false;
    } else {
      if (Math.abs(rooms.indexOf(previous.roomName) - rooms.indexOf(p.roomName)) !== 1) return false;
      const horizontal = ((previous.x === 49 && p.x === 0) || (previous.x === 0 && p.x === 49)) && Math.abs(p.y - previous.y) <= 1;
      const vertical = ((previous.y === 49 && p.y === 0) || (previous.y === 0 && p.y === 49)) && Math.abs(p.x - previous.x) <= 1;
      if (!horizontal && !vertical) return false;
    }
    previous = p;
  }
  return true;
}

function search(origin, goal, options, context) {
  options = options || {};
  context = context || {};
  const game = context.game || (typeof Game !== 'undefined' ? Game : null);
  const memory = context.memory || (typeof Memory !== 'undefined' ? Memory : null);
  const pf = context.pathFinder || (typeof PathFinder !== 'undefined' ? PathFinder : null);
  const target = goal && (goal.pos || goal);
  if (!costs.position(origin) || !costs.position(target) || !origin.roomName || !target.roomName) return failure('INVALID_ENDPOINT');
  if (!game || !Number.isFinite(game.time) || !memory || !pf || typeof pf.search !== 'function') return failure('API_UNAVAILABLE');
  const now = game.time;
  const movement = costs.profile(options.movement);
  const range = Math.floor(Number.isFinite(goal.range) ? Math.max(0, goal.range) : 1);
  const maxRooms = Math.max(1, Math.min(16, Math.floor(options.maxRooms || 8)));
  const maxOps = Math.max(1, Math.min(5000, Math.floor(options.maxOps || 200)));
  const cache = root(memory);
  trim(cache, now);
  const sourceRoom = origin.roomName;
  const targetRoom = target.roomName;
  if (!roomSafety(targetRoom, options, game).allowed && targetRoom !== sourceRoom) return failure('UNSAFE_TARGET');
  const policyKey = JSON.stringify([movement, options.allowUnknown === true, options.avoidHostileRooms !== false,
    options.intelMaxAge || 1500, options.policyVersion || 1, maxRooms]);
  const graphKey = JSON.stringify([sourceRoom, targetRoom, policyKey]);
  let graph = cache.graphs[graphKey];
  if (graph && !graph.rooms.every(name => name === sourceRoom || roomSafety(name, options, game).allowed)) {
    delete cache.graphs[graphKey]; graph = null;
  }
  // Safety-only lookup is cheap; all actual graph/path searches require budget.
  const enoughCpu = () => {
    if (options.lowCpu) return false;
    if (!Number.isFinite(options.cpuCeiling)) return true;
    return game.cpu && typeof game.cpu.getUsed === 'function' && game.cpu.getUsed() < options.cpuCeiling;
  };
  if (!graph) {
    if (!enoughCpu()) return failure('CPU_BUDGET');
    let rooms = [sourceRoom];
    if (sourceRoom !== targetRoom) {
      if (!game.map || typeof game.map.findRoute !== 'function') return failure('MAP_API_UNAVAILABLE');
      let route;
      try {
        route = game.map.findRoute(sourceRoom, targetRoom, { routeCallback(name) {
          const safety = roomSafety(name, options, game);
          return name === sourceRoom || safety.allowed ? 1 + (1 - safety.confidence) * 4 : Infinity;
        } });
      } catch (err) { return failure('MAP_ERROR'); }
      if (!Array.isArray(route) || !route.length) return failure('NO_ROOM_ROUTE');
      rooms = rooms.concat(route.map(item => item.room));
      if (rooms[rooms.length - 1] !== targetRoom) return failure('INVALID_ROOM_ROUTE');
    }
    if (rooms.length > maxRooms) return failure('ROOM_LIMIT');
    if (!rooms.every(name => name === sourceRoom || roomSafety(name, options, game).allowed)) return failure('UNSAFE_ROUTE');
    graph = { rooms, createdTick: now, expiresTick: now + 100, lastUsedTick: now };
    cache.graphs[graphKey] = graph;
  }
  graph.lastUsedTick = now;
  const fields = {};
  const revisions = [];
  for (const name of graph.rooms) {
    const room = game.rooms && game.rooms[name];
    const snapshot = context.snapshots && context.snapshots[name] || costs.visible(room, game);
    if (snapshot) {
      if (!enoughCpu()) return failure('CPU_BUDGET');
      const field = costs.field(snapshot, movement, pf);
      if (!field) return failure('COST_FIELD_UNAVAILABLE');
      fields[name] = field.matrix;
      revisions.push(field.revision);
    } else {
      revisions.push(JSON.stringify([name, options.policyVersion || 1, 'UNSEEN']));
    }
  }
  const key = JSON.stringify([origin.roomName, origin.x, origin.y, target.roomName, target.x, target.y, range, policyKey]);
  const revision = JSON.stringify(revisions);
  let entry = cache.paths[key];
  if (entry && (entry.revision !== revision || entry.graphKey !== graphKey)) {
    delete cache.paths[key]; cache.invalidations++; entry = null;
  }
  if (entry) {
    const path = unpack(entry.packed);
    if (path && validPath(path, origin, target, range, graph.rooms, fields)) {
      entry.lastUsedTick = now; cache.hits++;
      return { schemaVersion: SCHEMA_VERSION, authority: 'SHADOW', complete: true, reason: 'CACHE_HIT',
        key, path, cost: entry.cost, ops: 0,
        confidence: Math.min(...graph.rooms.map(name => roomSafety(name, options, game).confidence)), cacheHit: true };
    }
    delete cache.paths[key];
  }
  if (!enoughCpu()) return failure('CPU_BUDGET');
  cache.misses++;
  const allowed = new Set(graph.rooms);
  let result;
  try {
    result = pf.search(origin, { pos: target, range }, { maxOps, maxRooms, plainCost: movement.plain,
      swampCost: movement.swamp, roomCallback(name) { return allowed.has(name) ? fields[name] : false; } });
  } catch (err) { return failure('PATHFINDER_ERROR'); }
  if (!result || result.incomplete || !Array.isArray(result.path)) {
    return failure('INCOMPLETE', { ops: result && result.ops || 0 });
  }
  const path = result.path.map(p => ({ x: p.x, y: p.y, roomName: p.roomName }));
  if (!validPath(path, origin, target, range, graph.rooms, fields)) {
    return failure('INVALID_PATH');
  }
  const confidence = Math.min(...graph.rooms.map(name => roomSafety(name, options, game).confidence));
  const ttl = Math.max(1, Math.min(1000, Math.floor(options.ttl || 100)));
  cache.paths[key] = { graphKey, revision, rooms: graph.rooms.slice(), packed: pack(path),
    cost: result.cost, confidence, createdTick: now, expiresTick: now + ttl, lastUsedTick: now };
  trim(cache, now);
  return { schemaVersion: SCHEMA_VERSION, authority: 'SHADOW', complete: true, reason: 'SEARCHED',
    key, path, cost: result.cost, ops: result.ops || 0, confidence, cacheHit: false };
}

function summary(memory) {
  const cache = root(memory);
  return { schemaVersion: SCHEMA_VERSION, authority: 'SHADOW', paths: Object.keys(cache.paths).length,
    graphs: Object.keys(cache.graphs).length, hits: cache.hits, misses: cache.misses, invalidations: cache.invalidations };
}

module.exports = { SCHEMA_VERSION, search, summary, feedback, invalidateRoom, pack, unpack, roomSafety,
  _test: { root, trim, MAX_ENTRIES, MAX_BYTES } };
