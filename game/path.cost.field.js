'use strict';

const SCHEMA_VERSION = 1;
const ROOM_SIZE = 50;

const DEFAULT_PROFILE = Object.freeze({
  plainCost: 2,
  swampCost: 10,
  roadCost: 1,
  creepCost: 10,
  stationaryCost: 20,
  congestionCost: 8,
  hostileCost: 50,
  hostileRange: 3,
  keeperCost: 40,
  keeperRange: 4,
  obstacleCost: 255
});

function finiteInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeProfile(profile) {
  const p = profile || {};
  return {
    plainCost: finiteInt(p.plainCost, DEFAULT_PROFILE.plainCost, 1, 254),
    swampCost: finiteInt(p.swampCost, DEFAULT_PROFILE.swampCost, 1, 254),
    roadCost: finiteInt(p.roadCost, DEFAULT_PROFILE.roadCost, 1, 254),
    creepCost: finiteInt(p.creepCost, DEFAULT_PROFILE.creepCost, 1, 254),
    stationaryCost: finiteInt(p.stationaryCost, DEFAULT_PROFILE.stationaryCost, 1, 254),
    congestionCost: finiteInt(p.congestionCost, DEFAULT_PROFILE.congestionCost, 1, 254),
    hostileCost: finiteInt(p.hostileCost, DEFAULT_PROFILE.hostileCost, 1, 254),
    hostileRange: finiteInt(p.hostileRange, DEFAULT_PROFILE.hostileRange, 0, 10),
    keeperCost: finiteInt(p.keeperCost, DEFAULT_PROFILE.keeperCost, 1, 254),
    keeperRange: finiteInt(p.keeperRange, DEFAULT_PROFILE.keeperRange, 0, 10),
    obstacleCost: 255
  };
}

function typeName(name, fallback) {
  return typeof global !== 'undefined' && global[name] !== undefined ? global[name] : fallback;
}

function positionOf(value) {
  if (!value) return null;
  const p = value.pos || value;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return {
    x: Math.round(p.x),
    y: Math.round(p.y),
    roomName: p.roomName || null
  };
}

function sameRoom(pos, room) {
  return !pos.roomName || !room || !room.name || pos.roomName === room.name;
}

function validXY(pos) {
  return pos && pos.x >= 0 && pos.x < ROOM_SIZE && pos.y >= 0 && pos.y < ROOM_SIZE;
}

function getCost(matrix, x, y) {
  return matrix && typeof matrix.get === 'function' ? matrix.get(x, y) : 0;
}

function setMax(matrix, pos, cost) {
  if (!matrix || !validXY(pos)) return;
  const current = getCost(matrix, pos.x, pos.y);
  if (current === 255) return;
  matrix.set(pos.x, pos.y, Math.max(current || 0, cost));
}

function setMinWalkable(matrix, pos, cost) {
  if (!matrix || !validXY(pos)) return;
  const current = getCost(matrix, pos.x, pos.y);
  if (current === 255) return;
  matrix.set(pos.x, pos.y, current > 0 ? Math.min(current, cost) : cost);
}

function obstacleTypes() {
  if (typeof OBSTACLE_OBJECT_TYPES !== 'undefined' && Array.isArray(OBSTACLE_OBJECT_TYPES)) {
    return OBSTACLE_OBJECT_TYPES;
  }
  return null;
}

function structureWalkability(structure) {
  if (!structure) return 'passable';
  const type = structure.structureType;
  const road = typeName('STRUCTURE_ROAD', 'road');
  const container = typeName('STRUCTURE_CONTAINER', 'container');
  const rampart = typeName('STRUCTURE_RAMPART', 'rampart');
  const extractor = typeName('STRUCTURE_EXTRACTOR', 'extractor');

  if (type === road) return 'road';
  if (type === container || type === extractor) return 'passable';
  if (type === rampart) return structure.my || structure.isPublic ? 'passable' : 'blocked';

  const obstacles = obstacleTypes();
  if (obstacles) return obstacles.indexOf(type) >= 0 ? 'blocked' : 'passable';

  // Conservative fallback for private servers that do not expose
  // OBSTACLE_OBJECT_TYPES: unknown built structures are treated as blockers.
  return type ? 'blocked' : 'passable';
}

