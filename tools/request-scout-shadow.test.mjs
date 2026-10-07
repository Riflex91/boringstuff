import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.STRUCTURE_OBSERVER = 'observer';

const scoutShadow = require('../game/request.scout.shadow.js');
const requestShadow = require('../game/request.shadow.js');
const registry = require('../game/request.registry.js');

function record(roomName, lastSeenTick, exits, options = {}) {
  return {
    schemaVersion: 1,
    roomName,
    observation: {
      lastSeenTick,
      confidence: options.confidence ?? 1,
      source: 'test'
    },
    classification: { roomStatus: 'normal' },
    controller: {
      exists: options.controllerExists ?? true,
      my: !!options.my,
      level: options.level ?? 0,
      owner: options.owner || null,
      reservationOwner: null,
      reservationTicks: null,
      safeMode: null,
      pos: null
    },
    resources: {
      sources: [],
      sourceCount: options.sourceCount ?? 0,
      mineral: null
    },
    topology: {
      exits: (exits || []).map((name, i) => ({ direction: i + 1, roomName: name }))
    },
    structures: { count: 0, byType: {}, ownedByType: {} },
    threat: {
      hostileCreeps: options.hostileCreeps ?? 0,
      lastHostileTick: options.lastHostileTick ?? null
    },
    economics: {
      remoteScore: options.remoteScore ?? null,
      expansionRoomQuality: options.expansionRoomQuality ?? null,
      dynamicScoreTick: null
    }
  };
}

function memoryWith(records) {
  return {
    bot: {
      worldIntel: {
        schemaVersion: 1,
        rooms: Object.fromEntries(records.map(r => [r.roomName, r]))
      }
    }
  };
}

{
  const memory = memoryWith([
    record('E1N1', 1000, ['E0N1', 'E1N2', 'E2N1'], { my: true, sourceCount: 2 }),
    record('E1N2', 990, ['E1N1', 'E1N3'], { sourceCount: 1 }),
    record('E0N1', 700, ['E1N1'], { sourceCount: 2, lastHostileTick: 950 })
  ]);
  const game = { time: 1000, map: {} };
  const state = {
    room: { name: 'E1N1' },
    structures: []
  };

  const result = scoutShadow.evaluate(state, memory, game, {
    maxDepth: 2,
    maxRequests: 6,
    refreshAge: 1500,
    threatRefreshAge: 250
  });

  assert.equal(result.summary.authority, 'SHADOW');
  assert.equal(result.summary.homeRoom, 'E1N1');
  assert.equal(result.summary.frontierCount, 4);
  assert.equal(result.summary.requestCount, 3);

  const byRoom = Object.fromEntries(result.candidates.map(c => [c.roomName, c]));
  assert.equal(byRoom.E1N2.needsRefresh, false);
  assert.equal(byRoom.E2N1.unknown, true);
  assert.equal(byRoom.E2N1.depth, 1);
  assert.equal(byRoom.E1N3.unknown, true);
  assert.equal(byRoom.E1N3.depth, 2);
  assert.ok(byRoom.E2N1.score > byRoom.E1N3.score);

  assert.equal(byRoom.E0N1.known, true);
  assert.equal(byRoom.E0N1.stale, false);
  assert.equal(byRoom.E0N1.threatDue, true);
  assert.equal(byRoom.E0N1.risk, 10);

  const specs = Object.fromEntries(result.specs.map(s => [s.target.roomName, s]));
  assert.equal(specs.E2N1.kind, 'SCOUT_INTEL');
  assert.equal(specs.E2N1.domain, 'scouting');
  assert.equal(specs.E2N1.demand.capability, 'vision');
  assert.equal(specs.E2N1.shadow, true);
  assert.equal(specs.E0N1.priority.strategicClass, 'INTEL_URGENT');
}

{
  const memory = memoryWith([
    record('W1N1', 1000, ['W1N2'], { my: true, sourceCount: 2 })
  ]);
  const game = { time: 1000, map: {} };

  const withoutObserver = scoutShadow.evaluate({
    room: { name: 'W1N1' },
    structures: []
  }, memory, game, { maxDepth: 1 });

  const withObserver = scoutShadow.evaluate({
    room: { name: 'W1N1' },
    structures: [{ structureType: 'observer', my: true }]
  }, memory, game, { maxDepth: 1 });

  assert.equal(withoutObserver.specs.length, 1);
  assert.equal(withObserver.specs.length, 1);
  assert.equal(
    withoutObserver.summary.topRequests[0].score - withObserver.summary.topRequests[0].score,
    5
  );
}

{
  // Shared registry integration: unknown frontier demand opens a scouting
  // request, then automatically closes once I0 has fresh intel.
  const memory = memoryWith([
    record('E5N5', 2000, ['E5N6'], { my: true, sourceCount: 2 })
  ]);
  const state = {
    room: { name: 'E5N5' },
    structures: [],
    emergency: false,
    creeps: [],
    sites: [],
    economyModel: {
      recommendedHarvesterWorkParts: 0,
      harvesterWorkDeficit: 0,
      recommendedHaulerCarryParts: 0,
      haulerCarryDeficit: 0
    }
  };

  const first = requestShadow.produce(state, memory, { time: 2000, map: {} });
  assert.equal(first.summary.total, 1);
  assert.equal(first.summary.byDomain.scouting, 1);
  assert.equal(first.scoutingFrontier.requestCount, 1);
  assert.equal(first.scoutingFrontier.topRequests[0].roomName, 'E5N6');

  let requests = registry.list('E5N5', memory);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'SCOUT_INTEL');
  assert.equal(requests[0].target.roomName, 'E5N6');
  assert.equal(requests[0].status, 'OPEN');

  memory.bot.worldIntel.rooms.E5N6 = record('E5N6', 2001, ['E5N5'], { sourceCount: 2 });
  const second = requestShadow.produce(state, memory, { time: 2001, map: {} });
  assert.equal(second.summary.total, 0);
  assert.equal(second.scoutingFrontier.requestCount, 0);
  assert.equal(second.summary.stored, 1);
  assert.equal(second.summary.terminal, 1);
  assert.equal(second.summary.byStatus.SATISFIED, 1);

  requests = registry.list('E5N5', memory);
  assert.equal(requests[0].status, 'SATISFIED');
}

