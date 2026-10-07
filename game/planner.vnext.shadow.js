'use strict';

const pathCache = require('path.route.cache');

const SCHEMA_VERSION = 1;
const AUTHORITY = 'SHADOW';
const DEFAULT_MAX_ANCHORS = 6;
const DEFAULT_PATH_SEARCH_BUDGET = 24;
const DEFAULT_MEMORY_RETENTION = 5000;

const VARIANTS = Object.freeze([
  {
    id: 'CORE_COMPACT',
    structures: [
      { type: 'spawn', dx: 0, dy: -2, earliestCapability: 'SPAWN_AVAILABLE', critical: true },
      { type: 'storage', dx: 0, dy: 0, earliestCapability: 'STORAGE_AVAILABLE', critical: true },
      { type: 'terminal', dx: 1, dy: 0, earliestCapability: 'TERMINAL_AVAILABLE', critical: true },
      { type: 'link', dx: -1, dy: 0, earliestCapability: 'LINK_AVAILABLE', critical: true },
      { type: 'factory', dx: 0, dy: 1, earliestCapability: 'FACTORY_AVAILABLE', critical: false },
      { type: 'powerSpawn', dx: 1, dy: 1, earliestCapability: 'POWER_SPAWN_AVAILABLE', critical: false },
      { type: 'observer', dx: -1, dy: 1, earliestCapability: 'OBSERVER_AVAILABLE', critical: false },
      { type: 'nuker', dx: 0, dy: 2, earliestCapability: 'NUKER_AVAILABLE', critical: false },
      { type: 'tower', dx: -2, dy: -1, earliestCapability: 'TOWER_AVAILABLE', critical: true },
      { type: 'tower', dx: 2, dy: -1, earliestCapability: 'TOWER_AVAILABLE', critical: true },
      { type: 'tower', dx: -2, dy: 1, earliestCapability: 'TOWER_AVAILABLE', critical: true },
      { type: 'tower', dx: 2, dy: 1, earliestCapability: 'TOWER_AVAILABLE', critical: true },
      { type: 'lab', dx: -2, dy: 2, earliestCapability: 'LAB_AVAILABLE', critical: false },
      { type: 'lab', dx: -1, dy: 2, earliestCapability: 'LAB_AVAILABLE', critical: false },
      { type: 'lab', dx: 1, dy: 2, earliestCapability: 'LAB_AVAILABLE', critical: false },
      { type: 'lab', dx: 2, dy: 2, earliestCapability: 'LAB_AVAILABLE', critical: false }
    ],
    extensionRings: [3, 4]
  },
  {
    id: 'CORE_BALANCED',
    structures: [
      { type: 'spawn', dx: 0, dy: -3, earliestCapability: 'SPAWN_AVAILABLE', critical: true },
      { type: 'storage', dx: 0, dy: 0, earliestCapability: 'STORAGE_AVAILABLE', critical: true },
      { type: 'terminal', dx: 2, dy: 0, earliestCapability: 'TERMINAL_AVAILABLE', critical: true },
      { type: 'link', dx: -2, dy: 0, earliestCapability: 'LINK_AVAILABLE', critical: true },
      { type: 'factory', dx: 0, dy: 2, earliestCapability: 'FACTORY_AVAILABLE', critical: false },
      { type: 'powerSpawn', dx: 2, dy: 2, earliestCapability: 'POWER_SPAWN_AVAILABLE', critical: false },
      { type: 'observer', dx: -2, dy: 2, earliestCapability: 'OBSERVER_AVAILABLE', critical: false },
      { type: 'nuker', dx: 0, dy: 3, earliestCapability: 'NUKER_AVAILABLE', critical: false },
      { type: 'tower', dx: -3, dy: -1, earliestCapability: 'TOWER_AVAILABLE', critical: true },
      { type: 'tower', dx: 3, dy: -1, earliestCapability: 'TOWER_AVAILABLE', critical: true },
      { type: 'tower', dx: -3, dy: 1, earliestCapability: 'TOWER_AVAILABLE', critical: true },
      { type: 'tower', dx: 3, dy: 1, earliestCapability: 'TOWER_AVAILABLE', critical: true },
      { type: 'lab', dx: -2, dy: 3, earliestCapability: 'LAB_AVAILABLE', critical: false },
      { type: 'lab', dx: -1, dy: 3, earliestCapability: 'LAB_AVAILABLE', critical: false },
      { type: 'lab', dx: 1, dy: 3, earliestCapability: 'LAB_AVAILABLE', critical: false },
      { type: 'lab', dx: 2, dy: 3, earliestCapability: 'LAB_AVAILABLE', critical: false }
    ],
    extensionRings: [4, 5]
  }
]);

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, rooms: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.plannerVNextShadow || memoryRoot.bot.plannerVNextShadow.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.plannerVNextShadow = { schemaVersion: SCHEMA_VERSION, rooms: {} };
  }
  if (!memoryRoot.bot.plannerVNextShadow.rooms) memoryRoot.bot.plannerVNextShadow.rooms = {};
  return memoryRoot.bot.plannerVNextShadow;
}

