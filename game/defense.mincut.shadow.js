'use strict';

const SCHEMA_VERSION = 1;
const AUTHORITY = 'SHADOW';
const DEFAULT_MARGIN = 4;
const DEFAULT_MAX_GRID_TILES = 900;
const DEFAULT_MAX_AUGMENTATIONS = 10000;
const DEFAULT_MEMORY_RETENTION = 5000;
const CAPACITY_SCALE = 100;
const ROOM_SIZE = 50;
const INF = 1000000000;
const DIRS = Object.freeze([
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],            [1, 0],
  [-1, 1],  [0, 1],   [1, 1]
]);

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, rooms: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.defenseMinCutShadow || memoryRoot.bot.defenseMinCutShadow.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.defenseMinCutShadow = { schemaVersion: SCHEMA_VERSION, rooms: {} };
  }
  if (!memoryRoot.bot.defenseMinCutShadow.rooms) memoryRoot.bot.defenseMinCutShadow.rooms = {};
  return memoryRoot.bot.defenseMinCutShadow;
}

function positionOf(value, roomName) {
  const p = value && (value.pos || value);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return {
    x: Math.round(p.x),
    y: Math.round(p.y),
    roomName: p.roomName || roomName || null
  };
}

function key(x, y) {
  return x + ',' + y;
}

function terrainAt(room, x, y, cachedTerrain) {
  if (!room) return 0;
  const terrain = cachedTerrain === undefined
    ? (typeof room.getTerrain === 'function' ? room.getTerrain() : room.terrain)
    : cachedTerrain;
  if (!terrain || typeof terrain.get !== 'function') return 0;
  try { return terrain.get(x, y); } catch (err) { return 1; }
}

function wallMask() {
  return typeof TERRAIN_MASK_WALL !== 'undefined' ? TERRAIN_MASK_WALL : 1;
}

function swampMask() {
  return typeof TERRAIN_MASK_SWAMP !== 'undefined' ? TERRAIN_MASK_SWAMP : 2;
}

function isWall(room, x, y, terrain) {
  return (terrainAt(room, x, y, terrain) & wallMask()) !== 0;
}

function isSwamp(room, x, y) {
  return (terrainAt(room, x, y) & swampMask()) !== 0;
}

