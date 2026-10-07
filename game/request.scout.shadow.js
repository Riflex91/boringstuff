'use strict';

const config = require('config');
const worldIntel = require('world.intel');

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_REQUESTS = 6;
const DEFAULT_REFRESH_AGE = 1500;
const DEFAULT_THREAT_REFRESH_AGE = 250;

function tick(game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  return game && Number.isFinite(game.time) ? game.time : 0;
}

function homeRoom(state) {
  return state && state.room && state.room.name ? state.room.name : null;
}

function numberOption(options, key, fallback, min, max) {
  const value = options && Number.isFinite(options[key]) ? Math.round(options[key]) : fallback;
  return Math.max(min, Math.min(max, value));
}

function configValue(name, fallback) {
  return Number.isFinite(config[name]) ? config[name] : fallback;
}

function recordExits(record) {
  const exits = record && record.topology && Array.isArray(record.topology.exits)
    ? record.topology.exits
    : [];
  return exits.map(exit => exit && exit.roomName).filter(Boolean).sort();
}

function mapExits(roomName, game) {
  const map = game && game.map;
  if (!map || typeof map.describeExits !== 'function') return [];
  try {
    const exits = map.describeExits(roomName) || {};
    return Object.keys(exits).sort().map(direction => exits[direction]).filter(Boolean);
  } catch (err) {
    return [];
  }
}

function exitsFor(roomName, home, memoryRoot, game) {
  const record = worldIntel.get(roomName, memoryRoot);
  const exits = recordExits(record);
  if (exits.length) return exits;

  // Only the owned/home room may fall back to direct map topology. Unknown
  // frontier rooms are not recursively expanded until actual I0 intel exists.
  return roomName === home ? mapExits(roomName, game) : [];
}

function discoverFrontier(state, memoryRoot, game, options) {
  const home = homeRoom(state);
  if (!home) return [];

  const maxDepth = numberOption(options, 'maxDepth', configValue('SCOUT_FRONTIER_MAX_DEPTH', DEFAULT_MAX_DEPTH), 1, 6);
  const queue = [{ roomName: home, depth: 0 }];
  const visitedDepth = { [home]: 0 };
  const candidates = {};

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) continue;

    for (const nextRoom of exitsFor(current.roomName, home, memoryRoot, game)) {
      if (!nextRoom || nextRoom === home) continue;
      const depth = current.depth + 1;
      const previous = candidates[nextRoom];
      if (!previous || depth < previous.depth ||
        (depth === previous.depth && current.roomName < previous.fromRoom)) {
        candidates[nextRoom] = {
          roomName: nextRoom,
          fromRoom: current.roomName,
          depth
        };
      }

      const known = worldIntel.get(nextRoom, memoryRoot);
      if (!known || depth >= maxDepth) continue;
      if (visitedDepth[nextRoom] === undefined || depth < visitedDepth[nextRoom]) {
        visitedDepth[nextRoom] = depth;
        queue.push({ roomName: nextRoom, depth });
      }
    }
  }

  return Object.keys(candidates).sort().map(roomName => candidates[roomName]);
}

function observerAvailable(state) {
  const observerType = typeof STRUCTURE_OBSERVER !== 'undefined' ? STRUCTURE_OBSERVER : 'observer';
  for (const structure of state && state.structures || []) {
    if (structure && structure.structureType === observerType && structure.my !== false) return true;
  }
  return false;
}

function clampScore(value) {
  return Math.max(1, Math.min(100, Math.round(value)));
}

