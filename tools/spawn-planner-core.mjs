const ROOM_SIZE = 50;
const INF = 1e9;

const round1 = n => Math.round(n * 10) / 10;
const round3 = n => Math.round(n * 1000) / 1000;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function decodeTerrain(encoded) {
  if (typeof encoded !== 'string' || encoded.length < ROOM_SIZE * ROOM_SIZE) {
    throw new Error(`Invalid encoded terrain: expected at least ${ROOM_SIZE * ROOM_SIZE} characters`);
  }
  const terrain = new Uint8Array(ROOM_SIZE * ROOM_SIZE);
  for (let i = 0; i < terrain.length; i++) {
    const n = Number(encoded[i]);
    terrain[i] = Number.isFinite(n) ? n : 0;
  }
  return terrain;
}

export function roomNameToXY(roomName) {
  const m = /^([WE])(\d+)([NS])(\d+)$/.exec(roomName);
  if (!m) throw new Error(`Invalid room name: ${roomName}`);
  const [, h, hx, v, vy] = m;
  const rx = Number(hx);
  const ry = Number(vy);
  return {
    x: h === 'E' ? rx : -rx - 1,
    y: v === 'S' ? ry : -ry - 1
  };
}

export function xyToRoomName(x, y) {
  const h = x >= 0 ? `E${x}` : `W${-x - 1}`;
  const v = y >= 0 ? `S${y}` : `N${-y - 1}`;
  return h + v;
}

export function roomsAround(center, radius = 2) {
  const c = roomNameToXY(center);
  const result = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      result.push(xyToRoomName(c.x + dx, c.y + dy));
    }
  }
  return result;
}

export function roomsAroundSet(rooms, radius = 1) {
  const out = new Set();
  for (const room of rooms) {
    for (const nearby of roomsAround(room, radius)) out.add(nearby);
  }
  return [...out];
}

export function worldBoundsFromSize(size) {
  if (!Number.isInteger(size) || size <= 0) return null;
  return {
    min: -Math.ceil(size / 2),
    max: Math.floor(size / 2) - 1,
    size
  };
}

export function roomWithinWorldDimensions(roomName, width, height = width) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return true;
  const p = roomNameToXY(roomName);
  const bx = worldBoundsFromSize(width);
  const by = worldBoundsFromSize(height);
  return p.x >= bx.min && p.x <= bx.max && p.y >= by.min && p.y <= by.max;
}

const idx = (x, y) => y * ROOM_SIZE + x;
const inBounds = (x, y) => x >= 0 && x < ROOM_SIZE && y >= 0 && y < ROOM_SIZE;
const isWall = (terrain, x, y) => (terrain[idx(x, y)] & 1) !== 0;
const isSwamp = (terrain, x, y) => (terrain[idx(x, y)] & 2) !== 0;

function neighbors8(x, y) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny)) out.push([nx, ny]);
    }
  }
  return out;
}

function neighbors4(x, y) {
  const out = [];
  if (x > 0) out.push([x - 1, y]);
  if (x < ROOM_SIZE - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < ROOM_SIZE - 1) out.push([x, y + 1]);
  return out;
}

class MinHeap {
  constructor() { this.a = []; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= item[0]) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const root = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const c = r < a.length && a[r][0] < a[l][0] ? r : l;
        if (a[c][0] >= last[0]) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return root;
  }
  get length() { return this.a.length; }
}

function dijkstraFromGoals(terrain, occupied, goals) {
  const dist = new Float64Array(ROOM_SIZE * ROOM_SIZE);
  dist.fill(INF);
  const heap = new MinHeap();

  for (const [x, y] of goals) {
    if (!inBounds(x, y) || isWall(terrain, x, y) || occupied.has(idx(x, y))) continue;
    const i = idx(x, y);
    if (dist[i] !== 0) {
      dist[i] = 0;
      heap.push([0, x, y]);
    }
  }

  while (heap.length) {
    const [d, x, y] = heap.pop();
    const i = idx(x, y);
    if (d !== dist[i]) continue;
    for (const [nx, ny] of neighbors8(x, y)) {
      if (isWall(terrain, nx, ny) || occupied.has(idx(nx, ny))) continue;
      const step = isSwamp(terrain, x, y) ? 10 : 2;
      const nd = d + step;
      const ni = idx(nx, ny);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        heap.push([nd, nx, ny]);
      }
    }
  }
  return dist;
}

function goalsAround(terrain, occupied, object, range = 1) {
  const goals = [];
  for (let y = object.y - range; y <= object.y + range; y++) {
    for (let x = object.x - range; x <= object.x + range; x++) {
      if (!inBounds(x, y)) continue;
      if (Math.max(Math.abs(x - object.x), Math.abs(y - object.y)) > range) continue;
      if (x === object.x && y === object.y) continue;
      if (isWall(terrain, x, y) || occupied.has(idx(x, y))) continue;
      goals.push([x, y]);
    }
  }
  return goals;
}

function buildOccupied(objects) {
  const occupied = new Set();
  for (const o of objects) {
    if (!Number.isInteger(o.x) || !Number.isInteger(o.y)) continue;
    occupied.add(idx(o.x, o.y));
  }
  return occupied;
}

function areaStats(terrain, occupied, cx, cy, radius) {
  let passable = 0;
  let swamp = 0;
  let total = 0;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      total++;
      if (isWall(terrain, x, y) || occupied.has(idx(x, y))) continue;
      passable++;
      if (isSwamp(terrain, x, y)) swamp++;
    }
  }
  return { passable, swamp, total, ratio: total ? passable / total : 0 };
}