function roomNameOf(state) {
  return state && state.room && state.room.name ? state.room.name : null;
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

function naturalObstacleSet(state) {
  const roomName = roomNameOf(state);
  const out = new Set();
  const controller = positionOf(state && state.room && state.room.controller, roomName);
  if (controller) out.add(key(controller.x, controller.y));
  const mineral = positionOf(mineralOfState(state), roomName);
  if (mineral) out.add(key(mineral.x, mineral.y));
  for (const source of state && state.sources || []) {
    const p = positionOf(source, roomName);
    if (p) out.add(key(p.x, p.y));
  }
  return out;
}

function plannedBlockedSet(plan) {
  const set = new Set();
  const blocked = plan && plan.selected && plan.selected.feasibility && Array.isArray(plan.selected.feasibility.blocked)
    ? plan.selected.feasibility.blocked
    : [];
  for (const item of blocked) {
    if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    set.add(key(Math.round(item.x), Math.round(item.y)));
  }
  return set;
}

function protectedAssets(state, plan, terrain) {
  const roomName = roomNameOf(state);
  const blocked = plannedBlockedSet(plan);
  const natural = naturalObstacleSet(state);
  const rows = [];
  const seen = new Set();
  const slots = plan && plan.selected && Array.isArray(plan.selected.plannedStructures)
    ? plan.selected.plannedStructures
    : [];

  for (const slot of slots) {
    if (!slot || !Number.isFinite(slot.x) || !Number.isFinite(slot.y)) continue;
    const x = Math.round(slot.x);
    const y = Math.round(slot.y);
    const k = key(x, y);
    if (seen.has(k) || blocked.has(k) || natural.has(k) || isWall(state.room, x, y, terrain)) continue;
    if (x <= 1 || y <= 1 || x >= 48 || y >= 48) continue;
    seen.add(k);
    rows.push({
      type: String(slot.type || 'planned'),
      x,
      y,
      roomName,
      critical: !!slot.critical,
      earliestCapability: slot.earliestCapability || null
    });
  }

  const spawn = positionOf(state && state.spawn, roomName);
  if (spawn) {
    const k = key(spawn.x, spawn.y);
    if (!seen.has(k) && !isWall(state.room, spawn.x, spawn.y, terrain)) {
      seen.add(k);
      rows.push({
        type: 'legacy-spawn',
        x: spawn.x,
        y: spawn.y,
        roomName,
        critical: true,
        earliestCapability: 'SPAWN_AVAILABLE'
      });
    }
  }

  return rows;
}

function trafficTiles(plan) {
  const set = new Set();
  const routes = plan && plan.selected && plan.selected.routes && Array.isArray(plan.selected.routes.routes)
    ? plan.selected.routes.routes
    : [];
  for (const route of routes) {
    for (const step of route && Array.isArray(route.path) ? route.path : []) {
      if (!step || !Number.isFinite(step.x) || !Number.isFinite(step.y)) continue;
      set.add(key(Math.round(step.x), Math.round(step.y)));
    }
  }
  return set;
}

function existingRampartTiles(state) {
  const set = new Set();
  for (const structure of state && state.structures || []) {
    if (!structure || String(structure.structureType || '') !== 'rampart') continue;
    const p = positionOf(structure, roomNameOf(state));
    if (p) set.add(key(p.x, p.y));
  }
  return set;
}

function towerPositions(plan) {
  const rows = [];
  const seen = new Set();
  const slots = plan && plan.selected && Array.isArray(plan.selected.plannedStructures)
    ? plan.selected.plannedStructures
    : [];
  for (const slot of slots) {
    if (!slot || slot.type !== 'tower' || !Number.isFinite(slot.x) || !Number.isFinite(slot.y)) continue;
    const k = key(Math.round(slot.x), Math.round(slot.y));
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ x: Math.round(slot.x), y: Math.round(slot.y) });
  }
  return rows;
}

function defenseBounds(assets, margin) {
  if (!assets || !assets.length) return null;
  const m = Number.isFinite(margin) ? Math.max(2, Math.round(margin)) : DEFAULT_MARGIN;
  let minX = Math.min(...assets.map(a => a.x)) - m;
  let maxX = Math.max(...assets.map(a => a.x)) + m;
  let minY = Math.min(...assets.map(a => a.y)) - m;
  let maxY = Math.max(...assets.map(a => a.y)) + m;
  minX = Math.max(2, minX);
  minY = Math.max(2, minY);
  maxX = Math.min(47, maxX);
  maxY = Math.min(47, maxY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    area: (maxX - minX + 1) * (maxY - minY + 1)
  };
}

function boundaryOf(bounds, x, y) {
  return x === bounds.minX || x === bounds.maxX || y === bounds.minY || y === bounds.maxY;
}

function cutCapacity(room, x, y, context, knownSwamp) {
  const k = key(x, y);
  if (context.protectedSet.has(k)) return INF;
  if (context.naturalSet.has(k)) return INF;

  let capacity = (knownSwamp === undefined ? isSwamp(room, x, y) : knownSwamp) ? 115 : 100;
  if (context.trafficSet.has(k)) capacity += 250;
  if (context.existingRamparts.has(k)) capacity = Math.min(capacity, 20);
  return capacity;
}