function scoreCandidate(candidate, state, memoryRoot, game, options) {
  const now = tick(game);
  const refreshAge = numberOption(
    options,
    'refreshAge',
    configValue('SCOUT_INTEL_MAX_AGE', DEFAULT_REFRESH_AGE),
    25,
    10000
  );
  const threatRefreshAge = numberOption(
    options,
    'threatRefreshAge',
    configValue('SCOUT_THREAT_MAX_AGE', DEFAULT_THREAT_REFRESH_AGE),
    25,
    refreshAge
  );

  const record = worldIntel.get(candidate.roomName, memoryRoot);
  const freshness = worldIntel.freshness(candidate.roomName, now, refreshAge, memoryRoot);
  const unknown = !freshness.known;
  const stale = freshness.known && !freshness.fresh;
  const age = freshness.age;
  const threat = record && record.threat ? record.threat : {};
  const currentHostiles = Number.isFinite(threat.hostileCreeps) ? Math.max(0, threat.hostileCreeps) : 0;
  const lastHostileTick = Number.isFinite(threat.lastHostileTick) ? threat.lastHostileTick : null;
  const threatDue = freshness.known &&
    lastHostileTick !== null &&
    Number.isFinite(age) &&
    age >= threatRefreshAge;

  const sourceCount = record && record.resources && Number.isFinite(record.resources.sourceCount)
    ? record.resources.sourceCount
    : 0;
  const exitCount = record && record.topology && Array.isArray(record.topology.exits)
    ? record.topology.exits.length
    : 0;
  const economics = record && record.economics ? record.economics : {};
  const remoteScore = Number.isFinite(economics.remoteScore) ? economics.remoteScore : null;
  const expansionScore = Number.isFinite(economics.expansionRoomQuality) ? economics.expansionRoomQuality : null;

  const components = {
    frontier: 20,
    unknown: unknown ? 55 : 0,
    stale: stale
      ? Math.min(35, 15 + Math.round(Math.max(0, age - refreshAge) / Math.max(1, refreshAge) * 20))
      : 0,
    threatUncertainty: threatDue ? 20 : 0,
    sourceValue: sourceCount >= 2 ? 10 : sourceCount === 1 ? 4 : 0,
    routeValue: exitCount >= 3 ? 5 : 0,
    remoteValue: remoteScore !== null && remoteScore > 0 ? 8 : 0,
    expansionValue: expansionScore !== null && expansionScore > 0 ? 8 : 0,
    noObserver: observerAvailable(state) ? 0 : 5,
    depthPenalty: Math.max(0, candidate.depth - 1) * 8
  };

  const rawScore = Object.keys(components)
    .filter(key => key !== 'depthPenalty')
    .reduce((sum, key) => sum + components[key], 0) - components.depthPenalty;
  const score = clampScore(rawScore);
  const needsRefresh = unknown || stale || threatDue;

  let urgency = 0;
  if (unknown) urgency += 25;
  if (stale && Number.isFinite(age)) {
    urgency += Math.min(35, Math.round(Math.max(0, age - refreshAge) / Math.max(1, refreshAge) * 20) + 10);
  }
  if (threatDue) urgency += 40;
  urgency = Math.min(100, urgency);

  const deadlineDelta = threatDue ? 25 : unknown ? 75 : 100;
  const risk = currentHostiles > 0 ? 30 : lastHostileTick !== null ? 10 : 0;

  return {
    roomName: candidate.roomName,
    fromRoom: candidate.fromRoom,
    depth: candidate.depth,
    known: freshness.known,
    fresh: freshness.fresh,
    age,
    confidence: freshness.confidence,
    unknown,
    stale,
    threatDue,
    currentHostiles,
    sourceCount,
    score,
    urgency,
    risk,
    deadlineTick: now + deadlineDelta,
    needsRefresh,
    components
  };
}

function toSpec(home, item) {
  return {
    dedupeKey: 'scouting:intel:' + item.roomName,
    domain: 'scouting',
    kind: 'SCOUT_INTEL',
    source: { roomName: home },
    target: { roomName: item.roomName },
    demand: {
      capability: 'vision',
      amount: 1,
      minimumUsefulAmount: 1,
      maximumUsefulAmount: 1
    },
    priority: {
      base: item.score,
      urgency: item.urgency,
      strategicClass: item.threatDue ? 'INTEL_URGENT' : 'INTEL'
    },
    utility: {
      current: item.score,
      marginalModel: 'BINARY'
    },
    risk: item.risk,
    deadlineTick: item.deadlineTick,
    evidence: {
      source: 'world.intel.frontier',
      hypothesis: 'refresh high-value frontier intel before remote/expansion/threat decisions depend on stale or unknown state'
    },
    shadow: true
  };
}

function evaluate(state, memoryRoot, game, options) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const home = homeRoom(state);
  if (!home) {
    return {
      specs: [],
      candidates: [],
      summary: {
        schemaVersion: SCHEMA_VERSION,
        authority: 'SHADOW',
        homeRoom: null,
        frontierCount: 0,
        requestCount: 0,
        topRequests: []
      }
    };
  }

  const frontier = discoverFrontier(state, memoryRoot, game, options);
  const evaluated = frontier.map(candidate => scoreCandidate(candidate, state, memoryRoot, game, options));
  const maxRequests = numberOption(
    options,
    'maxRequests',
    configValue('SCOUT_FRONTIER_MAX_REQUESTS', DEFAULT_MAX_REQUESTS),
    1,
    20
  );

  const active = evaluated
    .filter(item => item.needsRefresh)
    .sort((a, b) =>
      b.score - a.score ||
      b.urgency - a.urgency ||
      a.depth - b.depth ||
      a.roomName.localeCompare(b.roomName)
    )
    .slice(0, maxRequests);

  return {
    specs: active.map(item => toSpec(home, item)),
    candidates: evaluated,
    summary: {
      schemaVersion: SCHEMA_VERSION,
      authority: 'SHADOW',
      homeRoom: home,
      frontierCount: frontier.length,
      requestCount: active.length,
      maxDepth: numberOption(options, 'maxDepth', configValue('SCOUT_FRONTIER_MAX_DEPTH', DEFAULT_MAX_DEPTH), 1, 6),
      refreshAge: numberOption(options, 'refreshAge', configValue('SCOUT_INTEL_MAX_AGE', DEFAULT_REFRESH_AGE), 25, 10000),
      topRequests: active.slice(0, 6).map(item => ({
        roomName: item.roomName,
        fromRoom: item.fromRoom,
        depth: item.depth,
        score: item.score,
        urgency: item.urgency,
        age: item.age,
        unknown: item.unknown,
        stale: item.stale,
        threatDue: item.threatDue,
        risk: item.risk,
        components: item.components
      }))
    }
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_REFRESH_AGE,
  DEFAULT_THREAT_REFRESH_AGE,
  discoverFrontier,
  scoreCandidate,
  evaluate,
  _test: {
    homeRoom,
    recordExits,
    mapExits,
    exitsFor,
    observerAvailable,
    clampScore,
    toSpec
  }
};