const CORE_OFFSETS = [
  [-2,-2],[0,-2],[2,-2],[-2,0],[2,0],[-2,2],[0,2],[2,2],
  [-3,-1],[-3,1],[3,-1],[3,1],[-1,-3],[1,-3],[-1,3],[1,3],
  [-4,0],[4,0],[0,-4],[0,4],[-3,-3],[3,-3],[-3,3],[3,3]
];

function coreFit(terrain, occupied, cx, cy) {
  let fit = 0;
  for (const [dx, dy] of CORE_OFFSETS) {
    const x = cx + dx;
    const y = cy + dy;
    if (!inBounds(x, y) || isWall(terrain, x, y) || occupied.has(idx(x, y))) continue;
    fit++;
  }
  return { fit, total: CORE_OFFSETS.length, ratio: fit / CORE_OFFSETS.length };
}

function adjacentOpenCount(terrain, occupied, x, y) {
  let n = 0;
  for (const [nx, ny] of neighbors8(x, y)) {
    if (!isWall(terrain, nx, ny) && !occupied.has(idx(nx, ny))) n++;
  }
  return n;
}

function objectAccessSlots(terrain, occupied, object, range = 1) {
  let count = 0;
  for (let y = object.y - range; y <= object.y + range; y++) {
    for (let x = object.x - range; x <= object.x + range; x++) {
      if (!inBounds(x, y)) continue;
      if (Math.max(Math.abs(x - object.x), Math.abs(y - object.y)) > range) continue;
      if (x === object.x && y === object.y) continue;
      if (isWall(terrain, x, y) || occupied.has(idx(x, y))) continue;
      count++;
    }
  }
  return count;
}

function maxOpenWindow(terrain, occupied, cx, cy, size, searchRadius) {
  let best = 0;
  const half = Math.floor(size / 2);
  for (let wy = cy - searchRadius; wy <= cy + searchRadius; wy++) {
    for (let wx = cx - searchRadius; wx <= cx + searchRadius; wx++) {
      let open = 0;
      const x0 = wx - half;
      const y0 = wy - half;
      for (let y = y0; y < y0 + size; y++) {
        for (let x = x0; x < x0 + size; x++) {
          if (!inBounds(x, y) || isWall(terrain, x, y) || occupied.has(idx(x, y))) continue;
          open++;
        }
      }
      if (open > best) best = open;
    }
  }
  return best;
}

function connectedOpenCount(terrain, occupied, cx, cy, radius) {
  if (isWall(terrain, cx, cy) || occupied.has(idx(cx, cy))) return 0;
  const seen = new Set([idx(cx, cy)]);
  const queue = [[cx, cy]];
  let count = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const [x, y] = queue[qi];
    if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > radius) continue;
    count++;
    for (const [nx, ny] of neighbors4(x, y)) {
      if (Math.max(Math.abs(nx - cx), Math.abs(ny - cy)) > radius) continue;
      const ni = idx(nx, ny);
      if (seen.has(ni) || isWall(terrain, nx, ny) || occupied.has(ni)) continue;
      seen.add(ni);
      queue.push([nx, ny]);
    }
  }
  return count;
}

function layoutStats(terrain, occupied, cx, cy) {
  const inner = areaStats(terrain, occupied, cx, cy, 3);
  const medium = areaStats(terrain, occupied, cx, cy, 6);
  const outer = areaStats(terrain, occupied, cx, cy, 9);
  const connected = connectedOpenCount(terrain, occupied, cx, cy, 9);
  const labWindow4 = maxOpenWindow(terrain, occupied, cx, cy, 4, 7);
  const labWindow5 = maxOpenWindow(terrain, occupied, cx, cy, 5, 7);
  // This is a deliberately conservative layout-headroom heuristic, not a claim
  // about the exact number of RCL8 structures. Roads and traffic lanes consume
  // part of the raw buildable area, so only ~72% is counted as flexible slots.
  const effectiveSlots = Math.floor(outer.passable * 0.72);
  const capacityRatio = clamp(effectiveSlots / 95, 0, 1.25);
  const labReady = labWindow4 >= 12 && labWindow5 >= 18;
  const hubReady = inner.ratio >= 0.80;
  return {
    innerOpenRatio: round3(inner.ratio),
    mediumOpenRatio: round3(medium.ratio),
    outerOpenRatio: round3(outer.ratio),
    rawOuterBuildable: outer.passable,
    effectiveSlots,
    capacityRatio: round3(capacityRatio),
    connectedOpen9: connected,
    labWindow4,
    labWindow5,
    labReady,
    hubReady
  };
}


function squareRing(cx, cy, radius) {
  const out = [];
  for (let x = cx - radius; x <= cx + radius; x++) {
    out.push([x, cy - radius]);
    if (radius) out.push([x, cy + radius]);
  }
  for (let y = cy - radius + 1; y <= cy + radius - 1; y++) {
    out.push([cx - radius, y]);
    if (radius) out.push([cx + radius, y]);
  }
  return out;
}

