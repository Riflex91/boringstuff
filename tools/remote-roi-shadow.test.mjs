import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

const remoteRoi = require('../game/remote.roi.shadow.js');

function record(roomName, lastSeenTick, exits, options = {}) {
  return {
    schemaVersion: 1,
    roomName,
    observation: {
      lastSeenTick,
      confidence: options.confidence ?? 1,
      source: 'test'
    },
    classification: {
      roomStatus: options.roomStatus ?? 'normal'
    },
    controller: {
      exists: options.controllerExists ?? true,
      my: !!options.my,
      level: options.level ?? 0,
      owner: options.owner || null,
      reservationOwner: options.reservationOwner || null,
      reservationTicks: options.reservationTicks ?? null,
      safeMode: null,
      pos: null
    },
    resources: {
      sources: [],
      sourceCount: options.sourceCount ?? 0,
      mineral: null
    },
    topology: {
      exits: (exits || []).map((name, index) => ({
        direction: index + 1,
        roomName: name
      }))
    },
    structures: {
      count: 0,
      byType: {},
      ownedByType: {}
    },
    threat: {
      hostileCreeps: options.hostileCreeps ?? 0,
      lastHostileTick: options.lastHostileTick ?? null
    },
    economics: {
      remoteScore: null,
      expansionRoomQuality: null,
      dynamicScoreTick: null
    }
  };
}

function memoryWith(records) {
  return {
    bot: {
      worldIntel: {
        schemaVersion: 1,
        rooms: Object.fromEntries(records.map(item => [item.roomName, item]))
      }
    }
  };
}

function state(roomName = 'E1N1') {
  return {
    room: {
      name: roomName,
      controller: {
        my: true,
        owner: { username: 'Me' }
      }
    },
    spawn: {
      owner: { username: 'Me' }
    },
    emergency: false
  };
}

function game(tick = 1000, bucket = 10000) {
  return {
    time: tick,
    cpu: {
      bucket
    },
    map: {}
  };
}

function routeProvider(from, to) {
  return {
    ok: true,
    cached: false,
    rooms: [from, to],
    confidence: 1
  };
}

{
  const memory = memoryWith([
    record('E1N1', 1000, ['E1N2', 'E2N1'], { my: true, sourceCount: 2 }),
    record('E1N2', 1000, ['E1N1'], { sourceCount: 2 }),
    record('E2N1', 1000, ['E1N1'], { sourceCount: 1 })
  ]);
  const result = remoteRoi.evaluate(state(), memory, game(), { routeProvider });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.authority, 'SHADOW');
  assert.equal(result.activationAuthority, 'NONE');
  assert.equal(result.remoteMiningEnabled, false);
  assert.equal(result.status, 'READY');
  assert.equal(result.candidateCount, 2);
  assert.equal(result.readyCount, 2);
  assert.equal(result.viableCount, 2);
  assert.equal(result.recommendedCandidateCount, 2);
  assert.equal(result.bestCandidate.roomName, 'E1N2');
  assert.equal(result.bestCandidate.recommendedState, 'CANDIDATE');
  assert.equal(result.bestCandidate.capacityBudgetEligible, true);
  assert.ok(result.bestCandidate.netEnergyPerTick > 0);
  assert.ok(result.bestCandidate.economics.grossIncomePerTick > result.bestCandidate.economics.totalCostPerTick);
  assert.equal(result.bestCandidate.route.hops, 1);
  assert.ok(result.bestCandidate.economics.requiredCarryParts > 0);

  const intelScore = memory.bot.worldIntel.rooms.E1N2.economics.remoteScore;
  assert.equal(intelScore.schemaVersion, 1);
  assert.equal(intelScore.byHome.E1N1.authority, 'SHADOW');
  assert.equal(intelScore.byHome.E1N1.activationAuthority, 'NONE');
  assert.equal(intelScore.byHome.E1N1.recommendedState, 'CANDIDATE');

  const persisted = remoteRoi.snapshot('E1N1', memory, game(1001));
  assert.equal(persisted.bestCandidate.roomName, 'E1N2');

  const summary = remoteRoi.telemetrySummary(result);
  assert.equal(summary.activationAuthority, 'NONE');
  assert.equal(summary.bestCandidate.roomName, 'E1N2');
  assert.equal(summary.topCandidates.length, 2);
}

