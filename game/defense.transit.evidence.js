'use strict';

// Passive D2 travel telemetry. Only consecutive *actual own defender positions*
// can become ETA evidence; no Game intents, no creep Memory or combat policy.
const SCHEMA_VERSION = 1;
const MAX_TRACKS = 24;
const MAX_ROUTES = 48;
const MAX_TRANSIT_TICKS = 500;
const MAX_EVIDENCE_AGE = 100;
const MAX_OBSERVATIONS = 2;
const ROOM_RE = /^([WE])(\d+)([NS])(\d+)$/;

function coord(room) {
  const m = ROOM_RE.exec(room || '');
  if (!m) return null;
  const x = Number(m[2]), y = Number(m[4]);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  return { x: m[1] === 'W' ? -x - 1 : x,
    y: m[3] === 'N' ? -y - 1 : y };
}
function validTick(v) {
  return Number.isSafeInteger(v) && v >= 0;
}
function validPos(v) {
  return v && typeof v.roomName === 'string' && !!coord(v.roomName) &&
    Number.isInteger(v.x) && v.x >= 0 && v.x < 50 &&
    Number.isInteger(v.y) && v.y >= 0 && v.y < 50;
}
function interior(p) {
  return p.x >= 5 && p.x <= 44 && p.y >= 5 && p.y <= 44;
}
function adjacent(a, b) {
  if (!validPos(a) || !validPos(b)) return false;
  if (a.roomName === b.roomName)
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
  const x = coord(a.roomName), y = coord(b.roomName);
  if (Math.abs(x.x - y.x) + Math.abs(x.y - y.y) !== 1) return false;
  if (x.x !== y.x)
    return Math.abs(a.y - b.y) <= 1 &&
      (y.x > x.x ? a.x === 49 && b.x === 0 : a.x === 0 && b.x === 49);
  return Math.abs(a.x - b.x) <= 1 &&
    (y.y > x.y ? a.y === 49 && b.y === 0 : a.y === 0 && b.y === 49);
}
function position(p) {
  return { x: p.x, y: p.y, roomName: p.roomName };
}
function store(root) {
  if (!root || !root.bot || !root.bot.regionalTransitShadow ||
      root.bot.regionalTransitShadow.schemaVersion !== SCHEMA_VERSION)
    return null;
  const v = root.bot.regionalTransitShadow;
  return v.tracks && v.routes ? v : null;
}
function ensure(root) {
  if (!root.bot) root.bot = {};
  if (!store(root)) root.bot.regionalTransitShadow = {
    schemaVersion: SCHEMA_VERSION, tracks: {}, routes: {}
  };
  return root.bot.regionalTransitShadow;
}
function emptySummary(now) {
  return { schemaVersion: SCHEMA_VERSION, authority: 'SHADOW',
    actionAuthority: 'NONE', tick: now, trackedDefenders: 0,
    candidateRoutes: 0, verifiedRoutes: 0,
    executable: false, writesToCreepMemory: false };
}
function snapshot(game, root) {
  const now = game && game.time;
  const s = store(root);
  const routes = {};
  const summary = emptySummary(validTick(now) ? now : null);
  if (!validTick(now) || !s) return { routes, summary };
  summary.trackedDefenders = Object.keys(s.tracks).length;
  for (const [key, rec] of Object.entries(s.routes)) {
    if (!rec || !validTick(rec.observedTick) ||
        rec.observedTick > now || now - rec.observedTick > MAX_EVIDENCE_AGE ||
        !Number.isSafeInteger(rec.observations) || rec.observations < 1 ||
        !Number.isSafeInteger(rec.travelTicks) || rec.travelTicks < 1 ||
        rec.travelTicks > MAX_TRANSIT_TICKS ||
        rec.risk !== 'CLEAR' || typeof rec.from !== 'string' ||
        typeof rec.to !== 'string' || key !== rec.from + '>' + rec.to) continue;
    summary.candidateRoutes++;
    if (rec.observations < MAX_OBSERVATIONS) continue;
    routes[key] = {
      from: rec.from, to: rec.to, travelTicks: rec.travelTicks,
      observedTick: rec.observedTick, status: 'VERIFIED', risk: 'CLEAR',
      source: 'TRACKED_DEFENDER_TRANSIT'
    };
    summary.verifiedRoutes++;
  }
  return { routes, summary };
}
function validDefender(creep) {
  return !!creep && creep.my === true && !creep.spawning &&
    creep.memory && creep.memory.role === 'defender' &&
    typeof creep.memory.home === 'string' &&
    !!coord(creep.memory.home) && validPos(creep.pos) &&
    validTick(creep.ticksToLive) && Array.isArray(creep.body) &&
    creep.body.some(p => (p.type || p) === 'move' && (p.hits === undefined || p.hits > 0)) &&
    creep.body.some(p => ['attack','ranged_attack','heal'].includes(p.type || p) &&
      (p.hits === undefined || p.hits > 0));
}
function roomSafe(room, game) {
  const observed = game.rooms && game.rooms[room];
  const hostileCreeps = typeof globalThis !== 'undefined'
    ? globalThis.FIND_HOSTILE_CREEPS : undefined;
  const hostileStructures = typeof globalThis !== 'undefined'
    ? globalThis.FIND_HOSTILE_STRUCTURES : undefined;
  if (!observed || typeof observed.find !== 'function' ||
      hostileCreeps === undefined || hostileStructures === undefined)
    return false;
  try {
    const creeps = observed.find(hostileCreeps);
    const structures = observed.find(hostileStructures);
    return Array.isArray(creeps) && creeps.length === 0 &&
      Array.isArray(structures) && structures.length === 0;
  } catch (_) { return false; }
}
function newTrack(creep, now) {
  return { from: creep.memory.home, startedTick: now, lastTick: now,
    lastPos: position(creep.pos), enteredTarget: null, roomSafety: {} };
}
function trim(s, now) {
  for (const [id, t] of Object.entries(s.tracks)) {
    if (!t || !validTick(t.lastTick) || t.lastTick >= now ||
        now - t.lastTick > 1 || !validTick(t.startedTick) ||
        now - t.startedTick > MAX_TRANSIT_TICKS) delete s.tracks[id];
  }
  for (const [k, r] of Object.entries(s.routes)) {
    if (!r || !validTick(r.observedTick) ||
        now - r.observedTick > MAX_EVIDENCE_AGE ||
        r.observedTick > now) delete s.routes[k];
  }
  const keys = Object.keys(s.tracks);
  for (const id of keys.slice(MAX_TRACKS)) delete s.tracks[id];
  const routes = Object.keys(s.routes).sort((a, b) =>
    s.routes[b].observedTick - s.routes[a].observedTick || a.localeCompare(b));
  for (const k of routes.slice(MAX_ROUTES)) delete s.routes[k];
}
function observe(game, root) {
  const now = game && game.time;
  if (!validTick(now) || !game || !game.creeps || !root)
    return snapshot(game, root);
  const s = ensure(root);
  trim(s, now);
  const seen = {};
  const values = Object.values(game.creeps)
    .filter(validDefender)
    .sort((a,b) => String(a.id || a.name).localeCompare(String(b.id || b.name)))
    .slice(0, MAX_TRACKS);
  for (const creep of values) {
    const id = String(creep.id || creep.name || '');
    if (!id || seen[id]) continue;
    seen[id] = true;
    const p = position(creep.pos);
    let t = s.tracks[id];
    if (!t || t.from !== creep.memory.home ||
        t.lastTick !== now - 1 || !adjacent(t.lastPos, p) ||
        now - t.startedTick > MAX_TRANSIT_TICKS) {
      delete s.tracks[id];
      if (p.roomName === creep.memory.home && interior(p))
        s.tracks[id] = newTrack(creep, now);
      continue;
    }
    // Collect a fail-closed safety witness for each crossed room.
    // The eventual destination may legitimately contain hostiles; only
    // *intermediate* rooms must be observed clean. Evaluate at completion
    // once the final destination is known.
    if (p.roomName !== t.from) {
      t.roomSafety[p.roomName] = t.roomSafety[p.roomName] !== false &&
        roomSafe(p.roomName, game);
    }
    t.lastTick = now;
    t.lastPos = p;
    if (p.roomName === t.from) {
      if (t.enteredTarget) { delete s.tracks[id]; continue; }
      continue;
    }
    if (!t.enteredTarget) t.enteredTarget = p.roomName;
    if (t.enteredTarget !== p.roomName) {
      // Multi-room crossings are permitted, but every preceding transit
      // room must be visibly safe. Keep track of the newest destination.
      t.enteredTarget = p.roomName;
    }
    if (!interior(p)) continue;
    const corridorClear = Object.keys(t.roomSafety).every(r =>
      r === p.roomName || t.roomSafety[r] === true);
    if (corridorClear && roomSafe(t.from, game)) {
      const key = t.from + '>' + p.roomName;
      const travel = now - t.startedTick;
      if (travel > 0 && travel <= MAX_TRANSIT_TICKS) {
        const prior = s.routes[key];
        const ageValid = prior && validTick(prior.observedTick) &&
          now - prior.observedTick <= MAX_EVIDENCE_AGE;
        s.routes[key] = {
          from: t.from, to: p.roomName,
          travelTicks: ageValid ? Math.max(prior.travelTicks, travel) : travel,
          observations: ageValid ? Math.min(MAX_OBSERVATIONS, prior.observations + 1) : 1,
          observedTick: now, risk: 'CLEAR'
        };
      }
    }
    delete s.tracks[id];
  }
  for (const id of Object.keys(s.tracks)) if (!seen[id] &&
      s.tracks[id].lastTick !== now) delete s.tracks[id];
  trim(s, now);
  return snapshot(game, root);
}

module.exports = { SCHEMA_VERSION, MAX_TRACKS, MAX_ROUTES,
  observe, snapshot, _test: { coord, adjacent, validPos, roomSafe } };