export function estimateDefensePerimeterFromDecoded(terrain, occupied, cx, cy) {
  const candidates = [];
  for (let radius = 5; radius <= 10; radius++) {
    let rampartTiles = 0;
    let naturalWallTiles = 0;
    let objectGaps = 0;
    let outside = 0;
    let segments = 0;
    let inOpenRun = false;
    const ring = squareRing(cx, cy, radius);
    for (const [x, y] of ring) {
      if (!inBounds(x, y)) {
        outside++;
        inOpenRun = false;
        continue;
      }
      const i = idx(x, y);
      if (isWall(terrain, x, y)) {
        naturalWallTiles++;
        inOpenRun = false;
      } else if (occupied.has(i)) {
        objectGaps++;
        if (!inOpenRun) segments++;
        inOpenRun = true;
      } else {
        rampartTiles++;
        if (!inOpenRun) segments++;
        inOpenRun = true;
      }
    }
    const ringTiles = ring.length;
    const naturalWallRatio = ringTiles ? naturalWallTiles / ringTiles : 0;
    const cost = rampartTiles + objectGaps * 12 + outside * 30 + segments * 1.75 - naturalWallTiles * 0.35;
    candidates.push({ radius, rampartTiles, naturalWallTiles, objectGaps, outside, segments, naturalWallRatio: round3(naturalWallRatio), cost: round1(cost) });
  }
  candidates.sort((a, b) => a.cost - b.cost || a.rampartTiles - b.rampartTiles);
  const best = candidates[0];
  return {
    ...best,
    chokepointScore: round1(clamp(best.naturalWallRatio * 70 + Math.max(0, 8 - best.segments) * 4 - best.objectGaps * 8, 0, 100)),
    candidates
  };
}

function transformOffset(dx, dy, variant) {
  let x = dx;
  let y = dy;
  if (variant >= 4) x = -x;
  const rot = variant % 4;
  for (let i = 0; i < rot; i++) [x, y] = [-y, x];
  return [x, y];
}

const BLUEPRINT_SPECIALS = [
  ['spawn', 0, 0], ['spawn', 2, 0], ['spawn', -2, 0],
  ['storage', 0, 2], ['terminal', 1, 2], ['factory', -1, 2], ['link', 0, 3],
  ['powerSpawn', 0, -2], ['nuker', 1, -2], ['observer', -1, -2],
  ['tower', -3, -1], ['tower', -3, 1], ['tower', 3, -1], ['tower', 3, 1], ['tower', -1, 3], ['tower', 1, 3],
  ['lab', -4, 4], ['lab', -3, 4], ['lab', -2, 4], ['lab', -4, 5], ['lab', -3, 5],
  ['lab', -2, 5], ['lab', -4, 6], ['lab', -3, 6], ['lab', -2, 6], ['lab', -1, 5]
];

function blueprintVariant(terrain, occupied, cx, cy, variant) {
  const used = new Set();
  const byType = {};
  let mandatoryFit = 0;
  let mandatoryTotal = 0;
  const failures = [];
  const place = (type, dx, dy, mandatory = true) => {
    const [tx, ty] = transformOffset(dx, dy, variant);
    const x = cx + tx;
    const y = cy + ty;
    mandatoryTotal += mandatory ? 1 : 0;
    const good = inBounds(x, y) && !isWall(terrain, x, y) && !occupied.has(idx(x, y)) && !used.has(idx(x, y));
    byType[type] ||= { required: 0, fit: 0 };
    byType[type].required++;
    if (good) {
      byType[type].fit++;
      mandatoryFit += mandatory ? 1 : 0;
      used.add(idx(x, y));
    } else if (failures.length < 12) {
      failures.push({ type, x, y, reason: !inBounds(x, y) ? 'OUTSIDE' : isWall(terrain, x, y) ? 'WALL' : occupied.has(idx(x, y)) ? 'OBJECT' : 'OVERLAP' });
    }
  };

  for (const [type, dx, dy] of BLUEPRINT_SPECIALS) place(type, dx, dy, true);

  const extensionSlots = [];
  const roadSlots = [];
  for (let dy = -8; dy <= 8; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 8) continue;
      const [tx, ty] = transformOffset(dx, dy, variant);
      const x = cx + tx;
      const y = cy + ty;
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      if (used.has(i)) continue;
      const latticeRoad = (Math.abs(dx) % 3 === 0) || (Math.abs(dy) % 3 === 0);
      const slot = { x, y, d: Math.max(Math.abs(dx), Math.abs(dy)), blocked: isWall(terrain, x, y) || occupied.has(i) };
      if (latticeRoad) roadSlots.push(slot);
      else extensionSlots.push(slot);
    }
  }
  extensionSlots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  roadSlots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);

  let extFit = 0;
  for (const slot of extensionSlots) {
    if (extFit >= 60) break;
    if (slot.blocked || used.has(idx(slot.x, slot.y))) continue;
    used.add(idx(slot.x, slot.y));
    extFit++;
  }
  byType.extension = { required: 60, fit: extFit };

  const roadTarget = Math.min(52, roadSlots.length);
  let roadFit = 0;
  for (const slot of roadSlots.slice(0, roadTarget)) if (!slot.blocked) roadFit++;
  byType.road = { required: roadTarget, fit: roadFit };

  const specialRequired = BLUEPRINT_SPECIALS.length;
  const structureRequired = specialRequired + 60;
  const structureFit = mandatoryFit + extFit;
  const completionRatio = structureRequired ? structureFit / structureRequired : 0;
  const roadFitRatio = roadTarget ? roadFit / roadTarget : 1;
  const complete = mandatoryFit === mandatoryTotal && extFit >= 60 && roadFitRatio >= 0.72;
  const score = completionRatio * 78 + roadFitRatio * 14 + (complete ? 8 : 0);
  return {
    variant,
    complete,
    structureRequired,
    structureFit,
    completionRatio: round3(completionRatio),
    roadFitRatio: round3(roadFitRatio),
    extensionCapacity: extensionSlots.filter(v => !v.blocked).length,
    byType,
    failures,
    score: round1(score)
  };
}

