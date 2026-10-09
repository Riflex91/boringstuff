import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const model = require('../game/threat.model.shadow.js');
global.BOOSTS = { attack: { XUH2O: { attack: 4 } }, tough: { XGHO2: { damage: 0.3 } }, move: { XZHO2: { fatigue: 4 } } };
const pos = (x, y) => ({ x, y, roomName: 'E8N1' });
const part = (type, hits = 100, boost) => ({ type, hits, boost });
const creep = (body, x = 24, y = 25) => ({ id: 'enemy', body, pos: pos(x, y), owner: { username: 'enemy' }, store: {} });
const spawn = { id: 'spawn', my: true, structureType: 'spawn', hits: 5000, pos: pos(25, 25) };
const state = hostileCreeps => ({ room: { name: 'E8N1', controller: { my: true, safeModeAvailable: 1 },
  getTerrain: () => ({ get: () => 0 }) }, hostileCreeps, structures: [spawn], sources: [] });
const game = { time: 100 };

assert.equal(model.evaluate(state([]), game).risk.state, 'NORMAL');
const scout = model.evaluate(state([creep([part('move')])]), game);
assert.equal(scout.risk.state, 'WATCH');
assert.equal(scout.risk.recommendedSafeMode, false);
assert.equal(scout.authority, 'SHADOW');
assert.equal(scout.actionAuthority, 'NONE');
assert.equal(model.bodyStrength(creep([part('attack', 0), part('move')])).meleeDps, 0);
assert.equal(model.bodyStrength(creep([part('attack', 1, 'XUH2O')])).meleeDps, 120);
assert.equal(model.bodyStrength(creep([part('tough', 30, 'XGHO2')])).effectiveTough, 100);
assert.equal(model.bodyStrength(creep([part('work'), part('move', 100, 'XZHO2')])).swampTicks, 2);
assert.equal(model.bodyStrength(creep([part('work'), part('move', 0)])).plainTicks, null);
assert.equal(model.bodyStrength(creep([part('carry'), part('move')])).weight, 0);
const loaded = creep([part('carry'), part('carry'), part('move')]);
loaded.store.energy = 51;
assert.equal(model.bodyStrength(loaded).weight, 2);
const unboosted = creep(Array.from({ length: 4 }, () => part('attack')));
const boosted = creep(Array.from({ length: 4 }, () => part('attack', 100, 'XUH2O')));
assert.equal(model.evaluate(state([unboosted]), game).risk.state, 'DEFENSE');
assert.equal(model.evaluate(state([boosted]), game).risk.state, 'EMERGENCY');
assert.equal(model.evaluate(state([boosted]), game).risk.recommendedSafeMode, true);
const protectedState = state([boosted]);
protectedState.structures.push({ id: 'rampart', my: true, structureType: 'rampart', hits: 100000, pos: spawn.pos });
assert.equal(model.evaluate(protectedState, game).risk.recommendedSafeMode, false);
protectedState.room.controller.safeModeCooldown = 1;
protectedState.structures.pop();
assert.equal(model.evaluate(protectedState, game).risk.recommendedSafeMode, false);

const tower = { my: true, pos: pos(5, 5), store: { energy: 10 }, isActive: () => true };
assert.equal(model.towerDamage(tower, pos(10, 10)), 600);
assert.equal(model.towerDamage(tower, pos(25, 25)), 150);
tower.store.energy = 9;
assert.equal(model.towerDamage(tower, pos(10, 10)), 0);
tower.store.energy = 100;
tower.isActive = () => false;
assert.equal(model.towerDamage(tower, pos(10, 10)), 0);

