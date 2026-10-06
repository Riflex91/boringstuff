'use strict';

// Shared P0 input is a room snapshot, never a role's target-selection policy.
const SCHEMA_VERSION = 1;
const MAX_CACHE = 12;
const matrices = new Map();
const DEFAULT_OBSTACLES = ['spawn', 'extension', 'link', 'constructedWall', 'storage',
  'tower', 'observer', 'powerSpawn', 'powerBank', 'lab', 'terminal', 'nuker', 'factory',
  'invaderCore', 'keeperLair'];

function position(value) {
  const p = value && (value.pos || value);
  return p && Number.isInteger(p.x) && p.x >= 0 && p.x < 50 &&
    Number.isInteger(p.y) && p.y >= 0 && p.y < 50 ? p : null;
}

function bounded(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function profile(input) {
  input = input || {};
  return {
    id: String(input.id || 'civilian'),
    road: Math.ceil(bounded(input.road, 1, 1, 254)),
    plain: Math.ceil(bounded(input.plain, 2, 1, 254)),
    swamp: Math.ceil(bounded(input.swamp, 10, 1, 254)),
    stationary: Math.ceil(bounded(input.stationary, 10, 0, 254)),
    congestion: Math.ceil(bounded(input.congestion, 5, 0, 254)),
    avoidHostiles: input.avoidHostiles !== false,
    avoidKeepers: input.avoidKeepers !== false,
    plannedRoads: input.plannedRoads === true,
    plannedStructures: input.plannedStructures === true
  };
}

function obstacle(item) {
  if (item.structureType === 'rampart') return !(item.my || item.isPublic);
  const types = typeof OBSTACLE_OBJECT_TYPES !== 'undefined' ? OBSTACLE_OBJECT_TYPES : DEFAULT_OBSTACLES;
  return types.indexOf(item.structureType || item.type) >= 0;
}

function stamp(items, mapper) {
  return (items || []).map(item => {
    const p = position(item);
    return p ? [p.x, p.y].concat(mapper ? mapper(item) : []) : null;
  }).filter(Boolean).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function dangerRanges(actor) {
  const body = actor.body || [];
  const active = type => body.some(part => part.type === type && part.hits !== 0);
  // Unknown bodies are unsafe; an observed MOVE-only scout is not a weapon.
  if (!Array.isArray(actor.body)) return [4];
  if (active('ranged_attack')) return [4];
  if (active('attack') || active('work')) return [2];
  return [];
}

function signature(snapshot, movement) {
  return JSON.stringify([
    SCHEMA_VERSION, snapshot.roomName, snapshot.terrainVersion || 0, profile(movement),
    stamp(snapshot.structures, s => [s.structureType, !!s.my, !!s.isPublic]),
    stamp(snapshot.sources), stamp(snapshot.minerals), stamp(snapshot.controller ? [snapshot.controller] : []),
    stamp(snapshot.sites, s => [s.structureType, !!s.my]),
    stamp(snapshot.planned, s => [s.type || s.structureType]),
    stamp(snapshot.stationary), stamp(snapshot.congestion, c => [c.weight || 1]),
    stamp(snapshot.hostiles, h => dangerRanges(h)), stamp(snapshot.keepers)
  ]);
}

function build(snapshot, movement, pathFinder) {
  const pf = pathFinder || (typeof PathFinder !== 'undefined' ? PathFinder : null);
  if (!pf || typeof pf.CostMatrix !== 'function' || !snapshot || !snapshot.terrain ||
      typeof snapshot.terrain.get !== 'function') return null;
  const m = profile(movement);
  const matrix = new pf.CostMatrix();
  const wall = typeof TERRAIN_MASK_WALL !== 'undefined' ? TERRAIN_MASK_WALL : 1;
  const swamp = typeof TERRAIN_MASK_SWAMP !== 'undefined' ? TERRAIN_MASK_SWAMP : 2;
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 50; x++) {
      const terrain = snapshot.terrain.get(x, y);
      matrix.set(x, y, terrain & wall ? 255 : (terrain & swamp ? m.swamp : m.plain));
    }
  }
  const block = item => { const p = position(item); if (p) matrix.set(p.x, p.y, 255); };
  const road = item => {
    const p = position(item);
    if (p && matrix.get(p.x, p.y) < 255) matrix.set(p.x, p.y, m.road);
  };
  // Roads are applied first: a road under an obstacle must never reopen it.
  for (const item of snapshot.structures || []) if (item.structureType === 'road') road(item);
  if (m.plannedRoads) for (const item of snapshot.planned || []) if (item.type === 'road') road(item);
  for (const item of snapshot.structures || []) if (obstacle(item)) block(item);
  for (const item of snapshot.sites || []) if (item.my && obstacle(item)) block(item);
  if (m.plannedStructures) for (const item of snapshot.planned || []) if (obstacle(item)) block(item);
  for (const item of (snapshot.sources || []).concat(snapshot.minerals || [])) block(item);
  if (snapshot.controller) block(snapshot.controller);
  const increase = (item, amount) => {
    const p = position(item);
    if (p && matrix.get(p.x, p.y) < 255) matrix.set(p.x, p.y, Math.min(254, matrix.get(p.x, p.y) + amount));
  };
  for (const item of snapshot.stationary || []) increase(item, m.stationary);
  for (const item of snapshot.congestion || []) increase(item, m.congestion * bounded(item.weight, 1, 0, 20));
  const zone = (item, radius) => {
    const p = position(item);
    if (!p) return;
    for (let y = Math.max(0, p.y - radius); y <= Math.min(49, p.y + radius); y++) {
      for (let x = Math.max(0, p.x - radius); x <= Math.min(49, p.x + radius); x++) matrix.set(x, y, 255);
    }
  };
  if (m.avoidHostiles) for (const actor of snapshot.hostiles || []) {
    for (const radius of dangerRanges(actor)) zone(actor, radius);
  }
  if (m.avoidKeepers) for (const keeper of snapshot.keepers || []) zone(keeper, 5);
  return matrix;
}