export function simulateRcl8BlueprintFromDecoded(terrain, occupied, cx, cy) {
  const variants = [];
  for (let variant = 0; variant < 8; variant++) variants.push(blueprintVariant(terrain, occupied, cx, cy, variant));
  variants.sort((a, b) => b.score - a.score || Number(b.complete) - Number(a.complete));
  return { ...variants[0], variants: variants.map(v => ({ variant: v.variant, complete: v.complete, score: v.score, completionRatio: v.completionRatio, roadFitRatio: v.roadFitRatio })) };
}

export function estimateDefensePerimeter({ encodedTerrain, objects = [], x, y }) {
  const terrain = decodeTerrain(encodedTerrain);
  const occupied = buildOccupied(objects);
  return estimateDefensePerimeterFromDecoded(terrain, occupied, x, y);
}

export function simulateRcl8Blueprint({ encodedTerrain, objects = [], x, y }) {
  const terrain = decodeTerrain(encodedTerrain);
  const occupied = buildOccupied(objects);
  return simulateRcl8BlueprintFromDecoded(terrain, occupied, x, y);
}

export function evaluateExpansionCorridor(roomName, summaries, radius = 2) {
  const center = roomNameToXY(roomName);
  const within = name => {
    const p = roomNameToXY(name);
    return Math.max(Math.abs(p.x - center.x), Math.abs(p.y - center.y)) <= radius;
  };
  const get = name => summaries instanceof Map ? summaries.get(name) : summaries?.[name];
  const starts = [];
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) starts.push(xyToRoomName(center.x + dx, center.y + dy));
  const queue = [];
  const seen = new Set();
  for (const name of starts) {
    const s = get(name);
    if (s && s.valid !== false && (s.claimable || s.highwayRoom)) { seen.add(name); queue.push(name); }
  }
  let claimableRooms = 0;
  let twoSourceRooms = 0;
  let sources = 0;
  let highwayRooms = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const name = queue[qi];
    const s = get(name);
    if (!s) continue;
    if (s.claimable) {
      claimableRooms++;
      sources += s.sourceCount || 0;
      if ((s.sourceCount || 0) >= 2) twoSourceRooms++;
    } else if (s.highwayRoom) highwayRooms++;
    const p = roomNameToXY(name);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const next = xyToRoomName(p.x + dx, p.y + dy);
      if (!within(next) || seen.has(next)) continue;
      const ns = get(next);
      if (!ns || ns.valid === false || (!ns.claimable && !ns.highwayRoom)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  const score = claimableRooms * 45 + twoSourceRooms * 95 + Math.min(sources, 16) * 18 + Math.min(highwayRooms, 4) * 20;
  return { radius, connectedRooms: seen.size, claimableRooms, twoSourceRooms, sources, highwayRooms, score: round1(score), rooms: [...seen].sort() };
}

export function adjacentRemoteRouteCost({ homeRoom, remoteRoom, homeTerrain, remoteTerrain, homeObjects = [], remoteObjects = [], spawn }) {
  const a = roomNameToXY(homeRoom);
  const b = roomNameToXY(remoteRoom);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return { reachable: false, reason: 'NOT_CARDINAL_ADJACENT', sourceCosts: [] };
  const ht = decodeTerrain(homeTerrain);
  const rt = decodeTerrain(remoteTerrain);
  const ho = buildOccupied(homeObjects);
  const ro = buildOccupied(remoteObjects);
  const homeMap = dijkstraFromGoals(ht, ho, [[spawn.x, spawn.y]]);
  const remoteSources = getSources(remoteObjects);
  const sourceMaps = remoteSources.map(src => dijkstraFromGoals(rt, ro, goalsAround(rt, ro, src, 1)));
  const sourceCosts = [];
  const matchedExitTiles = [];
  for (let si = 0; si < remoteSources.length; si++) {
    let best = INF;
    let bestPair = null;
    for (let k = 1; k <= 48; k++) {
      let hx, hy, rx, ry;
      if (dx === 1) [hx, hy, rx, ry] = [49, k, 0, k];
      else if (dx === -1) [hx, hy, rx, ry] = [0, k, 49, k];
      else if (dy === 1) [hx, hy, rx, ry] = [k, 49, k, 0];
      else [hx, hy, rx, ry] = [k, 0, k, 49];
      if (isWall(ht, hx, hy) || isWall(rt, rx, ry)) continue;
      const hd = homeMap[idx(hx, hy)];
      const rd = sourceMaps[si][idx(rx, ry)];
      if (hd >= INF || rd >= INF) continue;
      const total = hd + 2 + rd;
      if (total < best) { best = total; bestPair = { home: { x: hx, y: hy }, remote: { x: rx, y: ry } }; }
    }
    if (best < INF) {
      sourceCosts.push(Math.round(best));
      matchedExitTiles.push(bestPair);
    } else sourceCosts.push(null);
  }
  const reachable = sourceCosts.filter(v => v !== null);
  return {
    reachable: reachable.length > 0,
    sourceCount: remoteSources.length,
    reachableSources: reachable.length,
    sourceCosts,
    avgCost: reachable.length ? round1(reachable.reduce((a,b)=>a+b,0)/reachable.length) : null,
    maxCost: reachable.length ? Math.max(...reachable) : null,
    matchedExitTiles
  };
}