const distant = creep([part('attack'), part('move')], 5, 5);
assert.equal(model.evaluate(state([distant]), game).status, 'PARTIAL');
assert.equal(model.evaluate(state([distant]), game).access.breachPaths[0].reason, 'PATH_API_MISSING');
class Matrix { constructor() { this.values = {}; } set(x, y, value) { this.values[x + ',' + y] = value; } }
// Legal contiguous one-room path from (5,5) to range 1 of (25,25).
const fullDiagonal = Array.from({ length: 19 }, (_, i) => pos(i + 6, i + 6));
let searchCount = 0;
const pf = { CostMatrix: Matrix, search(origin, goal, options) {
  searchCount++;
  assert.equal(options.maxOps, 200);
  assert.equal(options.maxRooms, 1);
  assert.equal(options.roomCallback('E8N1').values['25,25'], 255);
  assert.equal(options.roomCallback('E9N1'), false);
  return { incomplete: false, cost: 20, path: fullDiagonal };
} };
const accessible = model.evaluate(state([distant]), game, { pathFinder: pf });
assert.equal(accessible.access.earliestImpactTick, 120);
assert.equal(accessible.status, 'READY');
assert.equal(searchCount, 1);
pf.search = () => ({ incomplete: true, path: [] });
const blocked = model.evaluate(state([distant]), game, { pathFinder: pf });
assert.equal(blocked.status, 'PARTIAL');
assert.equal(blocked.risk.state, 'ALERT');
assert.equal(blocked.risk.recommendedSafeMode, false);
assert.equal(blocked.access.earliestImpactTick, null);
pf.search = () => { throw new Error('missing optional API'); };
assert.equal(model.evaluate(state([distant]), game, { pathFinder: pf }).status, 'PARTIAL');
pf.search = () => ({ incomplete: false, cost: 20, path: fullDiagonal });
const many = state(Array.from({ length: 60 }, (_, i) => ({ ...distant, id: 'enemy-' + i })));
const bounded = model.evaluate(many, game, { pathFinder: pf });
assert.equal(bounded.hostileActors.length, 50);
assert.equal(bounded.pathSearches, 4);
assert.equal(bounded.status, 'PARTIAL');
const original = JSON.stringify(many);
global.Memory = { sentinel: true };
model.evaluate(many, game, { pathFinder: pf });
assert.equal(JSON.stringify(many), original);
assert.deepEqual(global.Memory, { sentinel: true });
assert.equal(model.telemetrySummary(blocked).unknownPaths, 1);
delete global.BOOSTS;
assert.equal(model.evaluate(state([boosted]), game).status, 'PARTIAL');

// Together two individually non-emergency attackers can destroy the spawn
// within the emergency horizon. The same covering rampart is not counted twice.
const pair = model.evaluate(state([unboosted, { ...unboosted, id: 'enemy-2' }]), game);
assert.equal(pair.risk.state, 'EMERGENCY');
assert.equal(pair.access.criticalAssetsAtRisk.length, 1);
assert.equal(pair.access.criticalAssetsAtRisk[0].attackerCount, 2);
assert.equal(pair.access.criticalAssetsAtRisk[0].earliestLossTick, 121);
assert.equal(model.telemetrySummary(pair).coordinatedAssets, 1);
const focused = model._test.focusedLoss({ id: 'core', hits: 1000 }, [
  { arrivalTicks: 0, dps: 100, barrierHits: 1000 },
  { arrivalTicks: 5, dps: 100, barrierHits: 1000 }
], 100);
assert.equal(focused.barrierHits, 1000);
assert.equal(focused.impactTick, 108);
assert.equal(focused.earliestLossTick, 113);
const late = model._test.focusedLoss({ id: 'core', hits: 100 }, [
  { arrivalTicks: 0, dps: 100, barrierHits: 0 },
  { arrivalTicks: 100, dps: 100, barrierHits: 0 }
], 100);
assert.equal(late.earliestLossTick, 101);
assert.equal(late.attackerCount, 1);

