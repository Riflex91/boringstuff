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

const planner = require('../game/planner.vnext.shadow.js');

function pos(x, y, roomName = 'E8N1') {
  return { x, y, roomName };
}

function makeRoom(walls = [], swamps = []) {
  const wallSet = new Set(walls.map(([x, y]) => x + ',' + y));
  const swampSet = new Set(swamps.map(([x, y]) => x + ',' + y));
  let constructionCalls = 0;
  return {
    name: 'E8N1',
    controller: { my: true, pos: pos(25, 10) },
    getTerrain() {
      return {
        get(x, y) {
          if (wallSet.has(x + ',' + y)) return 1;
          if (swampSet.has(x + ',' + y)) return 2;
          return 0;
        }
      };
    },
    createConstructionSite() {
      constructionCalls += 1;
      throw new Error('P2 SHADOW must never create construction sites');
    },
    constructionCalls() {
      return constructionCalls;
    }
  };
}

function makeState(room = makeRoom()) {
  return {
    room,
    spawn: { pos: pos(25, 25), structureType: 'spawn', my: true },
    sources: [
      { id: 's1', pos: pos(10, 20) },
      { id: 's2', pos: pos(40, 20) }
    ],
    structures: []
  };
}

function routeProvider(from, to) {
  return {
    ok: true,
    incomplete: false,
    cost: Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) * 2,
    path: [
      { x: from.x, y: from.y, roomName: from.roomName || to.roomName },
      { x: to.x, y: to.y, roomName: to.roomName || from.roomName }
    ]
  };
}

{
  const state = makeState();
  const anchors = planner.candidateAnchors(state, { maxAnchors: 6 });
  assert.ok(anchors.length > 0);
  assert.ok(anchors.length <= 6);
  assert.deepEqual(
    planner.candidateAnchors(state, { maxAnchors: 6 }),
    anchors,
    'candidate anchor search must be deterministic'
  );
  for (const anchor of anchors) {
    assert.ok(anchor.x >= 5 && anchor.x <= 44);
    assert.ok(anchor.y >= 5 && anchor.y <= 44);
    assert.ok(anchor.openness >= 0 && anchor.openness <= 100);
    assert.ok(Math.max(Math.abs(anchor.x - 25), Math.abs(anchor.y - 10)) >= 3);
  }
}

{
  const room = makeRoom([[25, 25]]);
  const state = makeState(room);
  const anchors = planner.candidateAnchors(state, { maxAnchors: 20 });
  assert.equal(anchors.some(anchor => anchor.x === 25 && anchor.y === 25), false);
  assert.equal(planner._test.withinRoom(2, 2, 5), false);
  assert.equal(planner._test.withinRoom(5, 5, 5), true);
}

{
  const state = makeState();
  const memory = {};
  const result = planner.evaluate(
    state,
    memory,
    { time: 1000 },
    {
      maxAnchors: 4,
      pathSearchBudget: 8,
      routeCostProvider: routeProvider
    }
  );

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.authority, 'SHADOW');
  assert.equal(result.roomName, 'E8N1');
  assert.equal(result.phase, 'ANCHOR_AND_CORE_GEOMETRY');
  assert.equal(result.legacyPlannerAuthority, 'UNCHANGED');
  assert.equal(result.nextPhase, 'P3_DEFENSE_PERIMETER_NOT_IMPLEMENTED');
  assert.ok(['READY', 'NO_FEASIBLE_ANCHOR'].includes(result.status));
  assert.ok(result.candidateAnchorCount > 0);
  assert.equal(result.evaluatedCandidateCount, result.candidateAnchorCount * planner.VARIANTS.length);
  assert.ok(result.pathSearches <= 8);
  assert.ok(result.topCandidates.length <= 5);
  assert.ok(result.selected);
  assert.ok(result.selected.score >= 0 && result.selected.score <= 100);
  assert.ok(result.selected.plannedStructures.length > 20);
  assert.ok(result.selected.plannedStructures.every(slot => typeof slot.earliestCapability === 'string'));
  assert.ok(result.selected.plannedStructures.some(slot => slot.type === 'extension'));
  assert.ok(result.selected.plannedStructures.some(slot => slot.type === 'tower'));
  assert.equal(state.room.constructionCalls(), 0);

  const stored = planner.snapshot('E8N1', memory, { time: 1001 });
  assert.deepEqual(stored.selected.anchor, result.selected.anchor);
  assert.equal(stored.authority, 'SHADOW');

  const telemetry = planner.telemetrySummary(result);
  assert.equal(telemetry.authority, 'SHADOW');
  assert.equal(telemetry.legacyPlannerAuthority, 'UNCHANGED');
  assert.ok(telemetry.topCandidates.length <= 3);
  assert.equal(Object.hasOwn(telemetry.selected || {}, 'plannedStructures'), false);
  assert.equal(Object.hasOwn(telemetry.selected?.routes || {}, 'routes'), false);
}

{
  const state = makeState();
  const routes = planner.routeMetrics(
    state,
    { x: 25, y: 25, roomName: 'E8N1' },
    { pathSearchBudget: 4, routeCostProvider },
    {},
    { time: 1050 }
  );
  assert.equal(routes.exactRouteCount, 4);
  assert.equal(routes.fallbackRouteCount, 0);
  assert.ok(routes.routes.every(route => route.path.length > 0));
  assert.ok(routes.routes.every(route =>
    route.path.every(step => Number.isFinite(step.x) && Number.isFinite(step.y))
  ));
}

{
  const state = makeState();
  let calls = 0;
  const provider = (from, to) => {
    calls += 1;
    return routeProvider(from, to);
  };
  const result = planner.evaluate(
    state,
    {},
    { time: 1100 },
    {
      maxAnchors: 6,
      pathSearchBudget: 3,
      routeCostProvider: provider
    }
  );

  assert.equal(calls, 3);
  assert.equal(result.pathSearches, 3);
  assert.ok(result.topCandidates.some(candidate => candidate.routes.fallbackRouteCount > 0));
}

{
  const state = makeState();
  const a = planner.evaluate(
    state,
    {},
    { time: 1200 },
    { maxAnchors: 5, pathSearchBudget: 20, routeCostProvider: routeProvider }
  );
  const b = planner.evaluate(
    state,
    {},
    { time: 1200 },
    { maxAnchors: 5, pathSearchBudget: 20, routeCostProvider: routeProvider }
  );
  assert.deepEqual(
    {
      anchor: a.selected.anchor,
      variant: a.selected.variant,
      score: a.selected.score,
      top: a.topCandidates
    },
    {
      anchor: b.selected.anchor,
      variant: b.selected.variant,
      score: b.selected.score,
      top: b.topCandidates
    }
  );
}

{
  const slots = planner.plannedSlots(
    { x: 25, y: 25, roomName: 'E8N1' },
    planner.VARIANTS[0]
  );
  const feasibility = planner.slotFeasibility(makeState(), slots);
  assert.equal(feasibility.criticalBlocked, 0);
  assert.ok(feasibility.extensionTotal > 0);
  assert.ok(feasibility.extensionRatio > 0.5);
}

console.log('P2 planner vnext shadow tests passed');