{
  const memory = memoryWith([
    record('E3N3', 2000, ['E3N4'], { my: true, sourceCount: 2 }),
    record('E3N4', 2000, ['E3N3'], { sourceCount: 2, owner: 'Enemy' })
  ]);
  const result = remoteRoi.evaluate(state('E3N3'), memory, game(2000), { routeProvider });
  assert.equal(result.candidates[0].status, 'UNAVAILABLE');
  assert.equal(result.candidates[0].reason, 'OCCUPIED_ROOM');
  assert.equal(result.candidates[0].recommendedState, 'SUSPENDED');
  assert.equal(result.recommendedCandidateCount, 0);
}

{
  const memory = memoryWith([
    record('E4N4', 3000, ['E4N5'], { my: true, sourceCount: 2 }),
    record('E4N5', 1000, ['E4N4'], { sourceCount: 2 })
  ]);
  const result = remoteRoi.evaluate(state('E4N4'), memory, game(3000), {
    routeProvider,
    intelMaxAge: 500
  });
  assert.equal(result.candidates[0].status, 'UNAVAILABLE');
  assert.equal(result.candidates[0].reason, 'INTEL_STALE');
}

{
  const memory = memoryWith([
    record('W1N1', 4000, ['W1N2'], { my: true, sourceCount: 2 }),
    record('W1N2', 4000, ['W1N1'], { sourceCount: 2, hostileCreeps: 1 })
  ]);
  const result = remoteRoi.evaluate(state('W1N1'), memory, game(4000), { routeProvider });
  const candidate = result.candidates[0];
  assert.equal(candidate.status, 'READY');
  assert.equal(candidate.recommendedState, 'THREATENED');
  assert.equal(candidate.activationAuthority, 'NONE');
  assert.ok(candidate.economics.expectedHostileLoss === undefined);
  assert.ok(candidate.economics.costs.expectedHostileLoss > 0);
}

{
  const memory = memoryWith([
    record('W2N2', 5000, ['W2N3'], { my: true, sourceCount: 2 }),
    record('W2N3', 5000, ['W2N2'], { sourceCount: 2 })
  ]);
  const result = remoteRoi.evaluate(state('W2N2'), memory, game(5000, 6999), { routeProvider });
  const candidate = result.candidates[0];
  assert.equal(candidate.status, 'READY');
  assert.equal(candidate.economicallyViable, true);
  assert.equal(candidate.capacityBudgetEligible, false);
  assert.equal(candidate.recommendedState, 'SUSPENDED');
  assert.equal(result.recommendedCandidateCount, 0);
}

{
  const memory = memoryWith([
    record('W3N3', 6000, ['W3N4'], { my: true, sourceCount: 2 }),
    record('W3N4', 6000, ['W3N3'], { sourceCount: 2, confidence: 0 })
  ]);
  const result = remoteRoi.evaluate(state('W3N3'), memory, game(6000), { routeProvider });
  const candidate = result.candidates[0];
  assert.equal(candidate.status, 'READY');
  assert.equal(candidate.economics.confidence, 0);
  assert.equal(candidate.economicallyViable, false);
  assert.equal(candidate.recommendedState, 'SUSPENDED');
}

{
  const memory = memoryWith([
    record('W4N4', 7000, ['W4N5'], { my: true, sourceCount: 2 }),
    record('W4N5', 7000, ['W4N4'], { sourceCount: 2 })
  ]);
  const tooLongRoute = () => ({
    ok: true,
    cached: false,
    rooms: ['W4N4', 'W4N3', 'W4N2', 'W4N1', 'W4N5'],
    confidence: 1
  });
  const result = remoteRoi.evaluate(state('W4N4'), memory, game(7000), {
    routeProvider: tooLongRoute,
    maxRouteHops: 3
  });
  assert.equal(result.candidates[0].status, 'UNAVAILABLE');
  assert.equal(result.candidates[0].reason, 'ROUTE_TOO_LONG');
  assert.equal(result.candidates[0].recommendedState, 'SUSPENDED');
}

{
  // Unknown frontier rooms are I1's responsibility and must not be invented by I2.
  const memory = memoryWith([
    record('W5N5', 8000, ['W5N6'], { my: true, sourceCount: 2 })
  ]);
  const discovered = remoteRoi.discoverCandidates(state('W5N5'), memory, { maxDepth: 2 });
  assert.deepEqual(discovered, []);
}