// Incomplete open path -> actual destructible barrier route. Matrix weights
// saturate at 254, but the reported delay must account for all 30000 wall HP.
const breachState = state([distant]);
breachState.structures[0] = { ...spawn, pos: pos(8, 5) };
breachState.structures.push({ id: 'wall', structureType: 'constructedWall', hits: 30000, pos: pos(6, 5) });
breachState.room.getTerrain = () => ({ get: () => 0 });
breachState.minerals = [{ pos: pos(8, 8) }];
let breachCalls = 0;
const breachFinder = { CostMatrix: Matrix, search(origin, goal, options) {
  breachCalls++;
  const costs = options.roomCallback('E8N1').values;
  assert.equal(costs['8,8'], 255, 'minerals must remain impassable');
  if (breachCalls % 2 === 1) { assert.equal(costs['6,5'], 255); return { incomplete: true, path: [] }; }
  assert.equal(costs['6,5'], 254);
  return { incomplete: false, cost: 254, path: [pos(6, 5), pos(7, 5)] };
} };
const breached = model.evaluate(breachState, game, { pathFinder: breachFinder });
assert.equal(breached.pathSearches, 2);
assert.equal(breached.status, 'PARTIAL', 'a bounded breach route is not a proven fastest combat path');
assert.equal(breached.access.breachPaths[0].status, 'REACHABLE_WITH_BREACH');
assert.equal(breached.access.breachPaths[0].routeBreachTicks, 1000);
assert.equal(breached.access.breachPaths[0].routeBarrierHits, 30000);
assert.equal(breached.access.breachPaths[0].travelTicks, 2);
assert.equal(breached.access.earliestImpactTick, 1102);
assert.equal(breached.risk.recommendedSafeMode, false);
assert.equal(model.telemetrySummary(breached).breachPaths, 1);

const incompleteFinder = { CostMatrix: Matrix, search: () => ({ incomplete: true, path: [] }) };
assert.equal(model.evaluate(breachState, game, { pathFinder: incompleteFinder }).status, 'PARTIAL');
const crowded = { ...breachState, hostileCreeps: [distant, { ...distant, id: 'two' }, { ...distant, id: 'three' }] };
assert.equal(model.evaluate(crowded, game, { pathFinder: incompleteFinder }).pathSearches, 4);

// D0.3 regression: a mixed ATTACK/RANGED_ATTACK creep does not strike at
// melee DPS from range 2–3. The unverified close route remains UNKNOWN.
const mixed = creep([
  part('attack'), part('attack'), part('attack'), part('attack'),
  part('ranged_attack'), part('move')
], 23, 25);
const mixedAtRangeTwo = model.evaluate(state([mixed]), game);
assert.equal(mixedAtRangeTwo.status, 'PARTIAL');
assert.equal(mixedAtRangeTwo.access.breachPaths[0].attackMode, 'RANGED');
assert.equal(mixedAtRangeTwo.access.breachPaths[0].attackRange, 3);
assert.equal(mixedAtRangeTwo.access.breachPaths[0].status, 'REACHABLE');
assert.equal(mixedAtRangeTwo.access.breachPaths[1].attackMode, 'CLOSE');
assert.equal(mixedAtRangeTwo.access.breachPaths[1].status, 'UNKNOWN');
assert.equal(mixedAtRangeTwo.access.criticalAssetsAtRisk[0].earliestLossTick, 600);
assert.equal(mixedAtRangeTwo.access.criticalAssetsAtRisk[0].attackerCount, 1);
assert.equal(mixedAtRangeTwo.risk.recommendedSafeMode, false);
assert.equal(model.telemetrySummary(mixedAtRangeTwo).coordinatedAssets, 0);

// With valid path evidence, close damage joins only after its own arrival.
let mixedSearches = 0;
const mixedPathFinder = { CostMatrix: Matrix, search(origin, goal, options) {
  mixedSearches++;
  assert.equal(goal.range, 1);
  assert.equal(options.maxOps, 200);
  return { incomplete: false, cost: 5, path: [pos(24, 25)] };
} };
const mixedWithRoute = model.evaluate(state([mixed]), game, { pathFinder: mixedPathFinder });
assert.equal(mixedWithRoute.status, 'READY');
assert.equal(mixedWithRoute.pathSearches, 1);
assert.equal(mixedSearches, 1);
assert.equal(mixedWithRoute.access.criticalAssetsAtRisk[0].earliestLossTick, 144);
assert.equal(mixedWithRoute.access.criticalAssetsAtRisk[0].attackerCount, 1);

// One dual-weapon creep never becomes two coordinated attackers.
const mixedAdjacent = model.evaluate(state([{ ...mixed, pos: pos(24, 25) }]), game);
assert.equal(mixedAdjacent.access.criticalAssetsAtRisk[0].earliestLossTick, 139);
assert.equal(mixedAdjacent.access.criticalAssetsAtRisk[0].attackerCount, 1);
assert.equal(model.telemetrySummary(mixedAdjacent).coordinatedAssets, 0);
const mixedPair = model.evaluate(state([
  { ...mixed, pos: pos(24, 25) },
  { ...mixed, id: 'mixed-2', pos: pos(24, 25) }
]), game);
assert.equal(mixedPair.access.criticalAssetsAtRisk[0].attackerCount, 2);
assert.equal(model.telemetrySummary(mixedPair).coordinatedAssets, 1);