function posOf(value, roomName) {
  const p = value && (value.pos || value);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return {
    x: Math.round(p.x),
    y: Math.round(p.y),
    roomName: p.roomName || roomName || null
  };
}

function positionKey(pos) {
  return pos ? pos.x + ',' + pos.y : '';
}

function chebyshev(a, b) {
  if (!a || !b) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function midpoint(a, b, roomName) {
  if (!a || !b) return null;
  return {
    x: Math.round((a.x + b.x) / 2),
    y: Math.round((a.y + b.y) / 2),
    roomName: roomName || a.roomName || b.roomName || null
  };
}

function centroid(points, roomName) {
  const valid = (points || []).filter(Boolean);
  if (!valid.length) return null;
  return {
    x: Math.round(valid.reduce((sum, p) => sum + p.x, 0) / valid.length),
    y: Math.round(valid.reduce((sum, p) => sum + p.y, 0) / valid.length),
    roomName: roomName || valid[0].roomName || null
  };
}

function roomTerrain(room) {
  if (!room) return null;
  if (typeof room.getTerrain === 'function') return room.getTerrain();
  return room.terrain || null;
}

function terrainAt(room, x, y) {
  const terrain = roomTerrain(room);
  if (!terrain || typeof terrain.get !== 'function') return 0;
  try { return terrain.get(x, y); } catch (err) { return 1; }
}

function wallMask() {
  return typeof TERRAIN_MASK_WALL !== 'undefined' ? TERRAIN_MASK_WALL : 1;
}

function swampMask() {
  return typeof TERRAIN_MASK_SWAMP !== 'undefined' ? TERRAIN_MASK_SWAMP : 2;
}

function isWall(room, x, y) {
  return (terrainAt(room, x, y) & wallMask()) !== 0;
}

function withinRoom(x, y, margin) {
  const m = Number.isFinite(margin) ? Math.max(0, Math.round(margin)) : 1;
  return x >= m && y >= m && x <= 49 - m && y <= 49 - m;
}

function mineralOfState(state) {
  if (state && state.mineral) return state.mineral;
  const room = state && state.room;
  const findMinerals = typeof FIND_MINERALS !== 'undefined' ? FIND_MINERALS : null;
  if (!room || findMinerals === null || typeof room.find !== 'function') return null;
  try {
    const minerals = room.find(findMinerals) || [];
    return minerals[0] || null;
  } catch (err) {
    return null;
  }
}

function fixedObjectPositions(state) {
  const positions = [];
  for (const source of state && state.sources || []) {
    const p = posOf(source, state.room && state.room.name);
    if (p) positions.push({ type: 'source', pos: p, minRange: 2 });
  }
  const controller = posOf(state && state.room && state.room.controller, state && state.room && state.room.name);
  if (controller) positions.push({ type: 'controller', pos: controller, minRange: 3 });
  const mineral = posOf(mineralOfState(state), state && state.room && state.room.name);
  if (mineral) positions.push({ type: 'mineral', pos: mineral, minRange: 2 });
  return positions;
}

function anchorAllowed(state, pos, margin) {
  if (!pos || !state || !state.room) return false;
  if (!withinRoom(pos.x, pos.y, margin)) return false;
  if (isWall(state.room, pos.x, pos.y)) return false;
  for (const fixed of fixedObjectPositions(state)) {
    if (chebyshev(pos, fixed.pos) < fixed.minRange) return false;
  }
  return true;
}

function opennessScore(room, anchor, radius) {
  const r = Number.isFinite(radius) ? Math.max(1, Math.round(radius)) : 5;
  let available = 0;
  let total = 0;
  let swamp = 0;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (!withinRoom(x, y, 1)) continue;
      total += 1;
      const terrain = terrainAt(room, x, y);
      if ((terrain & wallMask()) !== 0) continue;
      available += 1;
      if ((terrain & swampMask()) !== 0) swamp += 1;
    }
  }
  if (!total) return 0;
  const openRatio = available / total;
  const swampPenalty = available ? swamp / available : 1;
  return Math.max(0, Math.min(100, Math.round((openRatio * 100) - swampPenalty * 15)));
}

