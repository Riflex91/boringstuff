import { ScreepsHttpClient } from './screeps-client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adjacentRemoteRouteCost,
  analyzeRoom,
  applyNeighborhoodScore,
  computeCategoryScores,
  evaluateExpansionCorridor,
  evaluateNeighborhood,
  renderAscii,
  roomNameToXY,
  roomWithinWorldDimensions,
  roomsAround,
  roomsAroundSet,
  summarizeRoom,
  xyToRoomName
} from './spawn-planner-core.mjs';
import { normalizeRoomStatusResponse, verifyInitialSpawnTarget } from './spawn-safety.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_DIR = process.env.SCREEPS_LOG_DIR || DEFAULT_LOG_DIR;
const DEFAULT_SERVER = process.env.SCREEPS_SERVER || 'newbieland';
const CACHE_VERSION = 4;
const TOOL_VERSION = '0.2.6-node24';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function usage(exitCode = 0) {
  console.log(`
ChatGPT Screeps Strategic Initial Spawn Planner v${TOOL_VERSION}

Plan one or more rooms:
  npm run spawn:plan -- W3N7
  npm run spawn:plan -- W3N7 W4N7 W5N7

Scan a square around a room:
  npm run spawn:plan -- --around W3N7 --radius 5
  npm run spawn:plan -- --around W3N7 --radius 15

Automatically place the first spawn at the best scored tile:
  npm run spawn:auto -- W8N6 --name Spawn1
  npm run spawn:auto -- --around W3N7 --radius 5 --name Spawn1

Options:
  --around ROOM          Generate candidate room names around ROOM.
  --radius N             Scan radius for --around (default: 2, max: 15).
  --strategic-radius N   Neighbor/expansion evaluation radius (default: 2, max: 3).
  --top N                Tile candidates kept per room (default: 10, max: 50).
  --top-rooms N          Ranked room results printed at the end (default: 10, max: 50).
  --deep-top N           Fresh deep re-analysis of the best N rooms (default: 10, max: 20).
  --from-report PATH     Re-analyze rankings from an earlier JSON report. Use 'latest' for newest.
  --no-deep              Skip the v3 deep pass (not allowed with --place).
  --concurrency N        Concurrent room metadata requests (default: 4, max: 8).
  --delay-ms N           Small delay after each metadata fetch (default: 35).
  --cache-hours N        Reuse room data for N hours (default: 6; 0 disables cache).
  --refresh              Ignore cached room data for this run.
  --verbose              Print every rejected room, even in very large scans.
  --name NAME            Spawn name used with --place (default: Spawn1).
  --server NAME          Server config key from screeps.json (default: newbieland).
  --branch NAME          World code branch to activate after placement (default: chatgpt).
  --place                Place the first spawn after analysis. spawn:auto supplies this.
  --help                 Show this help.

Safety:
  spawn:plan is read-only. spawn:auto forces fresh data and still refuses placement
  unless the read-only final verifier passes world status, room status, ownership, reservation, exact tile, and spawn-name checks.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = {
    rooms: [], around: null, radius: 2, strategicRadius: 2, top: 10, topRooms: 10,
    deepTop: 10, fromReport: null, deep: true,
    concurrency: 4, delayMs: 35, cacheHours: 6, refresh: false, verbose: false,
    name: 'Spawn1', server: DEFAULT_SERVER, branch: 'chatgpt', place: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage(0);
    else if (a === '--place') out.place = true;
    else if (a === '--refresh') out.refresh = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--no-deep') out.deep = false;
    else if (a === '--around') out.around = argv[++i];
    else if (a === '--radius') out.radius = Number(argv[++i]);
    else if (a === '--strategic-radius') out.strategicRadius = Number(argv[++i]);
    else if (a === '--top') out.top = Number(argv[++i]);
    else if (a === '--top-rooms') out.topRooms = Number(argv[++i]);
    else if (a === '--deep-top') out.deepTop = Number(argv[++i]);
    else if (a === '--from-report') out.fromReport = argv[++i];
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--delay-ms') out.delayMs = Number(argv[++i]);
    else if (a === '--cache-hours') out.cacheHours = Number(argv[++i]);
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--server') out.server = argv[++i];
    else if (a === '--branch') out.branch = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
    else out.rooms.push(a.toUpperCase());
  }
  if (!Number.isInteger(out.radius) || out.radius < 0 || out.radius > 15) throw new Error('--radius must be an integer from 0 to 15');
  if (!Number.isInteger(out.strategicRadius) || out.strategicRadius < 1 || out.strategicRadius > 3) throw new Error('--strategic-radius must be an integer from 1 to 3');
  if (!Number.isInteger(out.top) || out.top < 1 || out.top > 50) throw new Error('--top must be an integer from 1 to 50');
  if (!Number.isInteger(out.topRooms) || out.topRooms < 1 || out.topRooms > 50) throw new Error('--top-rooms must be an integer from 1 to 50');
  if (!Number.isInteger(out.deepTop) || out.deepTop < 1 || out.deepTop > 20) throw new Error('--deep-top must be an integer from 1 to 20');
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 8) throw new Error('--concurrency must be an integer from 1 to 8');
  if (!Number.isInteger(out.delayMs) || out.delayMs < 0 || out.delayMs > 2000) throw new Error('--delay-ms must be an integer from 0 to 2000');
  if (!Number.isFinite(out.cacheHours) || out.cacheHours < 0 || out.cacheHours > 168) throw new Error('--cache-hours must be from 0 to 168');
  if (out.around) out.rooms.push(...roomsAround(out.around.toUpperCase(), out.radius));
  out.rooms = [...new Set(out.rooms)];
  if (!out.rooms.length && !out.fromReport) throw new Error('Provide at least one room, use --around ROOM, or use --from-report latest');
  if (!/^[A-Za-z0-9_\-]{1,100}$/.test(out.name)) throw new Error('Spawn name must be 1-100 characters and use letters, digits, _, or -');
  if (!/^[A-Za-z0-9_\-]{1,100}$/.test(out.branch)) throw new Error('Branch name must be 1-100 characters and use letters, digits, _, or -');
  if (out.place) {
    if (!out.deep) throw new Error('--place requires the v3 deep pass; remove --no-deep');
    out.refresh = true;
    out.cacheHours = 0;
    out.deepTop = Math.max(1, out.deepTop);
  }
  return out;
}

function stampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveReportPath(value) {
  if (!value) return null;
  if (value !== 'latest') return path.resolve(value);
  if (!fs.existsSync(LOG_DIR)) throw new Error(`No log directory exists yet: ${LOG_DIR}`);
  const candidates = fs.readdirSync(LOG_DIR)
    .filter(name => /^initial-spawn-plan-.*\.json$/i.test(name))
    .map(name => ({ name, path: path.join(LOG_DIR, name), mtime: fs.statSync(path.join(LOG_DIR, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) throw new Error(`No initial-spawn-plan-*.json report found in ${LOG_DIR}`);
  return candidates[0].path;
}

function roomsFromReport(file, count) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rankings = Array.isArray(report?.rankings) ? report.rankings : [];
  const rooms = rankings.map(v => v?.room).filter(v => typeof v === 'string').slice(0, count);
  if (!rooms.length && report?.selected?.room) rooms.push(report.selected.room);
  if (!rooms.length) throw new Error(`Report contains no ranked room names: ${file}`);
  return { rooms: [...new Set(rooms.map(v => v.toUpperCase()))], report };
}

function safeWriteJson(name, data) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const p = path.join(LOG_DIR, name);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
  return p;
}

function cacheFile(server) {
  return path.join(LOG_DIR, `spawn-planner-cache-v3-${server.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
}

function loadCache(server) {
  const p = cacheFile(server);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (data?.version === CACHE_VERSION && data?.server === server && data?.rooms && typeof data.rooms === 'object') return data;
  } catch {}
  return { version: CACHE_VERSION, server, updatedAt: null, rooms: {} };
}

function saveCache(cache) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  cache.updatedAt = new Date().toISOString();
  const p = cacheFile(cache.server);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
  fs.renameSync(tmp, p);
}