// Remaining route searches stay bounded even for dual-mode hostile groups.
let boundedSearches = 0;
const mixedBudgetPF = { CostMatrix: Matrix, search() {
  boundedSearches++;
  return { incomplete: false, cost: 20, path: fullDiagonal };
} };
const mixedHorde = state(Array.from({ length: 6 }, (_, i) => ({
  ...mixed, id: 'mixed-' + i, pos: pos(5, 5)
})));
const mixedBounded = model.evaluate(mixedHorde, game, { pathFinder: mixedBudgetPF });
assert.equal(mixedBounded.pathSearches, 4);
assert.equal(boundedSearches, 4);
assert.equal(mixedBounded.status, 'PARTIAL');
assert.ok(mixedBounded.access.breachPaths.some(p => p.reason === 'PATH_BUDGET'));


// D0.4: two distinct attackers can damage the same *observed* single route
// barrier concurrently. They do not pay its HP independently.
const cooperatingState = state([
  creep([part('attack'), part('move')], 5, 5),
  { ...creep([part('attack'), part('move')], 5, 6), id: 'breacher-2' }
]);
cooperatingState.structures[0] = { ...spawn, pos: pos(8, 5) };
cooperatingState.structures.push({ id: 'shared-wall', structureType: 'constructedWall', hits: 300, pos: pos(6, 5) });
cooperatingState.room.getTerrain = () => ({ get: () => 0 });
const sharedFinder = { CostMatrix: Matrix, search(origin, goal, options) {
  const matrix = options.roomCallback('E8N1').values;
  assert.equal(options.maxOps, 200);
  assert.equal(options.maxRooms, 1);
  if (matrix['6,5'] === 255) return { incomplete: true, path: [] };
  assert.equal(matrix['6,5'], 11); // 300 HP / 30 DPS + 1 plain movement
  return { incomplete: false, cost: 11, path: [pos(6, 5), pos(7, 5)] };
} };
const cooperation = model.evaluate(cooperatingState, game, { pathFinder: sharedFinder });
assert.equal(cooperation.status, 'PARTIAL');
assert.equal(cooperation.pathSearches, 4, 'shared scenario must not require additional searches');
assert.equal(cooperation.access.sharedBarrierGroups, 1);
assert.equal(model.telemetrySummary(cooperation).schemaVersion, 3);
assert.equal(model.telemetrySummary(cooperation).sharedBarrierGroups, 1);
assert.equal(cooperation.access.earliestImpactTick, 107);
assert.equal(cooperation.access.criticalAssetsAtRisk[0].earliestLossTick, 191);
assert.equal(cooperation.access.criticalAssetsAtRisk[0].attackerCount, 2);
for (const path of cooperation.access.breachPaths) {
  assert.equal(path.routeBarrierHits, 300);
  assert.equal(path.routeBarrierCount, 1);
  assert.equal(path.routeBreachTicks, 10, 'independent baseline remains available');
  assert.equal(path.coordinatedBreachTick, 5);
  assert.equal(path.sharedBarrierAttackers, 2);
}
assert.equal(cooperation.risk.recommendedSafeMode, false);

// Solo route retains baseline and no cooperative group.
const singleBreach = model.evaluate({ ...cooperatingState, hostileCreeps: cooperatingState.hostileCreeps.slice(0, 1) }, game, { pathFinder: sharedFinder });
assert.equal(singleBreach.access.sharedBarrierGroups, 0);
assert.equal(singleBreach.access.earliestImpactTick, 112);
assert.equal(singleBreach.access.breachPaths[0].coordinatedBreachTick, undefined);

// Two observed barriers are deliberately not represented as a shared-route
// plan. Both accesses remain independent and the scenario stays PARTIAL.
const twoBarriers = { ...cooperatingState, structures: [
  ...cooperatingState.structures,
  { id: 'second-wall', structureType: 'constructedWall', hits: 300, pos: pos(7, 5) }
] };
const doubleBreach = model.evaluate(twoBarriers, game, { pathFinder: sharedFinder });
assert.equal(doubleBreach.pathSearches, 4);
assert.equal(doubleBreach.access.sharedBarrierGroups, 0);
assert.equal(doubleBreach.access.earliestImpactTick, 122);
assert.equal(doubleBreach.access.breachPaths[0].routeBarrierCount, 2);