function seedPositions(state) {
  const roomName = state && state.room && state.room.name;
  const spawn = posOf(state && state.spawn, roomName);
  const controller = posOf(state && state.room && state.room.controller, roomName);
  const sources = (state && state.sources || []).map(source => posOf(source, roomName)).filter(Boolean);
  const mineral = posOf(mineralOfState(state), roomName);
  const points = [spawn, controller, mineral, ...sources].filter(Boolean);
  const center = centroid(points, roomName);
  const seeds = [];

  if (spawn) seeds.push({ source: 'SPAWN', pos: spawn });
  if (center) seeds.push({ source: 'ECONOMIC_CENTROID', pos: center });
  if (spawn && controller) seeds.push({ source: 'SPAWN_CONTROLLER_MIDPOINT', pos: midpoint(spawn, controller, roomName) });
  for (let i = 0; i < sources.length; i++) {
    if (spawn) seeds.push({ source: 'SPAWN_SOURCE_MIDPOINT_' + i, pos: midpoint(spawn, sources[i], roomName) });
    if (controller) seeds.push({ source: 'CONTROLLER_SOURCE_MIDPOINT_' + i, pos: midpoint(controller, sources[i], roomName) });
  }
  if (spawn && mineral) seeds.push({ source: 'SPAWN_MINERAL_MIDPOINT', pos: midpoint(spawn, mineral, roomName) });

  if (center) {
    const offsets = [
      [4, 0], [-4, 0], [0, 4], [0, -4],
      [3, 3], [3, -3], [-3, 3], [-3, -3]
    ];
    for (let i = 0; i < offsets.length; i++) {
      seeds.push({
        source: 'CENTROID_OFFSET_' + i,
        pos: { x: center.x + offsets[i][0], y: center.y + offsets[i][1], roomName }
      });
    }
  }

  return seeds;
}

function candidateAnchors(state, options) {
  const opts = options || {};
  const maxAnchors = Number.isFinite(opts.maxAnchors)
    ? Math.max(1, Math.round(opts.maxAnchors))
    : DEFAULT_MAX_ANCHORS;
  const margin = Number.isFinite(opts.anchorMargin) ? Math.max(3, Math.round(opts.anchorMargin)) : 5;
  const seen = new Set();
  const candidates = [];

  for (const seed of seedPositions(state)) {
    if (!seed.pos || !anchorAllowed(state, seed.pos, margin)) continue;
    const key = positionKey(seed.pos);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      x: seed.pos.x,
      y: seed.pos.y,
      roomName: seed.pos.roomName,
      source: seed.source,
      openness: opennessScore(state.room, seed.pos, 5)
    });
  }

  candidates.sort((a, b) =>
    b.openness - a.openness ||
    a.x - b.x ||
    a.y - b.y ||
    a.source.localeCompare(b.source)
  );
  return candidates.slice(0, maxAnchors);
}