function fresh(timestamp, hours, refresh) {
  if (refresh || !timestamp || hours <= 0) return false;
  const age = Date.now() - Date.parse(timestamp);
  return Number.isFinite(age) && age >= 0 && age <= hours * 3600_000;
}

function isUnavailableStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'closed' || s === 'out of borders' || s === 'out_of_borders' || s === 'out-of-borders';
}

function isInvalidRoomError(err) {
  return /invalid room|out of borders|out-of-borders/i.test(String(err?.message || err));
}

function isUnsupportedEndpoint(err) {
  return /\(404\)|not found|cannot get|unknown endpoint|unknown route|unknown request|unsupported|not implemented/i.test(String(err?.message || err));
}

function extractRoomNames(resp) {
  const candidate = resp?.rooms ?? resp?.list ?? resp?.data;
  if (Array.isArray(candidate)) {
    const names = candidate.map(v => typeof v === 'string' ? v : (v?._id || v?.room || v?.name)).filter(Boolean);
    return [...new Set(names.map(String))];
  }
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const keys = Object.keys(candidate).filter(k => /^[WE]\d+[NS]\d+$/.test(k));
    if (keys.length) return keys;
  }
  if (Array.isArray(resp)) return resp.filter(v => typeof v === 'string');
  return [];
}

async function discoverWorld(api) {
  const notes = [];
  try {
    const resp = await api.gameRooms();
    const names = extractRoomNames(resp);
    if (names.length) {
      return { mode: 'exact-room-list', roomSet: new Set(names), roomCount: names.length, notes };
    }
    notes.push('/api/game/rooms returned no recognizable room list');
  } catch (err) {
    notes.push(`/api/game/rooms unavailable: ${err.message}`);
  }

  try {
    const resp = await api.gameWorldSize();
    const width = Number(resp?.width ?? resp?.size ?? resp?.worldSize);
    const height = Number(resp?.height ?? resp?.size ?? resp?.worldSize ?? width);
    if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
      return { mode: 'symmetric-world-size', width, height, notes };
    }
    notes.push('/api/game/world-size returned no usable dimensions');
  } catch (err) {
    notes.push(`/api/game/world-size unavailable: ${err.message}`);
  }
  return { mode: 'probe', notes };
}