export function computeCategoryScores(analysis, neighborhood = null, extras = {}) {
  if (!analysis?.eligible || !analysis.best) return null;
  const b = analysis.best;
  const n = neighborhood || analysis.neighborhood || {};
  const remote = extras.remoteRoutes || {};
  const corridor = extras.corridor || {};
  const profilePenalty = Number(n.opponentStrengthPenalty || 0);
  const economyScore = clamp(
    82 + (analysis.sourceCount >= 2 ? 12 : -14) - b.avgSourceCost * 0.75 - b.controllerCost * 0.22 + Math.min((remote.reachableSources || 0) * 3, 12),
    0, 100
  );
  const blueprint = b.blueprint || {};
  const layoutScore = clamp((blueprint.completionRatio || 0) * 72 + (blueprint.roadFitRatio || 0) * 12 + Math.min((b.layout?.effectiveSlots || 0) / 130, 1) * 10 + (blueprint.complete ? 6 : 0), 0, 100);
  const perimeter = b.defensePerimeter || {};
  const safetyScore = clamp(92 + Math.min(b.nearestExitCost || 0, 80) * 0.16 - (perimeter.rampartTiles || 40) * 0.45 - (n.directHostileRooms || 0) * 18 - profilePenalty / 80 - (n.hostileReserved || 0) * 4, 0, 100);
  const empireScore = clamp(35 + Math.min(corridor.twoSourceRooms || 0, 6) * 8 + Math.min(corridor.claimableRooms || 0, 10) * 3 + Math.min(remote.reachableSources || n.adjacentRemoteSources || 0, 10) * 3 + Math.min(n.highwayAccess || 0, 4) * 3 - (n.directHostileRooms || 0) * 10, 0, 100);
  const composite = economyScore * 0.30 + layoutScore * 0.30 + safetyScore * 0.24 + empireScore * 0.16;
  return { economyScore: round1(economyScore), layoutScore: round1(layoutScore), safetyScore: round1(safetyScore), empireScore: round1(empireScore), compositeScore: round1(composite) };
}

function sideSegments(flags) {
  let segments = 0;
  let tiles = 0;
  let inRun = false;
  for (const open of flags) {
    if (open) {
      tiles++;
      if (!inRun) segments++;
      inRun = true;
    } else {
      inRun = false;
    }
  }
  return { tiles, segments };
}

function borderExitStats(terrain) {
  const top = [];
  const bottom = [];
  const left = [];
  const right = [];
  for (let x = 1; x <= 48; x++) {
    top.push(!isWall(terrain, x, 0));
    bottom.push(!isWall(terrain, x, 49));
  }
  for (let y = 1; y <= 48; y++) {
    left.push(!isWall(terrain, 0, y));
    right.push(!isWall(terrain, 49, y));
  }
  const detail = {
    top: sideSegments(top),
    right: sideSegments(right),
    bottom: sideSegments(bottom),
    left: sideSegments(left)
  };
  const activeSides = Object.values(detail).filter(v => v.tiles > 0).length;
  const tiles = Object.values(detail).reduce((a, v) => a + v.tiles, 0);
  const segments = Object.values(detail).reduce((a, v) => a + v.segments, 0);
  return { sides: activeSides, tiles, segments, detail };
}

function borderGoals(terrain, occupied) {
  const goals = [];
  const seen = new Set();
  const add = (x, y) => {
    const i = idx(x, y);
    if (seen.has(i) || isWall(terrain, x, y) || occupied.has(i)) return;
    seen.add(i);
    goals.push([x, y]);
  };
  for (let x = 1; x <= 48; x++) { add(x, 0); add(x, 49); }
  for (let y = 1; y <= 48; y++) { add(0, y); add(49, y); }
  return goals;
}

function getController(objects) {
  return objects.find(o => o.type === 'controller');
}

function getSources(objects) {
  return objects.filter(o => o.type === 'source');
}

function getMineral(objects) {
  return objects.find(o => o.type === 'mineral');
}

function statusBlocksRoom(roomStatus) {
  const s = String(roomStatus || '').toLowerCase();
  return s === 'closed' || s === 'out of borders' || s === 'out_of_borders' || s === 'out-of-borders';
}

function controllerEligibility(controller, myUserId) {
  if (!controller) return { eligible: false, reason: 'NO_CONTROLLER' };
  if (controller.user && controller.user !== myUserId) return { eligible: false, reason: 'OWNED_BY_OTHER' };
  if (controller.level > 0 && controller.user !== myUserId) return { eligible: false, reason: 'CLAIMED' };
  if (controller.reservation?.user && controller.reservation.user !== myUserId) {
    return { eligible: false, reason: 'RESERVED_BY_OTHER' };
  }
  return { eligible: true, reason: null };
}