function extensionOffsets(rings) {
  const out = [];
  const seen = new Set();
  for (const radius of rings || []) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if ((Math.abs(dx) + Math.abs(dy)) % 2 === 0) continue;
        const key = dx + ',' + dy;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ dx, dy });
      }
    }
  }
  return out.slice(0, 40);
}

function plannedSlots(anchor, variant) {
  const slots = [];
  for (const item of variant.structures || []) {
    slots.push({
      type: item.type,
      x: anchor.x + item.dx,
      y: anchor.y + item.dy,
      roomName: anchor.roomName,
      earliestCapability: item.earliestCapability,
      critical: !!item.critical
    });
  }
  for (const offset of extensionOffsets(variant.extensionRings)) {
    slots.push({
      type: 'extension',
      x: anchor.x + offset.dx,
      y: anchor.y + offset.dy,
      roomName: anchor.roomName,
      earliestCapability: 'EXTENSION_AVAILABLE',
      critical: false
    });
  }
  return slots;
}

function blockingStructureAt(state, slot) {
  for (const structure of state && state.structures || []) {
    const p = posOf(structure, slot.roomName);
    if (!p || p.x !== slot.x || p.y !== slot.y) continue;
    const type = String(structure.structureType || '');
    if (type === 'road' || type === 'rampart') continue;
    if (type === slot.type) return null;
    return type || 'structure';
  }
  return null;
}

function slotFeasibility(state, slots) {
  let valid = 0;
  let extensionValid = 0;
  let extensionTotal = 0;
  let criticalBlocked = 0;
  const blocked = [];

  for (const slot of slots || []) {
    const isExtension = slot.type === 'extension';
    if (isExtension) extensionTotal += 1;

    let reason = null;
    if (!withinRoom(slot.x, slot.y, 1)) reason = 'BORDER';
    else if (isWall(state.room, slot.x, slot.y)) reason = 'WALL';
    else {
      for (const fixed of fixedObjectPositions(state)) {
        if (slot.x === fixed.pos.x && slot.y === fixed.pos.y) {
          reason = fixed.type.toUpperCase();
          break;
        }
      }
    }
    if (!reason) {
      const blocker = blockingStructureAt(state, slot);
      if (blocker) reason = 'STRUCTURE:' + blocker;
    }

    if (reason) {
      blocked.push({ type: slot.type, x: slot.x, y: slot.y, reason, critical: slot.critical });
      if (slot.critical) criticalBlocked += 1;
      continue;
    }

    valid += 1;
    if (isExtension) extensionValid += 1;
  }

  return {
    valid,
    total: slots.length,
    ratio: slots.length ? valid / slots.length : 0,
    extensionValid,
    extensionTotal,
    extensionRatio: extensionTotal ? extensionValid / extensionTotal : 0,
    criticalBlocked,
    blocked: blocked.slice(0, 12)
  };
}

function normalizePathCost(result, fallback) {
  if (Number.isFinite(result)) return Math.max(0, result);
  if (result && result.ok && Number.isFinite(result.cost)) return Math.max(0, result.cost);
  return Math.max(0, fallback);
}

function fallbackRouteCost(from, to) {
  return chebyshev(from, to) * 2;
}

function makeRouteCostProvider(state, options, memoryRoot, game) {
  const opts = options || {};
  if (typeof opts.routeCostProvider === 'function') return opts.routeCostProvider;
  return function(from, to, meta) {
    if (!from || !to) return { ok: false, cost: null, reason: 'INVALID_POSITION' };
    return pathCache.getInRoomPath(from, to, {
      room: state.room,
      time: game && Number.isFinite(game.time) ? game.time : undefined,
      range: meta && Number.isFinite(meta.range) ? meta.range : 1,
      maxOps: meta && Number.isFinite(meta.maxOps) ? meta.maxOps : 800,
      variant: 'planner-vnext:' + String(meta && meta.kind || 'route'),
      profile: {
        plainCost: 2,
        swampCost: 5,
        roadCost: 1,
        creepCost: 5,
        stationaryCost: 8,
        congestionCost: 4,
        hostileCost: 40,
        hostileRange: 4,
        keeperCost: 30,
        keeperRange: 4
      },
      costFieldOptions: {
        includeCreeps: false
      }
    }, memoryRoot);
  };
}

