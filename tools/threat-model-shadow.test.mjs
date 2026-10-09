import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const model = require('../game/threat.model.shadow.js');
global.BOOSTS = { attack: { XUH2O: { attack: 4 } }, tough: { XGHO2: { damage: 0.3 } }, move: { XZHO2: { fatigue: 4 } } };
const pos = (x, y) => ({ x, y, roomName: 'E8N1' });
const part = (type, hits = 100, boost) => ({ type, hits, boost });
const creep = (body, x = 24, y = 25) => ({ id: 'enemy', body, pos: pos(x, y), owner: { username: 'enemy' }, store: {} });
const spawn = { id: 'spawn', my: true, structureType: 'spawn', hits: 5000, pos: pos(25, 25) };
const state = hostileCreeps => ({ room: { name: 'E8N1', controller: { my: true, safeModeAvailable: 1 } }, hostileCreeps, structures: [spawn], sources: [] });
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
let searchCount = 0;
const pf = { CostMatrix: Matrix, search(origin, goal, options) {
  searchCount++;
  assert.equal(options.maxOps, 200);
  assert.equal(options.maxRooms, 1);
  assert.equal(options.roomCallback('E8N1').values['25,25'], 255);
  assert.equal(options.roomCallback('E9N1'), false);
  return { incomplete: false, cost: 20, path: [] };
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
pf.search = () => ({ incomplete: false, cost: 20, path: [] });
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
  return { incomplete: false, cost: 10, path: [pos(24, 25)] };
} };
const mixedHorde = state(Array.from({ length: 6 }, (_, i) => ({
  ...mixed, id: 'mixed-' + i, pos: pos(5, 5)
})));
const mixedBounded = model.evaluate(mixedHorde, game, { pathFinder: mixedBudgetPF });
assert.equal(mixedBounded.pathSearches, 4);
assert.equal(boundedSearches, 4);
assert.equal(mixedBounded.status, 'PARTIAL');
assert.ok(mixedBounded.access.breachPaths.some(p => p.reason === 'PATH_BUDGET'));

console.log('D0 threat model shadow tests passed');