function worldAllows(world, roomName) {
  if (world.mode === 'exact-room-list') return world.roomSet.has(roomName);
  if (world.mode === 'symmetric-world-size') return roomWithinWorldDimensions(roomName, world.width, world.height);
  return true;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

class RoomDataSource {
  constructor({ api, world, cache, args }) {
    this.api = api;
    this.world = world;
    this.cache = cache;
    this.args = args;
    this.statusCapability = 'unknown';
    this.dirty = 0;
  }

  flushMaybe(force = false) {
    if (force || this.dirty >= 20) {
      saveCache(this.cache);
      this.dirty = 0;
    }
  }

  markDirty() {
    this.dirty++;
    this.flushMaybe(false);
  }

  async getObjects(roomName) {
    const entry = this.cache.rooms[roomName] ||= {};
    if (!worldAllows(this.world, roomName)) {
      return { roomName, valid: false, reason: 'OUT_OF_BOUNDS', objects: [], users: {} };
    }
    if (fresh(entry.objectsAt, this.args.cacheHours, this.args.refresh) && Array.isArray(entry.objects)) {
      return { roomName, valid: entry.valid !== false, reason: entry.reason || null, objects: entry.objects, users: entry.users || {}, cached: true };
    }

    try {
      const resp = await this.api.gameRoomObjects(roomName);
      entry.objectsAt = new Date().toISOString();
      entry.objects = Array.isArray(resp?.objects) ? resp.objects : [];
      entry.users = resp?.users && typeof resp.users === 'object' ? resp.users : {};
      entry.valid = true;
      entry.reason = null;
      this.markDirty();
      if (this.args.delayMs) await sleep(this.args.delayMs);
      return { roomName, valid: true, reason: null, objects: entry.objects, users: entry.users };
    } catch (err) {
      if (isInvalidRoomError(err)) {
        entry.objectsAt = new Date().toISOString();
        entry.objects = [];
        entry.users = {};
        entry.valid = false;
        entry.reason = 'OUT_OF_BOUNDS';
        this.markDirty();
        return { roomName, valid: false, reason: 'OUT_OF_BOUNDS', objects: [], users: {} };
      }
      return { roomName, valid: false, reason: 'QUERY_FAILED', error: String(err?.stack || err), objects: [], users: {} };
    }
  }

  async getStatus(roomName) {
    const entry = this.cache.rooms[roomName] ||= {};
    if (fresh(entry.statusAt, this.args.cacheHours, this.args.refresh) && 'roomStatus' in entry) return entry.roomStatus;
    if (this.statusCapability === 'unsupported') return null;
    try {
      const resp = await this.api.gameRoomStatus(roomName);
      const status = normalizeRoomStatusResponse(resp);
      entry.statusAt = new Date().toISOString();
      entry.roomStatus = status;
      this.statusCapability = 'supported';
      this.markDirty();
      return status;
    } catch (err) {
      // Some private servers expose the route but return an 'invalid room' style
      // error even for otherwise valid rooms. World discovery + terrain are the
      // authoritative boundary checks, so a status-endpoint error never rejects
      // a candidate by itself.
      if (isInvalidRoomError(err) || isUnsupportedEndpoint(err)) this.statusCapability = 'unsupported';
      return null;
    }
  }

  async getTerrain(roomName) {
    const entry = this.cache.rooms[roomName] ||= {};
    if (fresh(entry.terrainAt, this.args.cacheHours, this.args.refresh) && typeof entry.terrain === 'string') {
      return { encodedTerrain: entry.terrain, cached: true };
    }
    try {
      const resp = await this.api.gameRoomTerrain(roomName);
      const encodedTerrain = resp?.terrain?.[0]?.terrain;
      if (!encodedTerrain) throw new Error(`No terrain returned for ${roomName}`);
      entry.terrainAt = new Date().toISOString();
      entry.terrain = encodedTerrain;
      entry.valid = true;
      this.markDirty();
      return { encodedTerrain };
    } catch (err) {
      if (isInvalidRoomError(err)) {
        entry.valid = false;
        entry.reason = 'OUT_OF_BOUNDS';
        this.markDirty();
        return { error: err, reason: 'OUT_OF_BOUNDS' };
      }
      return { error: err, reason: 'QUERY_FAILED' };
    }
  }
}

function precheckSummary(summary) {
  if (!summary.valid) return summary.kind === 'invalid' ? 'OUT_OF_BOUNDS' : 'QUERY_FAILED';
  if (!summary.controller) return 'NO_CONTROLLER';
  if (summary.ownedByOther) return 'OWNED_BY_OTHER';
  if (summary.ownedByMe) return 'OWNED_BY_ME';
  if (summary.reservedByOther) return 'RESERVED_BY_OTHER';
  if (!summary.sourceCount) return 'NO_SOURCES';
  return null;
}

function printRoomResult(r, verbose) {
  const a = r.analysis;
  if (!a.eligible) {
    if (verbose) console.log(`${a.roomName}: NOT ELIGIBLE (${a.reason}), sources=${a.sourceCount ?? 0}, status=${a.roomStatus ?? 'unknown'}`);
    return;
  }
  const b = a.best;
  const n = a.neighborhood || {};
  console.log(`${a.roomName}: final=${a.strategicScore} base=${a.baseRoomScore} neighbor=${n.score ?? 0} sources=${a.sourceCount} status=${a.roomStatus ?? 'normal-assumed'} best=(${b.x},${b.y})`);
  console.log(`  sourceCosts=${b.sourceCosts.join(',')} controller=${b.controllerCost} exit=${b.nearestExitCost ?? 'n/a'} layoutSlots=${b.layout.effectiveSlots} blueprint=${b.blueprint?.complete ? 'complete' : 'partial'} perimeter=${b.defensePerimeter?.rampartTiles ?? 'n/a'} open5=${Math.round(b.mediumOpenRatio * 100)}%`);
  console.log(`  strategy: adjacentRemoteSources=${n.adjacentRemoteSources ?? 0} expansion=${n.expansionPotential ?? 0} directHostiles=${n.directHostileRooms ?? 0} hostileOwned=${n.hostileOwned ?? 0} hostileReserved=${n.hostileReserved ?? 0} opponentPenalty=${n.opponentStrengthPenalty ?? 0}`);
  if (a.categoryScores) console.log(`  scores: economy=${a.categoryScores.economyScore} layout=${a.categoryScores.layoutScore} safety=${a.categoryScores.safetyScore} empire=${a.categoryScores.empireScore}`);
}

function rejectedCounts(results) {
  const counts = {};
  for (const r of results) {
    if (r.analysis?.eligible) continue;
    const reason = r.analysis?.reason || 'UNKNOWN';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function printRankings(eligible, topRooms) {
  console.log(`\nTOP ${Math.min(topRooms, eligible.length)} STRATEGIC START ROOMS`);
  eligible.slice(0, topRooms).forEach((r, i) => {
    const a = r.analysis;
    const b = a.best;
    const n = a.neighborhood || {};
    const c = a.categoryScores || {};
    console.log(`${String(i + 1).padStart(2)}. ${r.roomName} final=${a.strategicScore} base=${a.baseRoomScore} neighbor=${n.score ?? 0} spawn=(${b.x},${b.y}) src=${a.sourceCount} remote=${a.deepAnalysis?.remoteRoutes?.reachableSources ?? n.adjacentRemoteSources ?? 0} E/L/S/I=${c.economyScore ?? '-'}\/${c.layoutScore ?? '-'}\/${c.safetyScore ?? '-'}\/${c.empireScore ?? '-'}`);
  });
}

function countUserRooms(resp) {
  const arrays = [];
  if (Array.isArray(resp?.rooms)) arrays.push(resp.rooms);
  if (Array.isArray(resp?.list)) arrays.push(resp.list);
  if (resp?.shards && typeof resp.shards === 'object') {
    for (const v of Object.values(resp.shards)) if (Array.isArray(v)) arrays.push(v);
  }
  return new Set(arrays.flat().filter(v => typeof v === 'string')).size;
}

function activitySignal(resp) {
  const stats = resp?.stats && typeof resp.stats === 'object' ? resp.stats : {};
  const values = Object.values(stats).map(Number).filter(Number.isFinite);
  const positive = values.filter(v => v > 0);
  return {
    observed: positive.length > 0,
    positiveStatCount: positive.length,
    totalMagnitude: Math.round(positive.reduce((a, b) => a + b, 0) * 1000) / 1000
  };
}

async function fetchFreshMeta(api, world, roomName, myUserId) {
  if (!worldAllows(world, roomName)) {
    return { roomName, valid: false, reason: 'OUT_OF_BOUNDS', objects: [], users: {}, summary: summarizeRoom({ roomName, valid: false, myUserId }) };
  }
  try {
    const resp = await api.gameRoomObjects(roomName);
    const objects = Array.isArray(resp?.objects) ? resp.objects : [];
    const users = resp?.users && typeof resp.users === 'object' ? resp.users : {};
    const summary = summarizeRoom({ roomName, objects, users, myUserId, valid: true, roomStatus: null });
    return { roomName, valid: true, reason: null, objects, users, summary };
  } catch (err) {
    if (isInvalidRoomError(err)) return { roomName, valid: false, reason: 'OUT_OF_BOUNDS', objects: [], users: {}, summary: summarizeRoom({ roomName, valid: false, myUserId }) };
    return { roomName, valid: false, reason: 'QUERY_FAILED', error: String(err?.message || err), objects: [], users: {}, summary: summarizeRoom({ roomName, valid: false, myUserId }) };
  }
}

async function verifyRoomStatusFresh(api, roomName) {
  try {
    const raw = await api.gameRoomStatus(roomName);
    return { attempted: true, supported: true, status: normalizeRoomStatusResponse(raw), raw };
  } catch (err) {
    return { attempted: true, supported: false, status: null, error: String(err?.message || err) };
  }
}

async function buildOpponentProfiles(api, summaries, myUserId, concurrency = 4) {
  const ids = new Set();
  const observedRcl = new Map();
  const names = new Map();
  for (const s of summaries.values()) {
    if (s?.ownerId && s.ownerId !== myUserId) {
      ids.add(s.ownerId);
      observedRcl.set(s.ownerId, Math.max(observedRcl.get(s.ownerId) || 0, Number(s.controller?.level || 0)));
      if (s.ownerName) names.set(s.ownerId, s.ownerName);
    }
    if (s?.reservationId && s.reservationId !== myUserId) {
      ids.add(s.reservationId);
      if (s.reservationName) names.set(s.reservationId, s.reservationName);
    }
  }
  const profiles = new Map();
  await mapLimit([...ids], Math.min(concurrency, 4), async id => {
    const profile = {
      userId: id,
      username: names.get(id) || null,
      roomCount: 0,
      maxRcl: observedRcl.get(id) || 0,
      activity: { observed: false, positiveStatCount: 0, totalMagnitude: 0 },
      evidence: { find: false, rooms: false, stats: false },
      errors: []
    };
    try {
      const found = await api.userFindById(id);
      profile.username = found?.user?.username || found?.username || profile.username;
      profile.evidence.find = true;
    } catch (err) { profile.errors.push(`find: ${err.message}`); }
    try {
      const rooms = await api.userRooms(id);
      profile.roomCount = countUserRooms(rooms);
      profile.evidence.rooms = true;
    } catch (err) { profile.errors.push(`rooms: ${err.message}`); }
    try {
      const stats = await api.userStats(id, 8);
      profile.activity = activitySignal(stats);
      profile.evidence.stats = true;
    } catch (err) { profile.errors.push(`stats: ${err.message}`); }
    profiles.set(id, profile);
    return profile;
  });
  return profiles;
}

function cardinalNeighbors(roomName) {
  const p = roomNameToXY(roomName);
  return [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => xyToRoomName(p.x + dx, p.y + dy));
}

function aggregateRemoteRoutes(roomRoutes) {
  let totalSources = 0;
  let reachableSources = 0;
  let inaccessibleSources = 0;
  const costs = [];
  let score = 0;
  for (const r of roomRoutes) {
    totalSources += r.sourceCount || 0;
    reachableSources += r.reachableSources || 0;
    inaccessibleSources += Math.max(0, (r.sourceCount || 0) - (r.reachableSources || 0));
    for (const c of r.sourceCosts || []) {
      if (c === null) { score -= 180; continue; }
      costs.push(c);
      score += Math.max(-40, 235 - c * 1.65);
    }
    if ((r.reachableSources || 0) >= 2) score += 75;
  }
  return {
    rooms: roomRoutes,
    totalSources,
    reachableSources,
    inaccessibleSources,
    avgCost: costs.length ? Math.round((costs.reduce((a,b)=>a+b,0) / costs.length) * 10) / 10 : null,
    maxCost: costs.length ? Math.max(...costs) : null,
    score: Math.round(score * 10) / 10
  };
}

async function runDeepPass({ api, world, myUserId, coarseEligible, args }) {
  const selected = coarseEligible.slice(0, Math.min(args.deepTop, coarseEligible.length));
  if (!selected.length || !args.deep) return { results: [], opponentProfiles: new Map(), context: new Map() };
  const selectedRooms = selected.map(r => r.roomName);
  const contextRooms = roomsAroundSet(selectedRooms, args.strategicRadius);
  console.log(`\nV3 DEEP PASS: fresh revalidation of ${selectedRooms.length} candidate room(s), ${contextRooms.length} context room(s).`);

  const context = new Map();
  await mapLimit(contextRooms, Math.min(args.concurrency, 5), async room => {
    const meta = await fetchFreshMeta(api, world, room, myUserId);
    context.set(room, meta);
    return meta;
  });
  const summaries = new Map([...context.entries()].map(([name, m]) => [name, m.summary]));
  const opponentProfiles = await buildOpponentProfiles(api, summaries, myUserId, args.concurrency);
  console.log(`  opponent profiles: ${opponentProfiles.size}`);

  const terrainCache = new Map();
  async function freshTerrain(room) {
    if (terrainCache.has(room)) return terrainCache.get(room);
    try {
      const resp = await api.gameRoomTerrain(room);
      const encodedTerrain = resp?.terrain?.[0]?.terrain;
      const value = encodedTerrain ? { encodedTerrain } : { error: 'NO_TERRAIN' };
      terrainCache.set(room, value);
      return value;
    } catch (err) {
      const value = { error: String(err?.message || err) };
      terrainCache.set(room, value);
      return value;
    }
  }

  const deepResults = [];
  for (let i = 0; i < selected.length; i++) {
    const coarse = selected[i];
    const room = coarse.roomName;
    const meta = context.get(room) || await fetchFreshMeta(api, world, room, myUserId);
    const statusVerification = await verifyRoomStatusFresh(api, room);
    const reason = precheckSummary(meta.summary);
    if (reason) {
      deepResults.push({ roomName: room, error: meta.error || null, analysis: { roomName: room, eligible: false, reason: `DEEP_${reason}`, sourceCount: meta.summary?.sourceCount || 0, roomStatus: statusVerification.status, statusVerification, candidates: [] } });
      continue;
    }
    if (isUnavailableStatus(statusVerification.status)) {
      deepResults.push({ roomName: room, analysis: { roomName: room, eligible: false, reason: 'DEEP_ROOM_UNAVAILABLE', sourceCount: meta.summary.sourceCount, roomStatus: statusVerification.status, statusVerification, candidates: [] } });
      continue;
    }
    const homeTerrain = await freshTerrain(room);
    if (!homeTerrain.encodedTerrain) {
      deepResults.push({ roomName: room, error: homeTerrain.error, analysis: { roomName: room, eligible: false, reason: 'DEEP_TERRAIN_FAILED', sourceCount: meta.summary.sourceCount, roomStatus: statusVerification.status, statusVerification, candidates: [] } });
      continue;
    }

    let analysis = analyzeRoom({
      roomName: room,
      encodedTerrain: homeTerrain.encodedTerrain,
      objects: meta.objects,
      roomStatus: statusVerification.status || 'normal-assumed',
      myUserId,
      topN: args.top
    });
    if (!analysis.eligible) {
      analysis.statusVerification = statusVerification;
      deepResults.push({ roomName: room, encodedTerrain: homeTerrain.encodedTerrain, objects: meta.objects, analysis });
      continue;
    }

    const neighborhood = evaluateNeighborhood(room, summaries, args.strategicRadius, opponentProfiles);
    analysis = applyNeighborhoodScore(analysis, neighborhood);
    const corridor = evaluateExpansionCorridor(room, summaries, args.strategicRadius);
    const routeRooms = [];
    for (const neighbor of cardinalNeighbors(room)) {
      const nmeta = context.get(neighbor);
      if (!nmeta?.summary?.claimable || !(nmeta.summary.sourceCount > 0)) continue;
      const remoteTerrain = await freshTerrain(neighbor);
      if (!remoteTerrain.encodedTerrain) continue;
      const route = adjacentRemoteRouteCost({
        homeRoom: room,
        remoteRoom: neighbor,
        homeTerrain: homeTerrain.encodedTerrain,
        remoteTerrain: remoteTerrain.encodedTerrain,
        homeObjects: meta.objects,
        remoteObjects: nmeta.objects,
        spawn: analysis.best
      });
      routeRooms.push({ room: neighbor, ...route });
    }
    const remoteRoutes = aggregateRemoteRoutes(routeRooms);
    const corridorContribution = corridor.score * 0.35;
    const riskAdjustedScore = Math.round((analysis.strategicScore + remoteRoutes.score + corridorContribution) * 10) / 10;
    const categoryScores = computeCategoryScores(analysis, neighborhood, { remoteRoutes, corridor });
    const coarseStrategicScore = coarse.analysis?.strategicScore ?? null;
    analysis = {
      ...analysis,
      coarseStrategicScore,
      strategicScore: riskAdjustedScore,
      roomScore: riskAdjustedScore,
      categoryScores,
      statusVerification,
      deepAnalysis: {
        version: 'risk-routing-blueprint-v3',
        freshness: 'fresh-api',
        remoteRoutes,
        expansionCorridor: corridor,
        corridorContribution: Math.round(corridorContribution * 10) / 10,
        neighborhoodScore: neighborhood.score,
        opponentStrengthPenalty: neighborhood.opponentStrengthPenalty || 0
      }
    };
    deepResults.push({ roomName: room, encodedTerrain: homeTerrain.encodedTerrain, objects: meta.objects, analysis });
    console.log(`  deep ${i + 1}/${selected.length}: ${room} final=${analysis.strategicScore} safety=${categoryScores?.safetyScore ?? 'n/a'} economy=${categoryScores?.economyScore ?? 'n/a'} layout=${categoryScores?.layoutScore ?? 'n/a'} empire=${categoryScores?.empireScore ?? 'n/a'}`);
  }
  return { results: deepResults, opponentProfiles, context };
}

async function finalPlacementVerification(api, roomName, x, y, spawnName, myUserId, branch) {
  return verifyInitialSpawnTarget({
    api,
    room: roomName,
    x,
    y,
    name: spawnName,
    myUserId,
    branch,
    requireNormalStatus: true,
    requireUniqueName: true
  });
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (err) { console.error(`Argument error: ${err.message}`); usage(2); }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  let sourceReportPath = null;
  let sourceReport = null;
  if (args.fromReport) {
    sourceReportPath = resolveReportPath(args.fromReport);
    const loaded = roomsFromReport(sourceReportPath, Math.max(args.deepTop, args.topRooms));
    args.rooms = loaded.rooms;
    sourceReport = loaded.report;
    args.refresh = true;
    args.cacheHours = 0;
    console.log(`Loaded ${args.rooms.length} candidate room(s) from report: ${sourceReportPath}`);
  }
  console.log(`Connecting using Screeps config '${args.server}'...`);
  const api = await ScreepsHttpClient.fromConfig(args.server, { app: 'chatgpt-initial-spawn-planner' });
  const me = await api.authMe();
  const myUserId = me?._id || me?.id || null;
  console.log(`Authenticated as ${me?.username || me?.email || myUserId || 'unknown user'}`);

  const world = await discoverWorld(api);
  if (world.mode === 'exact-room-list') console.log(`World discovery: exact room list (${world.roomCount} valid rooms).`);
  else if (world.mode === 'symmetric-world-size') console.log(`World discovery: ${world.width}x${world.height} room bounds from /api/game/world-size.`);
  else console.log('World discovery: no map boundary endpoint available; invalid rooms will be detected by probing.');

  const strategicRooms = roomsAroundSet(args.rooms, args.strategicRadius);
  console.log(`Requested candidates: ${args.rooms.length} room(s). Strategic context: ${strategicRooms.length} room(s), radius=${args.strategicRadius}.`);
  if (args.place) console.log('Placement mode: cache disabled; all relevant data will be fetched fresh.');
  else console.log(`Planner cache: ${args.refresh ? 'refresh forced' : `${args.cacheHours}h TTL`} | concurrency=${args.concurrency} | delay=${args.delayMs}ms`);

  const cache = loadCache(args.server);
  const source = new RoomDataSource({ api, world, cache, args });
  const metaMap = new Map();
  let metaDone = 0;
  await mapLimit(strategicRooms, args.concurrency, async room => {
    const meta = await source.getObjects(room);
    const summary = summarizeRoom({ roomName: room, objects: meta.objects, users: meta.users, myUserId, valid: meta.valid, roomStatus: null });
    if (meta.reason === 'QUERY_FAILED') summary.kind = 'query-failed';
    metaMap.set(room, { ...meta, summary });
    metaDone++;
    if (strategicRooms.length >= 100 && (metaDone % 50 === 0 || metaDone === strategicRooms.length)) {
      console.log(`  metadata ${metaDone}/${strategicRooms.length}`);
    }
    return meta;
  });
  source.flushMaybe(true);

  const requestedMeta = args.rooms.map(room => metaMap.get(room) || { roomName: room, valid: false, reason: 'NO_METADATA', objects: [], users: {}, summary: summarizeRoom({ roomName: room, valid: false }) });
  const results = [];
  const terrainTargets = [];

  for (const meta of requestedMeta) {
    const reason = meta.reason === 'QUERY_FAILED' ? 'QUERY_FAILED' : precheckSummary(meta.summary);
    if (reason) {
      results.push({
        roomName: meta.roomName,
        error: meta.error || null,
        analysis: { roomName: meta.roomName, eligible: false, reason, sourceCount: meta.summary.sourceCount || 0, roomStatus: null, candidates: [] }
      });
    } else {
      terrainTargets.push(meta);
    }
  }

  console.log(`Full terrain/layout analysis required for ${terrainTargets.length}/${args.rooms.length} requested rooms.`);
  let terrainDone = 0;
  const fullResults = await mapLimit(terrainTargets, Math.min(args.concurrency, 4), async meta => {
    const room = meta.roomName;
    const status = await source.getStatus(room);
    if (isUnavailableStatus(status)) {
      terrainDone++;
      return { roomName: room, analysis: { roomName: room, eligible: false, reason: 'ROOM_UNAVAILABLE', sourceCount: meta.summary.sourceCount, roomStatus: status, candidates: [] } };
    }
    const terrain = await source.getTerrain(room);
    terrainDone++;
    if (terrainTargets.length >= 40 && (terrainDone % 25 === 0 || terrainDone === terrainTargets.length)) {
      console.log(`  terrain/layout ${terrainDone}/${terrainTargets.length}`);
    }
    if (terrain.error) {
      return { roomName: room, error: String(terrain.error?.stack || terrain.error), analysis: { roomName: room, eligible: false, reason: terrain.reason || 'QUERY_FAILED', sourceCount: meta.summary.sourceCount, roomStatus: status, candidates: [] } };
    }
    const normalizedStatus = status || 'normal-assumed';
    let analysis = analyzeRoom({ roomName: room, encodedTerrain: terrain.encodedTerrain, objects: meta.objects, roomStatus: normalizedStatus, myUserId, topN: args.top });
    if (analysis.eligible) {
      const summaries = new Map([...metaMap.entries()].map(([name, m]) => [name, m.summary]));
      const neighborhood = evaluateNeighborhood(room, summaries, args.strategicRadius);
      analysis = applyNeighborhoodScore(analysis, neighborhood);
    }
    return { roomName: room, encodedTerrain: terrain.encodedTerrain, objects: meta.objects, analysis };
  });
  source.flushMaybe(true);
  results.push(...fullResults);

  const resultOrder = new Map(args.rooms.map((r, i) => [r, i]));
  results.sort((a, b) => resultOrder.get(a.roomName) - resultOrder.get(b.roomName));
  const verbose = args.verbose || args.rooms.length <= 200;
  for (const r of results) printRoomResult(r, verbose);

  const coarseEligible = results.filter(r => r.analysis?.eligible).sort((a, b) =>
    b.analysis.strategicScore - a.analysis.strategicScore ||
    b.analysis.baseRoomScore - a.analysis.baseRoomScore
  );

  let deepEvidence = { results: [], opponentProfiles: new Map(), context: new Map() };
  let eligible = coarseEligible;
  if (args.deep && coarseEligible.length) {
    deepEvidence = await runDeepPass({ api, world, myUserId, coarseEligible, args });
    const deepByRoom = new Map(deepEvidence.results.map(r => [r.roomName, r]));
    for (let i = 0; i < results.length; i++) {
      const replacement = deepByRoom.get(results[i].roomName);
      if (replacement) results[i] = replacement;
    }
    eligible = deepEvidence.results.filter(r => r.analysis?.eligible).sort((a, b) =>
      b.analysis.strategicScore - a.analysis.strategicScore ||
      (b.analysis.categoryScores?.compositeScore || 0) - (a.analysis.categoryScores?.compositeScore || 0) ||
      b.analysis.baseRoomScore - a.analysis.baseRoomScore
    );
    console.log(`\nFinal ranking is based on the ${deepEvidence.results.length} freshly deep-analyzed candidate(s).`);
  }
  const best = eligible[0] || null;
  printRankings(eligible, args.topRooms);

  const rejects = rejectedCounts(results);
  console.log(`\nRejected-room summary: ${Object.entries(rejects).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);

  const report = {
    toolVersion: TOOL_VERSION,
    scoreModel: 'risk-routing-blueprint-v3.1-safety',
    createdAt: new Date().toISOString(),
    server: args.server,
    branch: args.branch,
    worldDiscovery: {
      mode: world.mode,
      roomCount: world.roomCount || null,
      width: world.width || null,
      height: world.height || null,
      notes: world.notes || []
    },
    options: {
      radius: args.radius,
      strategicRadius: args.strategicRadius,
      top: args.top,
      topRooms: args.topRooms,
      deepTop: args.deepTop,
      deep: args.deep,
      fromReport: args.fromReport,
      concurrency: args.concurrency,
      delayMs: args.delayMs,
      cacheHours: args.cacheHours,
      refresh: args.refresh,
      place: args.place
    },
    requestedRooms: args.rooms,
    sourceReport: sourceReportPath ? { path: sourceReportPath, toolVersion: sourceReport?.toolVersion || null, createdAt: sourceReport?.createdAt || null } : null,
    opponentProfiles: Object.fromEntries([...deepEvidence.opponentProfiles.entries()]),
    coarseRankings: coarseEligible.slice(0, Math.max(args.topRooms, args.deepTop)).map((r, i) => ({ rank: i + 1, room: r.roomName, strategicScore: r.analysis.strategicScore, baseRoomScore: r.analysis.baseRoomScore })),
    selected: best ? {
      room: best.roomName,
      x: best.analysis.best.x,
      y: best.analysis.best.y,
      strategicScore: best.analysis.strategicScore,
      baseRoomScore: best.analysis.baseRoomScore,
      neighborhood: best.analysis.neighborhood,
      categoryScores: best.analysis.categoryScores || null,
      deepAnalysis: best.analysis.deepAnalysis || null,
      statusVerification: best.analysis.statusVerification || null,
      bestTile: best.analysis.best
    } : null,
    rankings: eligible.slice(0, args.topRooms).map((r, i) => ({
      rank: i + 1,
      room: r.roomName,
      strategicScore: r.analysis.strategicScore,
      baseRoomScore: r.analysis.baseRoomScore,
      neighborhoodScore: r.analysis.neighborhood?.score || 0,
      categoryScores: r.analysis.categoryScores || null,
      deep: Boolean(r.analysis.deepAnalysis),
      spawn: { x: r.analysis.best.x, y: r.analysis.best.y }
    })),
    rejectedCounts: rejects,
    rooms: results.map(r => ({ error: r.error || null, ...r.analysis }))
  };

  const reportPath = safeWriteJson(`initial-spawn-plan-${stampForFile()}.json`, report);
  console.log(`\nReport written to: ${reportPath}`);
  console.log(`Cache file: ${cacheFile(args.server)}`);

  if (!best) {
    console.error('\nNo eligible room/tile found. Nothing will be placed.');
    process.exitCode = 3;
    return;
  }

  const b = best.analysis.best;
  const n = best.analysis.neighborhood;
  console.log(`\nBEST RESULT: ${best.roomName} at (${b.x},${b.y}) final=${best.analysis.strategicScore}`);
  console.log(`Base=${best.analysis.baseRoomScore}, neighborhood=${n?.score || 0}, adjacent remote sources=${n?.adjacentRemoteSources || 0}, expansion potential=${n?.expansionPotential || 0}`);
  console.log(`Layout headroom: effectiveSlots=${b.layout.effectiveSlots}, connectedOpen9=${b.layout.connectedOpen9}, labReady=${b.layout.labReady}, hubReady=${b.layout.hubReady}`);
  console.log(`RCL8 blueprint: complete=${b.blueprint?.complete ?? false}, fit=${b.blueprint?.structureFit ?? 'n/a'}/${b.blueprint?.structureRequired ?? 'n/a'}, roadFit=${b.blueprint ? Math.round(b.blueprint.roadFitRatio * 100) + '%' : 'n/a'}`);
  console.log(`Defense: nearestExitCost=${b.nearestExitCost ?? 'n/a'}, perimeterRamparts=${b.defensePerimeter?.rampartTiles ?? 'n/a'}, chokepoint=${b.defensePerimeter?.chokepointScore ?? 'n/a'}, exitSides=${b.exitSides}`);
  if (best.analysis.categoryScores) console.log(`Scores: economy=${best.analysis.categoryScores.economyScore} layout=${best.analysis.categoryScores.layoutScore} safety=${best.analysis.categoryScores.safetyScore} empire=${best.analysis.categoryScores.empireScore} composite=${best.analysis.categoryScores.compositeScore}`);
  if (best.analysis.deepAnalysis) console.log(`Deep: remoteSources=${best.analysis.deepAnalysis.remoteRoutes?.reachableSources ?? 0}/${best.analysis.deepAnalysis.remoteRoutes?.totalSources ?? 0} remoteAvg=${best.analysis.deepAnalysis.remoteRoutes?.avgCost ?? 'n/a'} corridor2src=${best.analysis.deepAnalysis.expansionCorridor?.twoSourceRooms ?? 0} opponentPenalty=${best.analysis.deepAnalysis.opponentStrengthPenalty ?? 0}`);
  console.log(renderAscii({ encodedTerrain: best.encodedTerrain, objects: best.objects, best: b, candidates: best.analysis.candidates }));

  if (!args.place) {
    console.log('\nPlan-only mode. No spawn was placed.');
    console.log(`Verify first: npm run spawn:verify -- --room ${best.roomName} --x ${b.x} --y ${b.y} --name ${args.name}`);
    console.log(`Then place with the same fresh verifier: npm run spawn:auto -- ${best.roomName} --name ${args.name}`);
    return;
  }

  const finalSafety = await finalPlacementVerification(api, best.roomName, b.x, b.y, args.name, myUserId, args.branch);
  for (const c of finalSafety.checks) {
    const marker = c.pass ? 'PASS' : c.severity === 'warning' ? 'WARN' : 'FAIL';
    if (!c.pass || c.name === 'world-status-empty' || c.name === 'room-status-normal' || c.name === 'spawn-tile-free-and-buildable' || c.name === 'spawn-name-available') {
      console.log(`  ${marker} ${c.name}${c.error ? ` - ${c.error}` : ''}`);
    }
  }
  if (!finalSafety.ok) {
    const reasons = finalSafety.failures.map(c => c.name).join(', ');
    throw new Error(`Refusing first-spawn placement: final verification failed (${reasons}).`);
  }
  const worldStatus = finalSafety.worldStatus;
  console.log(`Final fresh spawn verification passed for ${best.roomName} at (${b.x},${b.y}).`);

  console.log(`\nPlacing initial spawn '${args.name}' in ${best.roomName} at (${b.x},${b.y})...`);
  const placement = await api.gamePlaceSpawn(best.roomName, b.x, b.y, args.name);
  const placementReport = {
    createdAt: new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    server: args.server,
    room: best.roomName,
    x: b.x,
    y: b.y,
    name: args.name,
    worldStatusBefore: worldStatus,
    scoreAtPlacement: best.analysis.strategicScore,
    categoryScores: best.analysis.categoryScores || null,
    finalVerification: finalSafety,
    response: placement
  };

  const branchActivation = { attempted: false, activated: false, branch: args.branch };
  try {
    const branches = await api.userBranches();
    const exists = (branches?.list || []).some(v => v.branch === args.branch);
    if (exists) {
      branchActivation.attempted = true;
      branchActivation.response = await api.userSetActiveBranch(args.branch, 'activeWorld');
      branchActivation.activated = true;
      console.log(`Activated world code branch '${args.branch}'.`);
    } else {
      branchActivation.reason = 'branch-not-found-on-server';
      console.log(`World branch '${args.branch}' is not on the server yet; let the desktop client sync it, then select/activate it in Screeps.`);
    }
  } catch (err) {
    branchActivation.attempted = true;
    branchActivation.error = String(err?.message || err);
    console.log(`Spawn was placed, but automatic branch activation failed: ${err?.message || err}`);
  }
  placementReport.branchActivation = branchActivation;
  const placementPath = safeWriteJson(`initial-spawn-placement-${stampForFile()}.json`, placementReport);
  console.log('Initial spawn placement API call completed.');
  console.log(`Placement log written to: ${placementPath}`);
  console.log(`Once branch '${args.branch}' is active, Screeps will begin running main.js automatically.`);
}

main().catch(err => {
  console.error(`\nInitial spawn planner failed:\n${err?.stack || err}`);
  try {
    safeWriteJson(`initial-spawn-error-${stampForFile()}.json`, { createdAt: new Date().toISOString(), toolVersion: TOOL_VERSION, error: String(err?.stack || err) });
  } catch {}
  process.exitCode = 1;
});