function routeMetrics(state, anchor, options, memoryRoot, game) {
  const opts = options || {};
  const provider = makeRouteCostProvider(state, opts, memoryRoot, game);
  const budget = {
    remaining: Number.isFinite(opts.pathSearchBudget)
      ? Math.max(0, Math.round(opts.pathSearchBudget))
      : DEFAULT_PATH_SEARCH_BUDGET,
    attempted: 0,
    fallback: 0
  };
  const roomName = state.room && state.room.name;
  const goals = [];
  const controller = posOf(state.room && state.room.controller, roomName);
  if (controller) goals.push({ kind: 'controller', pos: controller, range: 3 });
  for (let i = 0; i < (state.sources || []).length; i++) {
    const p = posOf(state.sources[i], roomName);
    if (p) goals.push({ kind: 'source:' + i, pos: p, range: 1 });
  }
  const spawn = posOf(state.spawn, roomName);
  if (spawn) goals.push({ kind: 'spawn', pos: spawn, range: 1 });

  const results = [];
  for (const goal of goals) {
    const fallback = fallbackRouteCost(anchor, goal.pos);
    if (budget.remaining <= 0) {
      budget.fallback += 1;
      results.push({ kind: goal.kind, cost: fallback, exact: false, reason: 'PATH_BUDGET' });
      continue;
    }
    budget.remaining -= 1;
    budget.attempted += 1;
    let response = null;
    try {
      response = provider(anchor, goal.pos, { kind: goal.kind, range: goal.range, maxOps: 800 });
    } catch (err) {
      response = { ok: false, reason: 'PROVIDER_ERROR' };
    }
    const exact = !!(response && response.ok && Number.isFinite(response.cost) && !response.incomplete);
    if (!exact) budget.fallback += 1;
    results.push({
      kind: goal.kind,
      cost: normalizePathCost(response, fallback),
      exact,
      reason: exact ? null : (response && response.reason || (response && response.incomplete ? 'INCOMPLETE' : 'FALLBACK'))
    });
  }

  const sources = results.filter(item => item.kind.startsWith('source:'));
  const controllerResult = results.find(item => item.kind === 'controller') || null;
  const spawnResult = results.find(item => item.kind === 'spawn') || null;

  return {
    routes: results,
    sourceAverageCost: sources.length
      ? sources.reduce((sum, item) => sum + item.cost, 0) / sources.length
      : null,
    controllerCost: controllerResult ? controllerResult.cost : null,
    spawnCost: spawnResult ? spawnResult.cost : null,
    exactRouteCount: results.filter(item => item.exact).length,
    fallbackRouteCount: results.filter(item => !item.exact).length,
    pathSearches: budget.attempted
  };
}

function routeScore(cost, scale) {
  if (!Number.isFinite(cost)) return 50;
  return Math.max(0, Math.min(100, Math.round(100 - cost * (Number.isFinite(scale) ? scale : 2))));
}

function towerCoverageScore(slots, anchor, state) {
  const towers = (slots || []).filter(slot => slot.type === 'tower');
  if (!towers.length) return 0;
  const critical = (slots || []).filter(slot => slot.critical && slot.type !== 'tower');
  const controller = posOf(state.room && state.room.controller, anchor.roomName);
  if (controller) critical.push({ x: controller.x, y: controller.y });
  if (!critical.length) critical.push(anchor);

  let total = 0;
  let count = 0;
  for (const target of critical) {
    const best = Math.min(...towers.map(tower => chebyshev(tower, target)));
    total += Math.max(0, 100 - Math.max(0, best - 5) * 4);
    count += 1;
  }
  return count ? Math.round(total / count) : 0;
}