export function summarizeRoom({ roomName, objects = [], roomStatus = null, myUserId = null, valid = true, users = {} }) {
  const controller = getController(objects);
  const sources = getSources(objects);
  const sourceCount = sources.length;
  const ownerId = controller?.user || null;
  const reservationId = controller?.reservation?.user || null;
  const ownerName = ownerId && users?.[ownerId]?.username ? users[ownerId].username : null;
  const reservationName = reservationId && users?.[reservationId]?.username ? users[reservationId].username : null;
  const ownedByMe = Boolean(ownerId && ownerId === myUserId);
  const ownedByOther = Boolean(ownerId && ownerId !== myUserId);
  const reservedByMe = Boolean(reservationId && reservationId === myUserId);
  const reservedByOther = Boolean(reservationId && reservationId !== myUserId);
  const blockedStatus = statusBlocksRoom(roomStatus);
  const claimable = Boolean(valid && controller && !blockedStatus && !ownedByOther && !reservedByOther && !ownedByMe);
  const keeperRoom = Boolean(valid && !controller && sourceCount >= 3);
  const highwayRoom = Boolean(valid && !controller && sourceCount === 0);
  const controllerlessResourceRoom = Boolean(valid && !controller && sourceCount > 0 && sourceCount < 3);

  let kind = 'neutral';
  if (!valid) kind = 'invalid';
  else if (blockedStatus) kind = 'closed';
  else if (ownedByMe) kind = 'owned-by-me';
  else if (ownedByOther) kind = 'owned-by-other';
  else if (reservedByOther) kind = 'reserved-by-other';
  else if (reservedByMe) kind = 'reserved-by-me';
  else if (keeperRoom) kind = 'source-keeper';
  else if (highwayRoom) kind = 'highway';
  else if (!controller) kind = 'controllerless';
  else if (claimable) kind = 'claimable';

  return {
    roomName,
    valid,
    roomStatus,
    kind,
    sourceCount,
    claimable,
    keeperRoom,
    highwayRoom,
    controllerlessResourceRoom,
    ownedByMe,
    ownedByOther,
    reservedByMe,
    reservedByOther,
    ownerId,
    ownerName,
    reservationId,
    reservationName,
    controller: controller ? {
      x: controller.x,
      y: controller.y,
      level: controller.level || 0,
      owner: ownerId,
      reservation: controller.reservation || null
    } : null
  };
}

export function evaluateNeighborhood(roomName, summaries, radius = 2, opponentProfiles = new Map()) {
  const center = roomNameToXY(roomName);
  let score = 0;
  let adjacentRemoteSources = 0;
  let expansionPotential = 0;
  let hostileOwned = 0;
  let hostileReserved = 0;
  let keeperPressure = 0;
  let highwayAccess = 0;
  let friendlySupport = 0;
  let directHostileRooms = 0;
  let directReservedRooms = 0;
  let opponentStrengthPenalty = 0;
  const details = [];

  const profileFor = id => opponentProfiles instanceof Map ? opponentProfiles.get(id) : opponentProfiles?.[id];

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (!dx && !dy) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (distance > radius) continue;
      const name = xyToRoomName(center.x + dx, center.y + dy);
      const s = summaries instanceof Map ? summaries.get(name) : summaries?.[name];
      if (!s || s.valid === false) continue;
      const weight = distance === 1 ? 1 : distance === 2 ? 0.48 : 0.27;
      let contribution = 0;
      let strengthPenalty = 0;

      if (s.ownedByOther) {
        hostileOwned += weight;
        if (distance === 1) directHostileRooms++;
        const profile = profileFor(s.ownerId) || {};
        const localRcl = Number(s.controller?.level || 0);
        const maxRcl = Number(profile.maxRcl || localRcl || 0);
        const roomCount = Number(profile.roomCount || 0);
        const activityObserved = Boolean(profile.activity?.observed);
        const base = distance === 1 ? 1050 : distance === 2 ? 430 : 210;
        strengthPenalty = (maxRcl * 92 + Math.min(roomCount, 12) * 58 + (activityObserved ? 170 : 0)) * weight;
        contribution -= base + strengthPenalty;
        opponentStrengthPenalty += strengthPenalty;
      } else if (s.reservedByOther) {
        hostileReserved += weight;
        if (distance === 1) directReservedRooms++;
        const profile = profileFor(s.reservationId) || {};
        const roomCount = Number(profile.roomCount || 0);
        const base = distance === 1 ? 520 : distance === 2 ? 220 : 110;
        strengthPenalty = Math.min(roomCount, 10) * 24 * weight;
        contribution -= base + strengthPenalty;
        opponentStrengthPenalty += strengthPenalty;
      } else if (s.ownedByMe) {
        friendlySupport += weight;
        contribution += 110 * weight;
      } else if (s.keeperRoom) {
        keeperPressure += weight;
        contribution -= 135 * weight;
      } else if (s.highwayRoom) {
        highwayAccess += weight;
        contribution += 38 * weight;
      } else if (s.claimable) {
        if (distance === 1) {
          adjacentRemoteSources += s.sourceCount;
          contribution += s.sourceCount * 165;
        } else {
          contribution += s.sourceCount * 50 * weight;
        }
        if (s.sourceCount >= 2) {
          expansionPotential += weight;
          contribution += 145 * weight;
        }
      }

      score += contribution;
      if (Math.abs(contribution) >= 35) {
        const profileId = s.ownerId || s.reservationId;
        const profile = profileId ? profileFor(profileId) : null;
        details.push({
          room: name,
          distance,
          kind: s.kind,
          sources: s.sourceCount,
          owner: s.ownerName || s.reservationName || null,
          rcl: s.controller?.level || 0,
          opponentRoomCount: profile?.roomCount ?? null,
          opponentMaxRcl: profile?.maxRcl ?? null,
          activityObserved: profile?.activity?.observed ?? null,
          strengthPenalty: round1(strengthPenalty),
          contribution: round1(contribution)
        });
      }
    }
  }

  details.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return {
    radius,
    score: round1(score),
    adjacentRemoteSources,
    expansionPotential: round1(expansionPotential),
    hostileOwned: round1(hostileOwned),
    hostileReserved: round1(hostileReserved),
    directHostileRooms,
    directReservedRooms,
    opponentStrengthPenalty: round1(opponentStrengthPenalty),
    keeperPressure: round1(keeperPressure),
    highwayAccess: round1(highwayAccess),
    friendlySupport: round1(friendlySupport),
    details: details.slice(0, 20)
  };
}