// Delayed collaborators start contributing only once they reach the barrier.
// An attacker who arrives after it fell does not delay the breach.
const routeEntry = (actorId, approachTicks, dps, id = 'same') => ({
  actorId, dps, arrivalTicks: approachTicks + 10,
  sharedRouteBarrier: { id, hits: 300, approachTicks, remainingTravelTicks: 2 },
  access: {}
});
const staggered = [routeEntry('one', 0, 30), routeEntry('two', 5, 30)];
assert.equal(model._test.sharedBarrierFinish(staggered, 300), 8);
assert.equal(model._test.coordinateSingleRouteBarriers({ core: staggered }), 1);
assert.deepEqual(staggered.map(e => e.arrivalTicks), [10, 10]);
const lateBreacher = [routeEntry('one', 0, 30), routeEntry('two', 100, 30)];
assert.equal(model._test.sharedBarrierFinish(lateBreacher, 300), 10);
assert.equal(model._test.coordinateSingleRouteBarriers({ core: lateBreacher }), 1);
assert.deepEqual(lateBreacher.map(e => e.arrivalTicks), [12, 102]);

// Same creep with two weapon channels is not a cooperative group.
const dualWeaponOnly = [routeEntry('dual', 0, 30), routeEntry('dual', 0, 10)];
assert.equal(model._test.coordinateSingleRouteBarriers({ core: dualWeaponOnly }), 0);
assert.equal(dualWeaponOnly[0].arrivalTicks, 10);

// Merely having a barrier on each path is insufficient: ID and HP must match.
const distinctBarriers = [routeEntry('one', 0, 30, 'barrier-a'), routeEntry('two', 0, 30, 'barrier-b')];
assert.equal(model._test.coordinateSingleRouteBarriers({ core: distinctBarriers }), 0);
const inconsistentHp = [routeEntry('one', 0, 30), routeEntry('two', 0, 30)];
inconsistentHp[1].sharedRouteBarrier.hits = 200;
assert.equal(model._test.coordinateSingleRouteBarriers({ core: inconsistentHp }), 0);


// D0.5: result.incomplete=false is not itself proof of reachability.
// Never promote an empty, discontinuous, off-room, out-of-range or
// non-integer route to READY, or derive a false emergency from its cost.
const malformedPaths = [
  [],
  [pos(24, 24)],
  [pos(6, 6), pos(24, 24)],
  fullDiagonal.slice(0, -1).map((point, i) => i === 2 ? { ...point, roomName: 'E9N1' } : point),
  fullDiagonal.slice(0, -1),
  fullDiagonal.map((point, i) => i === 2 ? { ...point, x: -1 } : point),
  fullDiagonal.map((point, i) => i === 2 ? { ...point, x: 8.5 } : point),
  fullDiagonal.map((point, i) => i === 2 ? { ...point, y: 50 } : point)
];
for (const path of malformedPaths) {
  const invalid = model.evaluate(state([distant]), game, {
    pathFinder: { CostMatrix: Matrix, search: () => ({ incomplete: false, cost: 20, path }) }
  });
  assert.equal(invalid.status, 'PARTIAL');
  assert.equal(invalid.access.breachPaths[0].reason, 'PATH_INVALID');
  assert.equal(invalid.access.earliestImpactTick, null);
  assert.equal(invalid.risk.recommendedSafeMode, false);
}
for (const cost of [0, -1, NaN, Infinity, undefined]) {
  const invalid = model.evaluate(state([distant]), game, {
    pathFinder: { CostMatrix: Matrix, search: () => ({ incomplete: false, cost, path: fullDiagonal }) }
  });
  assert.equal(invalid.status, 'PARTIAL');
  assert.equal(invalid.access.breachPaths[0].reason, 'PATH_COST_INVALID');
  assert.equal(invalid.access.earliestImpactTick, null);
}
// A claimed "open" route across an observed blocking structure must be
// rejected, rather than bypassing the separate bounded breach search.
const observedWall = state([distant]);
observedWall.structures.push({ id: 'wall-10', structureType: 'constructedWall', hits: 1000, pos: pos(10, 10) });
const fakeOpenRoute = model.evaluate(observedWall, game, {
  pathFinder: { CostMatrix: Matrix, search: () => ({ incomplete: false, cost: 20, path: fullDiagonal }) }
});
assert.equal(fakeOpenRoute.status, 'PARTIAL');
assert.equal(fakeOpenRoute.access.breachPaths[0].reason, 'PATH_BLOCKED');
assert.equal(fakeOpenRoute.access.earliestImpactTick, null);
assert.equal(fakeOpenRoute.pathSearches, 1);