function evaluateVariant(state, anchor, variant, routes) {
  const slots = plannedSlots(anchor, variant);
  const feasibility = slotFeasibility(state, slots);
  const components = {
    openness: anchor.openness,
    sourceLogistics: routeScore(routes.sourceAverageCost, 2.4),
    upgradeLogistics: routeScore(routes.controllerCost, 2.2),
    legacySpawnContinuity: routeScore(routes.spawnCost, 1.5),
    extensionFeasibility: Math.round(feasibility.extensionRatio * 100),
    futureStructureFeasibility: Math.round(feasibility.ratio * 100),
    towerCoverage: towerCoverageScore(slots, anchor, state),
    traffic: routeScore(
      [
        routes.sourceAverageCost,
        routes.controllerCost,
        routes.spawnCost
      ].filter(Number.isFinite).reduce((sum, value, _, arr) => sum + value / arr.length, 0),
      1.8
    )
  };

  const weights = {
    openness: 0.14,
    sourceLogistics: 0.20,
    upgradeLogistics: 0.16,
    legacySpawnContinuity: 0.08,
    extensionFeasibility: 0.16,
    futureStructureFeasibility: 0.12,
    towerCoverage: 0.08,
    traffic: 0.06
  };

  let score = 0;
  for (const key of Object.keys(weights)) score += components[key] * weights[key];
  score -= feasibility.criticalBlocked * 25;
  score = Math.max(0, Math.min(100, Math.round(score * 100) / 100));

  return {
    anchor: { x: anchor.x, y: anchor.y, roomName: anchor.roomName, source: anchor.source },
    variant: variant.id,
    score,
    components,
    feasibility,
    routes,
    plannedStructures: slots,
    valid: feasibility.criticalBlocked === 0 && feasibility.extensionRatio >= 0.5
  };
}

function compactCandidate(candidate) {
  if (!candidate) return null;
  return {
    anchor: candidate.anchor,
    variant: candidate.variant,
    score: candidate.score,
    valid: candidate.valid,
    components: candidate.components,
    feasibility: {
      ratio: Math.round(candidate.feasibility.ratio * 1000) / 1000,
      extensionRatio: Math.round(candidate.feasibility.extensionRatio * 1000) / 1000,
      criticalBlocked: candidate.feasibility.criticalBlocked,
      blocked: candidate.feasibility.blocked
    },
    routes: {
      sourceAverageCost: candidate.routes.sourceAverageCost,
      controllerCost: candidate.routes.controllerCost,
      spawnCost: candidate.routes.spawnCost,
      exactRouteCount: candidate.routes.exactRouteCount,
      fallbackRouteCount: candidate.routes.fallbackRouteCount,
      pathSearches: candidate.routes.pathSearches
    }
  };
}