// I2: a route adapter returning ok=true is insufficient evidence for
// amortized travel cost. Reject wrong endpoints, cycles and malformed
// confidence before producing any candidate economic viability estimate.
{
  const home = 'W6N6', target = 'W6N7';
  const fixtures = [
    ['missing room sequence', { ok: true, confidence: 1 }],
    ['empty sequence', { ok: true, rooms: [], confidence: 1 }],
    ['only home', { ok: true, rooms: [home], confidence: 1 }],
    ['wrong origin', { ok: true, rooms: ['W6N5', target], confidence: 1 }],
    ['wrong destination', { ok: true, rooms: [home, 'W6N5'], confidence: 1 }],
    ['missing target', { ok: true, rooms: [home], confidence: 1 }],
    ['repeat cycle', { ok: true, rooms: [home, target, home, target], confidence: 1 }],
    ['malformed intermediate', { ok: true, rooms: [home, null, target], confidence: 1 }],
    ['unrecognized room', { ok: true, rooms: [home, 'unknown', target], confidence: 1 }],
    ['missing confidence', { ok: true, rooms: [home, target] }],
    ['NaN confidence', { ok: true, rooms: [home, target], confidence: NaN }],
    ['negative confidence', { ok: true, rooms: [home, target], confidence: -0.2 }],
    ['inflated confidence', { ok: true, rooms: [home, target], confidence: 1.5 }],
    ['boolean proof', { ok: 'yes', rooms: [home, target], confidence: 1 }],
    ['unbounded route', {
      ok: true, rooms: [home, ...Array.from({length: 50}, (_, i) => 'W'+(i+7)+'N8'), target],
      confidence: 1
    }]
  ];
  for (const [label, route] of fixtures) {
    const memory = memoryWith([
      record(home, 9000, [target], { my: true, sourceCount: 2 }),
      record(target, 9000, [home], { sourceCount: 2 })
    ]);
    const result = remoteRoi.evaluate(state(home), memory, game(9000), {
      routeProvider(from, to) {
        assert.equal(from, home, label);
        assert.equal(to, target, label);
        return route;
      }
    });
    assert.equal(result.candidates[0].status, 'UNAVAILABLE', label);
    assert.equal(result.candidates[0].reason, 'ROUTE_EVIDENCE_INVALID', label);
    assert.equal(result.candidates[0].economicallyViable, false, label);
    assert.equal(result.candidates[0].recommendedState, 'SUSPENDED', label);
    assert.equal(result.candidates[0].netEnergyPerTick, null, label);
    assert.equal(result.candidates[0].economics, null, label);
    assert.equal(result.readyCount, 0, label);
    assert.equal(result.recommendedCandidateCount, 0, label);
    assert.equal(result.bestCandidate, null, label);
    const saved = memory.bot.worldIntel.rooms[target].economics.remoteScore.byHome[home];
    assert.equal(saved.activationAuthority, 'NONE', label);
    assert.equal(saved.status, 'UNAVAILABLE', label);
  }
}
// Zero confidence is valid negative evidence, not permission to claim a
// profitable remote. A direct, fully verified route remains advisory.
{
  const home = 'W7N7', target = 'W7N8';
  for (const confidence of [0, 1]) {
    const memory = memoryWith([
      record(home, 9100, [target], { my: true, sourceCount: 2 }),
      record(target, 9100, [home], { sourceCount: 2 })
    ]);
    const out = remoteRoi.evaluate(state(home), memory, game(9100), {
      routeProvider: (from, to) => ({
        ok: true, rooms: [from, to], confidence
      })
    });
    const candidate = out.candidates[0];
    assert.equal(candidate.status, 'READY');
    assert.equal(candidate.activationAuthority, 'NONE');
    assert.equal(candidate.route.hops, 1);
    assert.equal(candidate.economics.confidence, confidence);
    assert.equal(candidate.economicallyViable, confidence === 1);
    assert.equal(candidate.recommendedState,
      confidence === 1 ? 'CANDIDATE' : 'SUSPENDED');
  }
}
console.log('remote ROI shadow tests passed');