// On a completed second search, geometry must still be legitimate.
const fakeBreachRoute = model.evaluate(breachState, game, {
  pathFinder: { CostMatrix: Matrix, search(origin, goal, options) {
    const value = options.roomCallback('E8N1').values['6,5'];
    return value === 255 ? { incomplete: true, path: [] }
      : { incomplete: false, cost: 10, path: [pos(7, 5)] };
  } }
});
assert.equal(fakeBreachRoute.status, 'PARTIAL');
assert.equal(fakeBreachRoute.access.breachPaths[0].reason, 'BREACH_PATH_INVALID');
assert.equal(fakeBreachRoute.access.earliestImpactTick, null);
assert.equal(fakeBreachRoute.pathSearches, 2);

// D0.6: a complete, contiguous route is not credible if its cost is
// below the number of steps, below observed swamp movement, or it crosses
// a natural wall. None may create a fictional impact or Safe Mode advice.
const understated = model.evaluate(state([distant]), game, {
  pathFinder: { CostMatrix: Matrix, search: () => ({ incomplete: false, cost: 1, path: fullDiagonal }) }
});
assert.equal(understated.status, 'PARTIAL');
assert.equal(understated.access.breachPaths[0].reason, 'PATH_COST_UNDERSTATED');
assert.equal(understated.access.earliestImpactTick, null);
assert.equal(understated.risk.recommendedSafeMode, false);
assert.equal(understated.pathSearches, 1);

const slow = creep([part('attack'), part('attack'), part('move')], 23, 25);
const swampState = state([slow]);
swampState.room.getTerrain = () => ({ get: (x, y) => x === 24 && y === 25 ? 2 : 0 });
const slowPath = cost => ({ CostMatrix: Matrix, search: () => ({ incomplete: false, cost, path: [pos(24, 25)] }) });
const swampUnderstated = model.evaluate(swampState, game, { pathFinder: slowPath(2) });
assert.equal(swampUnderstated.access.breachPaths[0].reason, 'PATH_COST_UNDERSTATED');
assert.equal(swampUnderstated.status, 'PARTIAL');
assert.equal(swampUnderstated.access.earliestImpactTick, null);
const validSwamp = model.evaluate(swampState, game, { pathFinder: slowPath(10) });
assert.equal(validSwamp.status, 'READY');
assert.equal(validSwamp.access.breachPaths[0].travelTicks, 10);
const pavedSwamp = { ...swampState, structures: [...swampState.structures,
  { id: 'road', structureType: 'road', pos: pos(24, 25) }] };
const validRoad = model.evaluate(pavedSwamp, game, { pathFinder: slowPath(1) });
assert.equal(validRoad.status, 'READY');
assert.equal(validRoad.access.breachPaths[0].travelTicks, 1);

const wallTerrain = state([distant]);
wallTerrain.room.getTerrain = () => ({ get: (x, y) => x === 10 && y === 10 ? 1 : 0 });
const throughTerrain = model.evaluate(wallTerrain, game, {
  pathFinder: { CostMatrix: Matrix, search: () => ({ incomplete: false, cost: 20, path: fullDiagonal }) }
});
assert.equal(throughTerrain.access.breachPaths[0].reason, 'PATH_TERRAIN_BLOCKED');
assert.equal(throughTerrain.access.earliestImpactTick, null);
assert.equal(throughTerrain.risk.recommendedSafeMode, false);
assert.equal(throughTerrain.status, 'PARTIAL');