function evaluate(state, memoryRoot, game, options) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const opts = options || {};
  const roomName = state && state.room && state.room.name;
  const now = game && Number.isFinite(game.time) ? game.time : 0;

  if (!roomName || !state.room.controller || !state.room.controller.my) {
    return {
      schemaVersion: SCHEMA_VERSION,
      authority: AUTHORITY,
      status: 'UNAVAILABLE',
      roomName: roomName || null,
      planTick: now,
      reason: 'OWNED_ROOM_REQUIRED',
      selected: null,
      topCandidates: []
    };
  }

  const anchors = candidateAnchors(state, opts);
  const evaluated = [];
  let totalPathSearches = 0;
  for (const anchor of anchors) {
    const remainingBudget = Math.max(
      0,
      (Number.isFinite(opts.pathSearchBudget) ? opts.pathSearchBudget : DEFAULT_PATH_SEARCH_BUDGET) - totalPathSearches
    );
    const routes = routeMetrics(
      state,
      anchor,
      Object.assign({}, opts, { pathSearchBudget: remainingBudget }),
      memoryRoot,
      game
    );
    totalPathSearches += routes.pathSearches;
    for (const variant of VARIANTS) evaluated.push(evaluateVariant(state, anchor, variant, routes));
  }

  evaluated.sort((a, b) =>
    Number(b.valid) - Number(a.valid) ||
    b.score - a.score ||
    a.anchor.x - b.anchor.x ||
    a.anchor.y - b.anchor.y ||
    a.variant.localeCompare(b.variant)
  );

  const selected = evaluated.find(candidate => candidate.valid) || evaluated[0] || null;
  const result = {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    status: selected && selected.valid ? 'READY' : (selected ? 'NO_FEASIBLE_ANCHOR' : 'NO_CANDIDATES'),
    roomName,
    planTick: now,
    phase: 'ANCHOR_AND_CORE_GEOMETRY',
    candidateAnchorCount: anchors.length,
    evaluatedCandidateCount: evaluated.length,
    maxAnchors: Number.isFinite(opts.maxAnchors) ? Math.max(1, Math.round(opts.maxAnchors)) : DEFAULT_MAX_ANCHORS,
    pathSearchBudget: Number.isFinite(opts.pathSearchBudget)
      ? Math.max(0, Math.round(opts.pathSearchBudget))
      : DEFAULT_PATH_SEARCH_BUDGET,
    pathSearches: totalPathSearches,
    selected,
    topCandidates: evaluated.slice(0, 5).map(compactCandidate),
    legacyPlannerAuthority: 'UNCHANGED',
    nextPhase: 'P3_DEFENSE_PERIMETER_NOT_IMPLEMENTED'
  };

  const root = ensure(memoryRoot);
  root.rooms[roomName] = {
    planTick: now,
    expiresTick: now + DEFAULT_MEMORY_RETENTION,
    result
  };
  return result;
}

function snapshot(roomName, memoryRoot, game) {
  const root = ensure(memoryRoot);
  const entry = root.rooms[roomName];
  if (!entry) return null;
  const now = game && Number.isFinite(game.time)
    ? game.time
    : (typeof Game !== 'undefined' && Number.isFinite(Game.time) ? Game.time : entry.planTick);
  if (Number.isFinite(entry.expiresTick) && now > entry.expiresTick) {
    delete root.rooms[roomName];
    return null;
  }
  return entry.result || null;
}

function telemetrySummary(plan) {
  if (!plan) return null;
  return {
    schemaVersion: plan.schemaVersion,
    authority: plan.authority,
    status: plan.status,
    roomName: plan.roomName,
    planTick: plan.planTick,
    phase: plan.phase,
    candidateAnchorCount: plan.candidateAnchorCount,
    evaluatedCandidateCount: plan.evaluatedCandidateCount,
    pathSearchBudget: plan.pathSearchBudget,
    pathSearches: plan.pathSearches,
    selected: compactCandidate(plan.selected),
    topCandidates: (plan.topCandidates || []).slice(0, 3),
    legacyPlannerAuthority: plan.legacyPlannerAuthority,
    nextPhase: plan.nextPhase
  };
}

module.exports = {
  SCHEMA_VERSION,
  AUTHORITY,
  DEFAULT_MAX_ANCHORS,
  DEFAULT_PATH_SEARCH_BUDGET,
  VARIANTS,
  ensure,
  candidateAnchors,
  plannedSlots,
  slotFeasibility,
  routeMetrics,
  evaluateVariant,
  evaluate,
  snapshot,
  telemetrySummary,
  _test: {
    posOf,
    positionKey,
    chebyshev,
    midpoint,
    centroid,
    terrainAt,
    withinRoom,
    mineralOfState,
    fixedObjectPositions,
    anchorAllowed,
    opennessScore,
    seedPositions,
    extensionOffsets,
    blockingStructureAt,
    normalizePathCost,
    fallbackRouteCost,
    routeScore,
    towerCoverageScore,
    compactCandidate
  }
};