{
  // Unknown rooms are not recursively expanded. A known depth-1 room can
  // expose depth-2 frontier; an unknown depth-1 room cannot create phantom
  // topology beyond itself.
  const memory = memoryWith([
    record('W8N8', 3000, ['W8N9', 'W9N8'], { my: true }),
    record('W8N9', 3000, ['W8N8', 'W8N10'])
  ]);
  const frontier = scoutShadow.discoverFrontier(
    { room: { name: 'W8N8' } },
    memory,
    { time: 3000, map: {} },
    { maxDepth: 3 }
  );
  const names = frontier.map(x => x.roomName);
  assert.ok(names.includes('W8N9'));
  assert.ok(names.includes('W9N8'));
  assert.ok(names.includes('W8N10'));
  assert.equal(names.includes('W9N9'), false);
}

{
  // Explicit stale-only coverage also verifies the E0 request contract fields
  // expected from I1.
  const memory = memoryWith([
    record('W2N2', 5000, ['W2N3'], { my: true }),
    record('W2N3', 3000, ['W2N2'], { sourceCount: 1 })
  ]);
  const result = scoutShadow.evaluate(
    { room: { name: 'W2N2' }, structures: [] },
    memory,
    { time: 5000, map: {} },
    { maxDepth: 1, refreshAge: 1000, threatRefreshAge: 250 }
  );

  assert.equal(result.specs.length, 1);
  const candidate = result.candidates.find(item => item.roomName === 'W2N3');
  assert.equal(candidate.known, true);
  assert.equal(candidate.stale, true);
  assert.equal(candidate.threatDue, false);

  const spec = result.specs[0];
  assert.equal(spec.source.roomName, 'W2N2');
  assert.equal(spec.target.roomName, 'W2N3');
  assert.equal(spec.domain, 'scouting');
  assert.equal(spec.kind, 'SCOUT_INTEL');
  assert.equal(spec.demand.capability, 'vision');
  assert.equal(spec.shadow, true);
}

{
  // Threat uncertainty must materially increase both priority and urgency for
  // otherwise identical stale frontier intel.
  const baseRecords = [
    record('W3N3', 6000, ['W3N4'], { my: true }),
    record('W3N4', 5000, ['W3N3'])
  ];
  const threatRecords = [
    record('W3N3', 6000, ['W3N4'], { my: true }),
    record('W3N4', 5000, ['W3N3'], { lastHostileTick: 5900 })
  ];
  const options = { maxDepth: 1, refreshAge: 500, threatRefreshAge: 250 };
  const calm = scoutShadow.evaluate(
    { room: { name: 'W3N3' }, structures: [] },
    memoryWith(baseRecords),
    { time: 6000, map: {} },
    options
  );
  const uncertain = scoutShadow.evaluate(
    { room: { name: 'W3N3' }, structures: [] },
    memoryWith(threatRecords),
    { time: 6000, map: {} },
    options
  );

  assert.equal(calm.specs.length, 1);
  assert.equal(uncertain.specs.length, 1);
  assert.ok(uncertain.specs[0].priority.base > calm.specs[0].priority.base);
  assert.ok(uncertain.specs[0].priority.urgency > calm.specs[0].priority.urgency);
  assert.equal(uncertain.summary.topRequests[0].threatDue, true);
}

{
  // maxDepth is a hard frontier bound even when deeper I0 topology is known.
  const memory = memoryWith([
    record('W4N4', 7000, ['W4N5'], { my: true }),
    record('W4N5', 7000, ['W4N4', 'W4N6'])
  ]);
  const shallow = scoutShadow.discoverFrontier(
    { room: { name: 'W4N4' } },
    memory,
    { time: 7000, map: {} },
    { maxDepth: 1 }
  );
  const deep = scoutShadow.discoverFrontier(
    { room: { name: 'W4N4' } },
    memory,
    { time: 7000, map: {} },
    { maxDepth: 2 }
  );

  assert.deepEqual(shallow.map(item => item.roomName), ['W4N5']);
  assert.deepEqual(deep.map(item => item.roomName), ['W4N5', 'W4N6']);
  assert.equal(deep.find(item => item.roomName === 'W4N6').depth, 2);
}

{
  // Equal-score requests are deterministic by room name, and maxRequests is a
  // hard output bound rather than a scoring hint.
  const memory = memoryWith([
    record('W5N5', 8000, ['W6N5', 'W5N6', 'W4N5'], { my: true })
  ]);
  const state = { room: { name: 'W5N5' }, structures: [] };
  const game = { time: 8000, map: {} };
  const options = { maxDepth: 1, maxRequests: 2 };

  const first = scoutShadow.evaluate(state, memory, game, options);
  const second = scoutShadow.evaluate(state, memory, game, options);
  const targets = first.specs.map(spec => spec.target.roomName);

  assert.equal(first.summary.frontierCount, 3);
  assert.equal(first.summary.requestCount, 2);
  assert.equal(first.specs.length, 2);
  assert.deepEqual(targets, ['W4N5', 'W5N6']);
  assert.deepEqual(second.specs.map(spec => spec.target.roomName), targets);
}

console.log('scout frontier shadow tests passed');