function buildGrid(state, plan, options) {
  // The view is static for one tick; avoid repeated getTerrain() calls.
  const terrain = typeof state.room.getTerrain === 'function'
    ? state.room.getTerrain() : state.room.terrain;
  const assets = protectedAssets(state, plan, terrain);
  const bounds = defenseBounds(assets, options && options.margin);
  if (!assets.length || !bounds) {
    return { ok: false, reason: 'NO_PROTECTED_ASSETS', assets, bounds: null };
  }
  const maxGridTiles = Number.isFinite(options && options.maxGridTiles)
    ? Math.max(100, Math.round(options.maxGridTiles))
    : DEFAULT_MAX_GRID_TILES;
  if (bounds.area > maxGridTiles) {
    return {
      ok: false,
      reason: 'GRID_BUDGET_EXCEEDED',
      assets,
      bounds,
      maxGridTiles
    };
  }

  const naturalSet = naturalObstacleSet(state);
  const protectedSet = new Set(assets.map(a => key(a.x, a.y)));
  const trafficSet = trafficTiles(plan);
  const existingRamparts = existingRampartTiles(state);
  const tiles = [];
  const indexByKey = new Map();
  // Coordinate array avoids temporary strings in eight-neighbor expansion.
  const indexByCoord = new Int16Array(ROOM_SIZE * ROOM_SIZE);
  indexByCoord.fill(-1);

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const terrainMask = terrainAt(state.room, x, y, terrain);
      if ((terrainMask & wallMask()) !== 0) continue;
      const coordKey = key(x, y);
      if (naturalSet.has(coordKey)) continue;
      const id = tiles.length;
      const tile = {
        id,
        x,
        y,
        swamp: (terrainMask & swampMask()) !== 0,
        boundary: boundaryOf(bounds, x, y),
        protected: protectedSet.has(coordKey),
        traffic: trafficSet.has(coordKey),
        existingRampart: existingRamparts.has(coordKey)
      };
      tiles.push(tile);
      indexByKey.set(coordKey, id);
      indexByCoord[y * ROOM_SIZE + x] = id;
    }
  }

  const missingProtected = assets.filter(asset => !indexByKey.has(key(asset.x, asset.y)));
  if (missingProtected.length) {
    return {
      ok: false,
      reason: 'PROTECTED_ASSET_NOT_WALKABLE',
      assets,
      bounds,
      missingProtected
    };
  }

  return {
    ok: true,
    assets,
    bounds,
    tiles,
    indexByKey,
    indexByCoord,
    naturalSet,
    protectedSet,
    trafficSet,
    existingRamparts
  };
}

class Dinic {
  constructor(size, maxAugmentations) {
    this.size = size;
    this.graph = Array.from({ length: size }, () => []);
    this.level = new Int32Array(size);
    this.work = new Int32Array(size);
    this.queue = new Int32Array(size);
    this.edgeCount = 0;
    this.augmentations = 0;
    this.maxAugmentations = Number.isFinite(maxAugmentations)
      ? Math.max(1, Math.round(maxAugmentations))
      : DEFAULT_MAX_AUGMENTATIONS;
    this.aborted = false;
  }

  addEdge(from, to, capacity) {
    // Solver consumes residual capacity and reverse links, not edge metadata.
    const forward = { to, rev: this.graph[to].length, cap: capacity };
    const reverse = { to: from, rev: this.graph[from].length, cap: 0 };
    this.graph[from].push(forward);
    this.graph[to].push(reverse);
    this.edgeCount += 1;
  }

  bfs(source, sink) {
    this.level.fill(-1);
    const queue = this.queue;
    let head = 0;
    let tail = 0;
    this.level[source] = 0;
    queue[tail++] = source;
    while (head < tail) {
      const v = queue[head++];
      for (const edge of this.graph[v]) {
        if (edge.cap <= 0 || this.level[edge.to] >= 0) continue;
        this.level[edge.to] = this.level[v] + 1;
        if (edge.to === sink) return true;
        queue[tail++] = edge.to;
      }
    }
    return this.level[sink] >= 0;
  }

  dfs(v, sink, flow) {
    if (v === sink) return flow;
    for (let i = this.work[v]; i < this.graph[v].length; i++, this.work[v]++) {
      const edge = this.graph[v][i];
      if (edge.cap <= 0 || this.level[edge.to] !== this.level[v] + 1) continue;
      const pushed = this.dfs(edge.to, sink, Math.min(flow, edge.cap));
      if (pushed <= 0) continue;
      edge.cap -= pushed;
      this.graph[edge.to][edge.rev].cap += pushed;
      return pushed;
    }
    return 0;
  }