function roomFind(room, findConstant, fallback) {
  if (Array.isArray(fallback)) return fallback;
  if (!room || typeof room.find !== 'function' || findConstant === null) return [];
  try {
    const result = room.find(findConstant);
    return Array.isArray(result) ? result : [];
  } catch (err) {
    return [];
  }
}

function applyStructures(matrix, room, structures, profile) {
  for (const structure of structures || []) {
    const pos = positionOf(structure);
    if (!validXY(pos) || !sameRoom(pos, room)) continue;
    const kind = structureWalkability(structure);
    if (kind === 'road') setMinWalkable(matrix, pos, profile.roadCost);
    else if (kind === 'blocked') matrix.set(pos.x, pos.y, profile.obstacleCost);
  }
}

function applyPositions(matrix, room, values, cost, mode) {
  for (const value of values || []) {
    const pos = positionOf(value);
    if (!validXY(pos) || !sameRoom(pos, room)) continue;
    if (mode === 'min') setMinWalkable(matrix, pos, cost);
    else if (mode === 'block') matrix.set(pos.x, pos.y, 255);
    else setMax(matrix, pos, cost);
  }
}

function applyCongestion(matrix, room, values, profile) {
  for (const value of values || []) {
    const pos = positionOf(value);
    if (!validXY(pos) || !sameRoom(pos, room)) continue;
    const cost = finiteInt(value && value.cost, profile.congestionCost, 1, 254);
    setMax(matrix, pos, cost);
  }
}

function applyRangePenalty(matrix, room, centers, range, cost) {
  for (const center of centers || []) {
    const pos = positionOf(center);
    if (!validXY(pos) || !sameRoom(pos, room)) continue;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const x = pos.x + dx;
        const y = pos.y + dy;
        if (x < 0 || x >= ROOM_SIZE || y < 0 || y >= ROOM_SIZE) continue;
        setMax(matrix, { x, y }, cost);
      }
    }
  }
}

function matrixConstructor(options) {
  if (options && options.CostMatrix) return options.CostMatrix;
  if (typeof PathFinder !== 'undefined' && PathFinder && PathFinder.CostMatrix) return PathFinder.CostMatrix;
  return null;
}

function buildRoomCostMatrix(room, options) {
  const opts = options || {};
  const profile = normalizeProfile(opts.profile);
  const CostMatrix = matrixConstructor(opts);
  if (!CostMatrix) throw new Error('PathFinder.CostMatrix is unavailable');

  const matrix = new CostMatrix();
  const findStructures = typeof FIND_STRUCTURES !== 'undefined' ? FIND_STRUCTURES : null;
  const findCreeps = typeof FIND_CREEPS !== 'undefined'
    ? FIND_CREEPS
    : (typeof FIND_MY_CREEPS !== 'undefined' ? FIND_MY_CREEPS : null);

  const structures = roomFind(room, findStructures, opts.structures);
  applyStructures(matrix, room, structures, profile);

  // Future planner overlays. Planned roads lower traversal cost; planned
  // structures reserve tiles before construction actually blocks them.
  applyPositions(matrix, room, opts.plannedRoads, profile.roadCost, 'min');
  applyPositions(matrix, room, opts.plannedStructures, profile.obstacleCost, 'block');

  // Operational overlays. Stationary work positions and congestion are soft
  // penalties, while threat zones are stronger but still traversable.
  applyPositions(matrix, room, opts.stationaryTiles, profile.stationaryCost, 'max');
  applyCongestion(matrix, room, opts.congestion, profile);

  if (opts.includeCreeps) {
    const creeps = roomFind(room, findCreeps, opts.creeps);
    applyPositions(matrix, room, creeps, profile.creepCost, 'max');
  }

  applyRangePenalty(matrix, room, opts.hostiles, profile.hostileRange, profile.hostileCost);
  applyRangePenalty(matrix, room, opts.keepers, profile.keeperRange, profile.keeperCost);

  return matrix;
}

function pathfinderOptions(profile, roomCallback) {
  const p = normalizeProfile(profile);
  const result = {
    plainCost: p.plainCost,
    swampCost: p.swampCost
  };
  if (typeof roomCallback === 'function') result.roomCallback = roomCallback;
  return result;
}

function describe(profile) {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: normalizeProfile(profile)
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_PROFILE,
  normalizeProfile,
  buildRoomCostMatrix,
  pathfinderOptions,
  describe,
  _test: {
    positionOf,
    structureWalkability,
    applyRangePenalty
  }
};
