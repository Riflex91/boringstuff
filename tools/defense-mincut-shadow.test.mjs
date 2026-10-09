import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.TERRAIN_MASK_WALL = 1;
global.TERRAIN_MASK_SWAMP = 2;

const defense = require('../game/defense.mincut.shadow.js');

function pos(x, y, roomName = 'E8N1') {
  return { x, y, roomName };
}

function corridorRoom() {
  let constructionCalls = 0;
  return {
    name: 'E8N1',
    controller: { my: true, pos: pos(10, 4) },
    getTerrain() {
      return {
        get(x, y) {
          if (x < 9 || x > 11) return 1;
          return 0;
        }
      };
    },
    createConstructionSite() {
      constructionCalls += 1;
      throw new Error('P3 SHADOW must never create construction sites');
    },
    constructionCalls() {
      return constructionCalls;
    }
  };
}

function openRoom() {
  let constructionCalls = 0;
  return {
    name: 'E8N1',
    controller: { my: true, pos: pos(25, 8) },
    getTerrain() {
      return { get() { return 0; } };
    },
    createConstructionSite() {
      constructionCalls += 1;
      throw new Error('P3 SHADOW must never create construction sites');
    },
    constructionCalls() {
      return constructionCalls;
    }
  };
}

function stateFor(room, spawnPos = pos(10, 10)) {
  return {
    room,
    spawn: { pos: spawnPos, structureType: 'spawn', my: true },
    sources: [
      { id: 's1', pos: pos(10, 3) }
    ],
    structures: []
  };
}

function p2Plan({
  anchor = pos(10, 10),
  structures,
  routes
} = {}) {
  const plannedStructures = structures || [
    { type: 'spawn', x: 10, y: 10, roomName: 'E8N1', earliestCapability: 'SPAWN_AVAILABLE', critical: true },
    { type: 'tower', x: 10, y: 11, roomName: 'E8N1', earliestCapability: 'TOWER_AVAILABLE', critical: true }
  ];
  return {
    schemaVersion: 1,
    authority: 'SHADOW',
    status: 'READY',
    roomName: 'E8N1',
    planTick: 1000,
    selected: {
      anchor,
      variant: 'CORE_COMPACT',
      valid: true,
      feasibility: {
        blocked: []
      },
      plannedStructures,
      routes: {
        routes: routes || [
          {
            kind: 'source:0',
            exact: true,
            cost: 14,
            path: [
              pos(10, 6), pos(10, 7), pos(10, 8), pos(10, 9)
            ]
          }
        ]
      }
    }
  };
}

{
  const plan = p2Plan();
  const traffic = defense.trafficTiles(plan);
  assert.equal(traffic.has('10,6'), true);
  assert.equal(traffic.has('10,9'), true);
  assert.equal(traffic.has('9,9'), false);
}

{
  const room = corridorRoom();
  const state = stateFor(room);
  const plan = p2Plan();
  const memory = {};

  const result = defense.evaluate(state, plan, memory, { time: 1001 }, {
    margin: 4,
    maxGridTiles: 400,
    maxAugmentations: 1000
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.authority, 'SHADOW');
  assert.equal(result.status, 'READY');
  assert.equal(result.phase, 'DEFENSE_MINCUT');
  assert.equal(result.legacyPlannerAuthority, 'UNCHANGED');
  assert.equal(result.constructionAuthority, 'NONE');
  assert.equal(result.sourcePlannerTick, 1000);
  assert.ok(result.protectedAssetCount >= 2);
  assert.ok(result.rampartCount > 0);
  assert.equal(result.graph.complete, true);
  assert.ok(result.graph.nodeCount > 0);
  assert.ok(result.graph.edgeCount > 0);
  assert.ok(result.graph.augmentations > 0);
  assert.equal(result.metrics.breachRouteCount, 0);
  assert.equal(result.metrics.exposedAssetCount, 0);
  assert.ok(result.metrics.towerCount >= 1);
  assert.ok(result.metrics.towerMinimumDamage > 0);
  assert.ok(result.score.total >= 0 && result.score.total <= 100);
  assert.equal(result.phaseEvidence.length, 3);
  assert.deepEqual(result.phaseEvidence.map(x => x.phase), [
    'PROTECTED_TOPOLOGY',
    'MINCUT',
    'DEFENSE_SCORE'
  ]);

  const protectedKeys = new Set(defense.protectedAssets(state, plan).map(a => a.x + ',' + a.y));
  for (const rampart of result.ramparts) {
    assert.equal(protectedKeys.has(rampart.x + ',' + rampart.y), false);
    assert.ok(rampart.x >= result.bounds.minX && rampart.x <= result.bounds.maxX);
    assert.ok(rampart.y >= result.bounds.minY && rampart.y <= result.bounds.maxY);
  }
  assert.equal(room.constructionCalls(), 0);

  const stored = defense.snapshot('E8N1', memory, { time: 1002 });
  assert.equal(stored.status, 'READY');
  assert.equal(stored.authority, 'SHADOW');

  const telemetry = defense.telemetrySummary(result);
  assert.equal(telemetry.authority, 'SHADOW');
  assert.equal(telemetry.status, 'READY');
  assert.equal(telemetry.legacyPlannerAuthority, 'UNCHANGED');
  assert.equal(telemetry.constructionAuthority, 'NONE');
  assert.ok(telemetry.ramparts.length <= 16);
}

{
  const room = corridorRoom();
  const state = stateFor(room);
  const plan = p2Plan();
  const result = defense.evaluate(state, plan, {}, { time: 1010 }, {
    margin: 4,
    maxGridTiles: 400,
    maxAugmentations: 1
  });
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.reason, 'AUGMENTATION_BUDGET');
  assert.equal(result.graph.complete, false);
}