  maxFlow(source, sink) {
    let flow = 0;
    while (this.bfs(source, sink)) {
      this.work.fill(0);
      while (true) {
        if (this.augmentations >= this.maxAugmentations) {
          this.aborted = true;
          return flow;
        }
        const pushed = this.dfs(source, sink, INF);
        if (pushed <= 0) break;
        flow += pushed;
        this.augmentations += 1;
      }
    }
    return flow;
  }

  reachable(source) {
    const seen = new Uint8Array(this.size);
    const queue = this.queue;
    let head = 0;
    let tail = 0;
    seen[source] = 1;
    queue[tail++] = source;
    while (head < tail) {
      const v = queue[head++];
      for (const edge of this.graph[v]) {
        if (edge.cap <= 0 || seen[edge.to]) continue;
        seen[edge.to] = 1;
        queue[tail++] = edge.to;
      }
    }
    return seen;
  }
}

function buildFlowGraph(state, grid, options) {
  const tileCount = grid.tiles.length;
  const source = tileCount * 2;
  const sink = source + 1;
  const dinic = new Dinic(
    sink + 1,
    Number.isFinite(options && options.maxAugmentations)
      ? options.maxAugmentations
      : DEFAULT_MAX_AUGMENTATIONS
  );
  const context = {
    protectedSet: grid.protectedSet,
    naturalSet: grid.naturalSet,
    trafficSet: grid.trafficSet,
    existingRamparts: grid.existingRamparts
  };

  for (const tile of grid.tiles) {
    const inNode = tile.id * 2;
    const outNode = inNode + 1;
    dinic.addEdge(inNode, outNode, cutCapacity(state.room, tile.x, tile.y, context, tile.swamp));

    if (tile.protected) dinic.addEdge(source, inNode, INF);
    if (tile.boundary) dinic.addEdge(outNode, sink, INF);

    for (const [dx, dy] of DIRS) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      const neighborId = nx >= 0 && nx < ROOM_SIZE && ny >= 0 && ny < ROOM_SIZE
        ? grid.indexByCoord[ny * ROOM_SIZE + nx] : -1;
      if (neighborId < 0) continue;
      dinic.addEdge(outNode, neighborId * 2, INF);
    }
  }

  return { dinic, source, sink };
}

function minCut(state, grid, options) {
  const flowGraph = buildFlowGraph(state, grid, options);
  const maxFlow = flowGraph.dinic.maxFlow(flowGraph.source, flowGraph.sink);
  const reachable = flowGraph.dinic.reachable(flowGraph.source);
  const cut = [];

  for (const tile of grid.tiles) {
    const inNode = tile.id * 2;
    const outNode = inNode + 1;
    if (reachable[inNode] && !reachable[outNode]) {
      cut.push({
        x: tile.x,
        y: tile.y,
        roomName: roomNameOf(state),
        trafficCrossing: tile.traffic,
        existingRampart: tile.existingRampart,
        earliestCapability: 'RAMPART_AVAILABLE',
        priorityClass: 'DEFENSE'
      });
    }
  }

  cut.sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    complete: !flowGraph.dinic.aborted,
    cut,
    maxFlow,
    augmentations: flowGraph.dinic.augmentations,
    nodeCount: flowGraph.dinic.size,
    edgeCount: flowGraph.dinic.edgeCount
  };
}