const noTerrain = state([distant]);
delete noTerrain.room.getTerrain;
const unknownTerrain = model.evaluate(noTerrain, game, {
  pathFinder: { CostMatrix: Matrix, search: () => ({ incomplete: false, cost: 20, path: fullDiagonal }) }
});
assert.equal(unknownTerrain.access.breachPaths[0].reason, 'PATH_TERRAIN_UNKNOWN');
assert.equal(unknownTerrain.status, 'PARTIAL');
assert.equal(unknownTerrain.access.earliestImpactTick, null);
const badTerrain = state([distant]);
badTerrain.room.getTerrain = () => ({ get: () => undefined });
assert.equal(model.evaluate(badTerrain, game, {
  pathFinder: { CostMatrix: Matrix, search: () => ({ incomplete: false, cost: 20, path: fullDiagonal }) }
}).access.breachPaths[0].reason, 'PATH_TERRAIN_UNKNOWN');

// Existing legitimate D0.3 and D0.4 scenarios still preserve exact arrivals,
// schema 3 telemetry and the unchanged four-search room budget.
assert.equal(model.SCHEMA_VERSION, 3);
assert.equal(model._test.validPathGeometry([pos(24, 25)], pos(23, 25), spawn.pos, 1), true);
assert.equal(model._test.validPathGeometry([], pos(23, 25), spawn.pos, 1), false);

// D0.7 offline adversarial fixtures: this is modeled observation, NOT live
// combat validation. Simulate a simultaneous mixed attacker, close attacker,
// and healer. A pure healer never increases hostile focused DPS.
const combinedAttackers = state([
  { ...mixed, id: 'mixed-concurrent', pos: pos(23, 25) },
  { ...creep([part('attack'), part('move')], 24, 25), id: 'melee-concurrent' },
  { ...creep([part('heal'), part('move')], 22, 25), id: 'healer-concurrent' }
]);
const combinedObservation = model.evaluate(combinedAttackers, game);
assert.equal(combinedObservation.status, 'PARTIAL', 'missing melee route must stay UNKNOWN');
assert.equal(combinedObservation.authority, 'SHADOW');
assert.equal(combinedObservation.actionAuthority, 'NONE');
assert.equal(combinedObservation.armedCount, 2, 'healer alone is not an attacker');
assert.equal(combinedObservation.aggregate.meleeDps, 150);
assert.equal(combinedObservation.aggregate.rangedDps, 10);
assert.equal(combinedObservation.aggregate.healPerTick, 12);
assert.equal(combinedObservation.pathSearches, 0);
assert.equal(model.telemetrySummary(combinedObservation).unknownPaths, 1);
assert.equal(combinedObservation.access.earliestImpactTick, 100);
assert.equal(combinedObservation.access.criticalAssetsAtRisk[0].attackerCount, 2);
assert.equal(combinedObservation.access.criticalAssetsAtRisk[0].focusedDps, 40,
  'unknown 120 melee DPS from range two must not count');
assert.equal(combinedObservation.access.criticalAssetsAtRisk[0].earliestLossTick, 225);
assert.equal(combinedObservation.risk.recommendedSafeMode, false);
assert.equal(combinedObservation.hostileActors.find(a => a.id === 'mixed-concurrent').nearbyHealPerTick, 12);
assert.equal(combinedObservation.hostileActors.find(a => a.id === 'melee-concurrent').nearbyHealPerTick, 4);