export function applyNeighborhoodScore(analysis, neighborhood) {
  if (!analysis?.eligible) return analysis;
  const strategicScore = round1((analysis.baseRoomScore ?? analysis.roomScore ?? 0) + (neighborhood?.score || 0));
  const next = {
    ...analysis,
    neighborhood,
    strategicScore,
    roomScore: strategicScore
  };
  next.categoryScores = computeCategoryScores(next, neighborhood);
  return next;
}

export function analyzeRoom({ roomName, encodedTerrain, objects, roomStatus = null, myUserId = null, topN = 10 }) {
  const terrain = decodeTerrain(encodedTerrain);
  const controller = getController(objects);
  const sources = getSources(objects);
  const mineral = getMineral(objects);
  const eligibility = controllerEligibility(controller, myUserId);

  if (statusBlocksRoom(roomStatus)) {
    return { roomName, eligible: false, reason: 'ROOM_UNAVAILABLE', sourceCount: sources.length, roomStatus, candidates: [] };
  }
  if (!eligibility.eligible) {
    return { roomName, eligible: false, reason: eligibility.reason, sourceCount: sources.length, roomStatus, candidates: [] };
  }
  if (!sources.length) {
    return { roomName, eligible: false, reason: 'NO_SOURCES', sourceCount: 0, roomStatus, candidates: [] };
  }

  const occupied = buildOccupied(objects);
  const sourceMaps = sources.map(source => dijkstraFromGoals(terrain, occupied, goalsAround(terrain, occupied, source, 1)));
  const controllerMap = dijkstraFromGoals(terrain, occupied, goalsAround(terrain, occupied, controller, 3));
  const mineralMap = mineral ? dijkstraFromGoals(terrain, occupied, goalsAround(terrain, occupied, mineral, 1)) : null;
  const exits = borderExitStats(terrain);
  const exitGoals = borderGoals(terrain, occupied);
  const exitMap = exitGoals.length ? dijkstraFromGoals(terrain, occupied, exitGoals) : null;
  const sourceAccessSlots = sources.map(source => objectAccessSlots(terrain, occupied, source, 1));
  const controllerAccessSlots = objectAccessSlots(terrain, occupied, controller, 3);
  const candidates = [];

  for (let y = 4; y <= 45; y++) {
    for (let x = 4; x <= 45; x++) {
      const i = idx(x, y);
      if (isWall(terrain, x, y) || occupied.has(i)) continue;

      const adjacent = adjacentOpenCount(terrain, occupied, x, y);
      if (adjacent < 5) continue;

      const sourceCosts = sourceMaps.map(m => m[i]);
      const controllerCost = controllerMap[i];
      if (sourceCosts.some(v => v >= INF) || controllerCost >= INF) continue;

      const near = areaStats(terrain, occupied, x, y, 2);
      const medium = areaStats(terrain, occupied, x, y, 5);
      const large = areaStats(terrain, occupied, x, y, 7);
      const core = coreFit(terrain, occupied, x, y);
      const layout = layoutStats(terrain, occupied, x, y);
      if (medium.ratio < 0.60 || core.ratio < 0.62 || layout.capacityRatio < 0.68) continue;

      const avgSource = sourceCosts.reduce((a, b) => a + b, 0) / sourceCosts.length;
      const maxSource = Math.max(...sourceCosts);
      const minSource = Math.min(...sourceCosts);
      const sourceSpread = maxSource - minSource;
      const edge = Math.min(x, y, 49 - x, 49 - y);
      const swampHere = isSwamp(terrain, x, y);
      const exitCostRaw = exitMap ? exitMap[i] : INF;
      const exitCost = exitCostRaw >= INF ? null : Math.round(exitCostRaw);
      const mineralCostRaw = mineralMap ? mineralMap[i] : null;
      const mineralCost = mineralCostRaw !== null && mineralCostRaw < INF ? Math.round(mineralCostRaw) : null;

      const defenseContribution = exits.sides === 0
        ? -700
        : clamp((Math.min(exitCost ?? 0, 90) * 3.2) - exits.tiles * 1.4 - exits.segments * 26 - exits.sides * 18, -650, 500);

      const layoutContribution =
        Math.min(layout.capacityRatio, 1.1) * 540 +
        Math.min(layout.connectedOpen9 / 170, 1) * 260 +
        (layout.labReady ? 190 : -110) +
        (layout.hubReady ? 100 : -80);

      const scoreBreakdown = {
        baseline: 10000,
        sourceCount: sources.length >= 2 ? 1500 : 0,
        sourceLogistics: -avgSource * 16 - maxSource * 6,
        sourceBalance: -sourceSpread * 3,
        controllerLogistics: -controllerCost * 7,
        sourceAccess: sourceAccessSlots.reduce((a, b) => a + b, 0) * 18 + Math.min(...sourceAccessSlots) * 22,
        controllerAccess: Math.min(controllerAccessSlots, 40) * 3,
        openSpace: near.passable * 7 + medium.passable * 2.2 + large.passable * 0.55,
        coreFit: core.fit * 25,
        layoutHeadroom: layoutContribution,
        swampPenalty: -medium.swamp * 4.5 - large.swamp * 1.6,
        edgeSafety: Math.min(edge, 14) * 9,
        spawnMobility: adjacent * 16,
        spawnTerrain: swampHere ? -180 : 60,
        defense: defenseContribution,
        mineralLogistics: mineralCost === null ? 0 : -mineralCost * 0.35
      };

      const score = Object.values(scoreBreakdown).reduce((a, b) => a + b, 0);
      candidates.push({
        x, y,
        score: round1(score),
        terrain: swampHere ? 'swamp' : 'plain',
        sourceCosts: sourceCosts.map(v => Math.round(v)),
        avgSourceCost: round1(avgSource),
        maxSourceCost: Math.round(maxSource),
        sourceSpread: Math.round(sourceSpread),
        sourceAccessSlots,
        controllerCost: Math.round(controllerCost),
        controllerAccessSlots,
        mineralCost,
        adjacentOpen: adjacent,
        edgeDistance: edge,
        nearestExitCost: exitCost,
        exitSides: exits.sides,
        exitTiles: exits.tiles,
        exitSegments: exits.segments,
        nearOpenRatio: round3(near.ratio),
        mediumOpenRatio: round3(medium.ratio),
        largeOpenRatio: round3(large.ratio),
        coreFit: core.fit,
        coreTotal: core.total,
        swamp5: medium.swamp,
        layout,
        scoreBreakdown: Object.fromEntries(Object.entries(scoreBreakdown).map(([k, v]) => [k, round1(v)]))
      });
    }
  }

  candidates.sort((a, b) =>
    b.score - a.score ||
    b.layout.effectiveSlots - a.layout.effectiveSlots ||
    a.maxSourceCost - b.maxSourceCost ||
    a.controllerCost - b.controllerCost
  );

  // v3 deep local-base pass: expensive blueprint/perimeter checks only for the
  // strongest tile candidates, not every traversable tile in the room.
  const deepTileCount = Math.min(candidates.length, Math.max(topN, 12));
  for (const c of candidates.slice(0, deepTileCount)) {
    const blueprint = simulateRcl8BlueprintFromDecoded(terrain, occupied, c.x, c.y);
    const defensePerimeter = estimateDefensePerimeterFromDecoded(terrain, occupied, c.x, c.y);
    const blueprintContribution = (blueprint.score - 72) * 10 + (blueprint.complete ? 180 : -120);
    const perimeterContribution = clamp(260 - defensePerimeter.rampartTiles * 5.2 + defensePerimeter.chokepointScore * 1.8 - defensePerimeter.objectGaps * 35, -420, 420);
    c.blueprint = blueprint;
    c.defensePerimeter = defensePerimeter;
    c.scoreBreakdown.rcl8Blueprint = round1(blueprintContribution);
    c.scoreBreakdown.defensePerimeter = round1(perimeterContribution);
    c.score = round1(c.score + blueprintContribution + perimeterContribution);
  }

  candidates.sort((a, b) =>
    b.score - a.score ||
    Number(b.blueprint?.complete) - Number(a.blueprint?.complete) ||
    b.layout.effectiveSlots - a.layout.effectiveSlots ||
    a.maxSourceCost - b.maxSourceCost ||
    a.controllerCost - b.controllerCost
  );
  const best = candidates[0] || null;
  const baseRoomScore = best ? best.score + (sources.length >= 2 ? 700 : -950) : -Infinity;

  return {
    roomName,
    eligible: Boolean(best),
    reason: best ? null : 'NO_VALID_SPAWN_TILE',
    roomStatus,
    sourceCount: sources.length,
    controller: controller ? { x: controller.x, y: controller.y, owner: controller.user || null, reservation: controller.reservation || null } : null,
    sources: sources.map((s, i) => ({ x: s.x, y: s.y, id: s._id || null, accessSlots: sourceAccessSlots[i] })),
    mineral: mineral ? { x: mineral.x, y: mineral.y, id: mineral._id || null } : null,
    roomMetrics: {
      exits,
      controllerAccessSlots,
      sourceAccessSlots
    },
    baseRoomScore: Number.isFinite(baseRoomScore) ? round1(baseRoomScore) : null,
    strategicScore: Number.isFinite(baseRoomScore) ? round1(baseRoomScore) : null,
    roomScore: Number.isFinite(baseRoomScore) ? round1(baseRoomScore) : null,
    best,
    categoryScores: best ? computeCategoryScores({ eligible: true, sourceCount: sources.length, best, baseRoomScore }) : null,
    candidates: candidates.slice(0, topN)
  };
}