function groupRamparts(ramparts) {
  const byKey = new Map((ramparts || []).map((r, i) => [key(r.x, r.y), i]));
  const seen = new Set();
  const groups = [];

  for (let i = 0; i < (ramparts || []).length; i++) {
    if (seen.has(i)) continue;
    const queue = [i];
    seen.add(i);
    const tiles = [];
    while (queue.length) {
      const idx = queue.shift();
      const tile = ramparts[idx];
      tiles.push({ x: tile.x, y: tile.y });
      for (const [dx, dy] of DIRS) {
        const next = byKey.get(key(tile.x + dx, tile.y + dy));
        if (next === undefined || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    groups.push({
      id: groups.length,
      count: tiles.length,
      tiles
    });
  }
  groups.sort((a, b) => b.count - a.count || a.id - b.id);
  return groups;
}

function breachAnalysis(state, grid, ramparts) {
  const blocked = new Set((ramparts || []).map(r => key(r.x, r.y)));
  const visited = new Set();
  const queue = [];

  for (const tile of grid.tiles) {
    if (!tile.boundary) continue;
    const k = key(tile.x, tile.y);
    if (blocked.has(k) || visited.has(k)) continue;
    visited.add(k);
    queue.push(tile);
  }

  for (let head = 0; head < queue.length; head++) {
    const tile = queue[head];
    for (const [dx, dy] of DIRS) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      const k = key(nx, ny);
      if (blocked.has(k) || visited.has(k)) continue;
      const id = grid.indexByKey.get(k);
      if (id === undefined) continue;
      visited.add(k);
      queue.push(grid.tiles[id]);
    }
  }

  const exposedAssets = grid.assets.filter(asset => visited.has(key(asset.x, asset.y)));
  return {
    breachRouteCount: exposedAssets.length,
    exposedAssetCount: exposedAssets.length,
    exposedAssets: exposedAssets.slice(0, 12)
  };
}

function rangeChebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function towerDamageAt(range) {
  if (range <= 5) return 600;
  if (range >= 20) return 150;
  return 600 - (range - 5) * 30;
}

function towerCoverage(ramparts, towers) {
  const samples = [];
  for (const rampart of ramparts || []) {
    let damage = 0;
    for (const tower of towers || []) damage += towerDamageAt(rangeChebyshev(rampart, tower));
    samples.push(damage);
  }
  if (!samples.length) {
    return {
      towerCount: (towers || []).length,
      minimumDamage: 0,
      averageDamage: 0,
      minimumScore: 0,
      averageScore: 0
    };
  }
  const minimumDamage = Math.min(...samples);
  const averageDamage = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return {
    towerCount: (towers || []).length,
    minimumDamage: Math.round(minimumDamage * 100) / 100,
    averageDamage: Math.round(averageDamage * 100) / 100,
    minimumScore: Math.max(0, Math.min(100, Math.round(minimumDamage / 600 * 100))),
    averageScore: Math.max(0, Math.min(100, Math.round(averageDamage / 600 * 100)))
  };
}

function exitExposure(ramparts) {
  if (!ramparts || !ramparts.length) {
    return { exposedWithin5: 0, ratio: 0, averageExitDistance: null, score: 100 };
  }
  let exposedWithin5 = 0;
  let totalDistance = 0;
  for (const rampart of ramparts) {
    const distance = Math.min(rampart.x, 49 - rampart.x, rampart.y, 49 - rampart.y);
    totalDistance += distance;
    if (distance <= 5) exposedWithin5 += 1;
  }
  const ratio = exposedWithin5 / ramparts.length;
  return {
    exposedWithin5,
    ratio: Math.round(ratio * 1000) / 1000,
    averageExitDistance: Math.round(totalDistance / ramparts.length * 100) / 100,
    score: Math.max(0, Math.round(100 - ratio * 100))
  };
}

function scoreDefense(ramparts, breach, coverage, exposure) {
  const rampartCount = (ramparts || []).length;
  const trafficCrossings = (ramparts || []).filter(r => r.trafficCrossing).length;
  const trafficRatio = rampartCount ? trafficCrossings / rampartCount : 0;
  const repairBurdenIndex = rampartCount * (
    1 +
    (1 - coverage.averageScore / 100) * 0.5 +
    exposure.ratio * 0.5
  );

  const components = {
    rampartEconomy: Math.max(0, Math.round(100 - rampartCount * 3)),
    repairBurden: Math.max(0, Math.round(100 - repairBurdenIndex * 2)),
    towerCoverage: coverage.minimumScore,
    breachResistance: breach.breachRouteCount === 0
      ? 100
      : Math.max(0, 100 - breach.breachRouteCount * 20),
    exitExposure: exposure.score,
    traffic: Math.max(0, Math.round(100 - trafficRatio * 100))
  };
  const weights = {
    rampartEconomy: 0.20,
    repairBurden: 0.15,
    towerCoverage: 0.20,
    breachResistance: 0.25,
    exitExposure: 0.10,
    traffic: 0.10
  };
  let total = 0;
  for (const name of Object.keys(weights)) total += components[name] * weights[name];

  return {
    total: Math.max(0, Math.min(100, Math.round(total * 100) / 100)),
    components,
    rampartCount,
    trafficCrossings,
    repairBurdenIndex: Math.round(repairBurdenIndex * 100) / 100
  };
}

function cpuReader(game, options) {
  if (options && typeof options.cpuNow === 'function') return options.cpuNow;
  if (game && game.cpu && typeof game.cpu.getUsed === 'function') return () => game.cpu.getUsed();
  return () => null;
}

function measurePhase(phaseEvidence, name, cpuNow, fn) {
  const start = cpuNow();
  let result;
  let failureReason = null;
  try {
    result = fn();
  } catch (err) {
    failureReason = err && err.message ? String(err.message) : 'UNKNOWN_ERROR';
    throw err;
  } finally {
    const end = cpuNow();
    phaseEvidence.push({
      phase: name,
      cpuUsed: Number.isFinite(start) && Number.isFinite(end)
        ? Math.round(Math.max(0, end - start) * 1000) / 1000
        : null,
      failureReason
    });
  }
  return result;
}

function evaluate(state, plannerPlan, memoryRoot, game, options) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const opts = options || {};
  const now = game && Number.isFinite(game.time) ? game.time : 0;
  const roomName = roomNameOf(state);
  const phaseEvidence = [];
  const cpuNow = cpuReader(game, opts);

  const base = {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    roomName,
    planTick: now,
    phase: 'DEFENSE_MINCUT',
    sourcePlannerTick: plannerPlan && Number.isFinite(plannerPlan.planTick) ? plannerPlan.planTick : null,
    legacyPlannerAuthority: 'UNCHANGED',
    constructionAuthority: 'NONE'
  };

  if (!roomName || !state || !state.room || !state.room.controller || !state.room.controller.my) {
    return Object.assign(base, {
      status: 'UNAVAILABLE',
      reason: 'OWNED_ROOM_REQUIRED',
      phaseEvidence
    });
  }
  if (!plannerPlan || plannerPlan.authority !== 'SHADOW' || plannerPlan.status !== 'READY' || !plannerPlan.selected) {
    return Object.assign(base, {
      status: 'WAITING_FOR_P2',
      reason: 'READY_P2_SHADOW_PLAN_REQUIRED',
      phaseEvidence
    });
  }

  let grid;
  try {
    grid = measurePhase(phaseEvidence, 'PROTECTED_TOPOLOGY', cpuNow, () => buildGrid(state, plannerPlan, opts));
  } catch (err) {
    return Object.assign(base, {
      status: 'FAILED',
      reason: 'GRID_BUILD_EXCEPTION',
      error: err && err.message ? String(err.message) : String(err),
      phaseEvidence
    });
  }
  if (!grid.ok) {
    return Object.assign(base, {
      status: 'UNAVAILABLE',
      reason: grid.reason,
      bounds: grid.bounds || null,
      protectedAssetCount: (grid.assets || []).length,
      phaseEvidence
    });
  }

  let cutResult;
  try {
    cutResult = measurePhase(phaseEvidence, 'MINCUT', cpuNow, () => minCut(state, grid, opts));
  } catch (err) {
    return Object.assign(base, {
      status: 'FAILED',
      reason: 'MINCUT_EXCEPTION',
      error: err && err.message ? String(err.message) : String(err),
      bounds: grid.bounds,
      protectedAssetCount: grid.assets.length,
      phaseEvidence
    });
  }

  const scored = measurePhase(phaseEvidence, 'DEFENSE_SCORE', cpuNow, () => {
    const groups = groupRamparts(cutResult.cut);
    const breach = breachAnalysis(state, grid, cutResult.cut);
    const coverage = towerCoverage(cutResult.cut, towerPositions(plannerPlan));
    const exposure = exitExposure(cutResult.cut);
    const score = scoreDefense(cutResult.cut, breach, coverage, exposure);
    return { groups, breach, coverage, exposure, score };
  });

  const status = cutResult.complete && scored.breach.breachRouteCount === 0
    ? 'READY'
    : (cutResult.complete ? 'BREACHABLE' : 'INCOMPLETE');

  const result = Object.assign(base, {
    status,
    reason: status === 'READY' ? null : (cutResult.complete ? 'PROTECTED_ASSET_REACHABLE' : 'AUGMENTATION_BUDGET'),
    bounds: grid.bounds,
    protectedAssetCount: grid.assets.length,
    trafficTileCount: grid.trafficSet.size,
    graph: {
      walkableTiles: grid.tiles.length,
      nodeCount: cutResult.nodeCount,
      edgeCount: cutResult.edgeCount,
      augmentations: cutResult.augmentations,
      maxFlow: cutResult.maxFlow,
      complete: cutResult.complete
    },
    ramparts: cutResult.cut,
    rampartCount: cutResult.cut.length,
    rampartGroups: scored.groups,
    metrics: {
      repairBurdenIndex: scored.score.repairBurdenIndex,
      towerCount: scored.coverage.towerCount,
      towerMinimumDamage: scored.coverage.minimumDamage,
      towerAverageDamage: scored.coverage.averageDamage,
      towerMinimumCoverageScore: scored.coverage.minimumScore,
      towerAverageCoverageScore: scored.coverage.averageScore,
      breachRouteCount: scored.breach.breachRouteCount,
      exposedAssetCount: scored.breach.exposedAssetCount,
      exitExposedWithin5: scored.exposure.exposedWithin5,
      exitExposureRatio: scored.exposure.ratio,
      averageExitDistance: scored.exposure.averageExitDistance,
      trafficCrossings: scored.score.trafficCrossings
    },
    score: {
      total: scored.score.total,
      components: scored.score.components
    },
    phaseEvidence
  });

  const root = ensure(memoryRoot);
  root.rooms[roomName] = {
    planTick: now,
    expiresTick: now + DEFAULT_MEMORY_RETENTION,
    sourcePlannerTick: result.sourcePlannerTick,
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
    reason: plan.reason || null,
    roomName: plan.roomName,
    planTick: plan.planTick,
    sourcePlannerTick: plan.sourcePlannerTick,
    phase: plan.phase,
    bounds: plan.bounds || null,
    protectedAssetCount: plan.protectedAssetCount,
    trafficTileCount: plan.trafficTileCount,
    graph: plan.graph || null,
    rampartCount: plan.rampartCount,
    ramparts: (plan.ramparts || []).slice(0, 16).map(r => ({
      x: r.x,
      y: r.y,
      trafficCrossing: !!r.trafficCrossing,
      existingRampart: !!r.existingRampart
    })),
    rampartGroupCount: Array.isArray(plan.rampartGroups) ? plan.rampartGroups.length : null,
    metrics: plan.metrics || null,
    score: plan.score || null,
    phaseEvidence: (plan.phaseEvidence || []).map(item => ({
      phase: item.phase,
      cpuUsed: item.cpuUsed,
      failureReason: item.failureReason
    })),
    legacyPlannerAuthority: plan.legacyPlannerAuthority,
    constructionAuthority: plan.constructionAuthority
  };
}

module.exports = {
  SCHEMA_VERSION,
  AUTHORITY,
  DEFAULT_MARGIN,
  DEFAULT_MAX_GRID_TILES,
  DEFAULT_MAX_AUGMENTATIONS,
  ensure,
  protectedAssets,
  trafficTiles,
  defenseBounds,
  buildGrid,
  minCut,
  groupRamparts,
  breachAnalysis,
  towerCoverage,
  exitExposure,
  scoreDefense,
  evaluate,
  snapshot,
  telemetrySummary,
  _test: {
    positionOf,
    key,
    terrainAt,
    isWall,
    isSwamp,
    mineralOfState,
    naturalObstacleSet,
    plannedBlockedSet,
    existingRampartTiles,
    towerPositions,
    boundaryOf,
    cutCapacity,
    buildFlowGraph,
    rangeChebyshev,
    towerDamageAt,
    Dinic
  }
};