function field(snapshot, movement, pathFinder) {
  if (!snapshot) return null;
  const key = signature(snapshot, movement);
  let matrix = matrices.get(key);
  if (!matrix) {
    matrix = build(snapshot, movement, pathFinder);
    if (!matrix) return null;
    matrices.set(key, matrix);
    while (matrices.size > MAX_CACHE) matrices.delete(matrices.keys().next().value);
  }
  // Consumers may overlay local occupancy without corrupting other callers.
  return { matrix: matrix.clone(), revision: key };
}

function visible(room, game) {
  if (!room) return null;
  const find = constant => typeof constant === 'number' || typeof constant === 'string'
    ? (typeof room.find === 'function' ? room.find(constant) || [] : []) : [];
  const structures = find(typeof FIND_STRUCTURES !== 'undefined' ? FIND_STRUCTURES : null);
  let terrain = typeof room.getTerrain === 'function' ? room.getTerrain() : null;
  if (!terrain && game && game.map && typeof game.map.getRoomTerrain === 'function') terrain = game.map.getRoomTerrain(room.name);
  return {
    roomName: room.name, terrain, structures,
    sites: find(typeof FIND_MY_CONSTRUCTION_SITES !== 'undefined' ? FIND_MY_CONSTRUCTION_SITES : null),
    sources: find(typeof FIND_SOURCES !== 'undefined' ? FIND_SOURCES : null),
    minerals: find(typeof FIND_MINERALS !== 'undefined' ? FIND_MINERALS : null),
    controller: room.controller || null,
    hostiles: find(typeof FIND_HOSTILE_CREEPS !== 'undefined' ? FIND_HOSTILE_CREEPS : null),
    keepers: structures.filter(s => s.structureType === 'keeperLair')
  };
}

module.exports = { SCHEMA_VERSION, profile, position, signature, build, field, visible,
  clear: () => matrices.clear() };