export function renderAscii({ encodedTerrain, objects, best, candidates = [] }) {
  const terrain = decodeTerrain(encodedTerrain);
  const marks = new Map();
  for (const o of objects) {
    if (!Number.isInteger(o.x) || !Number.isInteger(o.y)) continue;
    if (o.type === 'source') marks.set(idx(o.x, o.y), 'S');
    else if (o.type === 'controller') marks.set(idx(o.x, o.y), 'C');
    else if (o.type === 'mineral') marks.set(idx(o.x, o.y), 'M');
  }
  candidates.slice(0, 9).forEach((c, i) => marks.set(idx(c.x, c.y), String(i + 1)));
  if (best) marks.set(idx(best.x, best.y), 'X');

  const lines = [];
  lines.push('Legend: # wall, ~ swamp, . plain, S source, C controller, M mineral, X best spawn, 2-9 alternatives');
  lines.push('   00000000001111111111222222222233333333334444444444');
  lines.push('   01234567890123456789012345678901234567890123456789');
  for (let y = 0; y < ROOM_SIZE; y++) {
    let row = String(y).padStart(2, '0') + ' ';
    for (let x = 0; x < ROOM_SIZE; x++) {
      const mark = marks.get(idx(x, y));
      if (mark) row += mark;
      else if (isWall(terrain, x, y)) row += '#';
      else if (isSwamp(terrain, x, y)) row += '~';
      else row += '.';
    }
    lines.push(row);
  }
  return lines.join('\n');
}