// Boosted melee + ranged damage, tough mitigation, and adjacent heal:
// no intent should be issued, and a healer must not be counted as a
// third contributing attacker in the focused-loss model.
global.BOOSTS = {
  attack: { XUH2O: { attack: 4 } },
  ranged_attack: { XKHO2: { rangedAttack: 4 } },
  tough: { XGHO2: { damage: 0.3 } },
  heal: { XLHO2: { heal: 4, rangedHeal: 4 } }
};
const boostedCombat = state([
  { ...creep([part('attack', 100, 'XUH2O'), part('ranged_attack', 100, 'XKHO2'),
    part('tough', 100, 'XGHO2'), part('move')], 24, 25), id: 'boosted-dual' },
  { ...creep([part('attack', 100, 'XUH2O'), part('move')], 25, 24), id: 'boosted-melee' },
  { ...creep([part('heal', 100, 'XLHO2'), part('move')], 24, 24), id: 'boosted-healer' }
]);
const boostedObservation = model.evaluate(boostedCombat, game);
assert.equal(boostedObservation.status, 'READY');
assert.equal(boostedObservation.armedCount, 2);
assert.equal(boostedObservation.aggregate.meleeDps, 240);
assert.equal(boostedObservation.aggregate.rangedDps, 40);
assert.equal(boostedObservation.aggregate.healPerTick, 48);
assert.equal(boostedObservation.hostileActors[0].strength.effectiveTough, 333.333);
assert.equal(boostedObservation.hostileActors[0].nearbyHealPerTick, 48);
assert.equal(boostedObservation.hostileActors[1].nearbyHealPerTick, 48);
assert.equal(boostedObservation.pathSearches, 0);
assert.equal(boostedObservation.access.criticalAssetsAtRisk[0].attackerCount, 2);
assert.equal(boostedObservation.access.criticalAssetsAtRisk[0].focusedDps, 280);
assert.equal(boostedObservation.access.criticalAssetsAtRisk[0].earliestLossTick, 118);
assert.equal(boostedObservation.risk.state, 'EMERGENCY');
assert.equal(boostedObservation.risk.recommendedSafeMode, true);
assert.equal(boostedObservation.risk.safetyAuthority, 'LEGACY_UNCHANGED');
assert.equal(boostedObservation.actionAuthority, 'NONE');

// Same attackers behind one real covering rampart must pay its hits ONCE.
// The observed barrier delays the estimate without authorizing Safe Mode.
const boostedProtected = {
  ...boostedCombat,
  structures: [...boostedCombat.structures,
    { id: 'observed-rampart', my: true, structureType: 'rampart',
      hits: 2000, pos: spawn.pos }]
};
const protectedCombat = model.evaluate(boostedProtected, game);
assert.equal(protectedCombat.access.criticalAssetsAtRisk[0].barrierHits, 2000);
assert.equal(protectedCombat.access.criticalAssetsAtRisk[0].impactTick, 108);
assert.equal(protectedCombat.access.criticalAssetsAtRisk[0].earliestLossTick, 125);
assert.equal(protectedCombat.risk.state, 'EMERGENCY',
  '25-tick loss horizon is inclusive');
assert.equal(protectedCombat.risk.recommendedSafeMode, true);
boostedProtected.structures.at(-1).hits = 2200;
const outsideHorizon = model.evaluate(boostedProtected, game);
assert.equal(outsideHorizon.access.criticalAssetsAtRisk[0].earliestLossTick, 126);
assert.equal(outsideHorizon.risk.state, 'DEFENSE');
assert.equal(outsideHorizon.risk.recommendedSafeMode, false);
delete global.BOOSTS;

// Bounded incomplete PathFinder evidence under a concurrent mixed-weapon
// horde must never be promoted to a verified impact or action authority.
let incompleteSearches = 0;
const incompleteConcurrentFinder = { CostMatrix: Matrix, search(origin, goal, options) {
  incompleteSearches++;
  assert.equal(options.maxOps, 200);
  assert.equal(options.maxRooms, 1);
  return { incomplete: true, path: [] };
} };
const unprovenHorde = state([
  ...Array.from({ length: 6 }, (_, i) => ({
    ...mixed, id: 'uncertain-mixed-' + i, pos: pos(5, 5)
  })),
  { ...creep([part('heal'), part('move')], 5, 5), id: 'uncertain-healer' }
]);
const unprovenCombat = model.evaluate(unprovenHorde, game,
  { pathFinder: incompleteConcurrentFinder });
assert.equal(unprovenCombat.pathSearches, 4);
assert.equal(incompleteSearches, 4);
assert.equal(unprovenCombat.status, 'PARTIAL');
assert.equal(unprovenCombat.access.earliestImpactTick, null);
assert.equal(unprovenCombat.access.criticalAssetsAtRisk.length, 0);
assert.ok(unprovenCombat.access.breachPaths.some(p => p.reason === 'PATH_BUDGET'));
assert.equal(unprovenCombat.risk.recommendedSafeMode, false);
assert.equal(unprovenCombat.actionAuthority, 'NONE');

console.log('D0 threat model shadow tests passed');