{
  const room = openRoom();
  const state = stateFor(room, pos(10, 10));
  const plan = p2Plan({
    structures: [
      { type: 'spawn', x: 10, y: 10, roomName: 'E8N1', critical: true },
      { type: 'storage', x: 40, y: 40, roomName: 'E8N1', critical: true }
    ],
    routes: []
  });
  const result = defense.evaluate(state, plan, {}, { time: 1020 }, {
    margin: 4,
    maxGridTiles: 300
  });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reason, 'GRID_BUDGET_EXCEEDED');
}

{
  const room = openRoom();
  const state = stateFor(room, pos(25, 25));
  const waiting = defense.evaluate(state, null, {}, { time: 1030 });
  assert.equal(waiting.status, 'WAITING_FOR_P2');
  assert.equal(waiting.authority, 'SHADOW');

  const badAuthority = p2Plan({
    anchor: pos(25, 25),
    structures: [{ type: 'spawn', x: 25, y: 25, roomName: 'E8N1', critical: true }],
    routes: []
  });
  badAuthority.authority = 'VNEXT';
  assert.equal(
    defense.evaluate(state, badAuthority, {}, { time: 1031 }).status,
    'WAITING_FOR_P2'
  );
}

{
  assert.equal(defense._test.towerDamageAt(5), 600);
  assert.equal(defense._test.towerDamageAt(20), 150);
  assert.equal(defense._test.towerDamageAt(10), 450);

  const coverage = defense.towerCoverage(
    [{ x: 10, y: 10 }, { x: 12, y: 10 }],
    [{ x: 10, y: 10 }]
  );
  assert.equal(coverage.minimumDamage, 600);
  assert.equal(coverage.averageDamage, 600);
  assert.equal(coverage.minimumScore, 100);
}

{
  const groups = defense.groupRamparts([
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 20, y: 20 }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[1].count, 1);
}

{
  const score = defense.scoreDefense(
    [
      { x: 10, y: 10, trafficCrossing: false },
      { x: 11, y: 10, trafficCrossing: true }
    ],
    { breachRouteCount: 0 },
    { averageScore: 100, minimumScore: 100 },
    { ratio: 0, score: 100 }
  );
  assert.equal(score.rampartCount, 2);
  assert.equal(score.trafficCrossings, 1);
  assert.ok(score.total > 0 && score.total <= 100);
}


{
  // Reuse one terrain view for both topology and cut capacities. Mixed
  // wall/swamp terrain must preserve exact lookup and per-tile weighting.
  let terrainCalls = 0;
  const terrain = {
    get(x, y) {
      if (x === 11 && y === 11) return 1; // natural wall
      if (x === 9 && y === 9) return 2;   // swamp
      return 0;
    }
  };
  const room = openRoom();
  room.getTerrain = () => { terrainCalls += 1; return terrain; };
  const state = stateFor(room);
  const plan = p2Plan();
  const result = defense.evaluate(state, plan, {}, { time: 1100 }, {
    margin: 4, maxGridTiles: 400, maxAugmentations: 1000
  });
  assert.equal(terrainCalls, 1, 'P3 must not repeatedly obtain RoomTerrain');
  assert.equal(result.authority, 'SHADOW');
  assert.equal(result.constructionAuthority, 'NONE');
  assert.equal(result.status, 'READY');
  assert.equal(result.metrics.breachRouteCount, 0);

  const grid = defense.buildGrid(state, plan, { margin: 4, maxGridTiles: 400 });
  assert.ok(grid.ok);
  assert.equal(grid.indexByCoord[11 * 50 + 11], -1, 'wall excluded from dense index');
  assert.equal(grid.indexByKey.has('11,11'), false);
  const swampId = grid.indexByCoord[9 * 50 + 9];
  assert.equal(swampId, grid.indexByKey.get('9,9'));
  assert.equal(grid.tiles[swampId].swamp, true);
  const context = {
    protectedSet: grid.protectedSet,
    naturalSet: grid.naturalSet,
    trafficSet: grid.trafficSet,
    existingRamparts: grid.existingRamparts
  };
  assert.equal(
    defense._test.cutCapacity(room, 9, 9, context, true),
    defense._test.cutCapacity(room, 9, 9, context),
    'cached swamp cost must match original terrain lookup'
  );
  assert.equal(grid.indexByCoord[5 * 50 + 5], -1, 'outside bounds is never a neighbor');
}

{
  // Queue reuse cannot leak residual BFS state between max-flow calls.
  const Dinic = defense._test.Dinic;
  const graph = new Dinic(4, 100);
  graph.addEdge(0, 1, 4);
  graph.addEdge(1, 3, 4);
  graph.addEdge(0, 2, 3);
  graph.addEdge(2, 3, 3);
  assert.equal(graph.maxFlow(0, 3), 7);
  assert.equal(graph.maxFlow(0, 3), 0);
  assert.equal(graph.reachable(0)[3], 0);
  assert.equal(graph.edgeCount, 4);
}

console.log('P3 min-cut defense shadow tests passed');
