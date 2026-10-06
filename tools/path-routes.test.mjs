import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { snapshot, pos, referenceFinder } from './pathing-fixtures.mjs';
process.env.NODE_PATH = fileURLToPath(new URL('../game', import.meta.url));
Module._initPaths();
const require = createRequire(import.meta.url);
const routes = require('../game/path.routes.js');
const costs = require('../game/path.costs.js');
function fixture() {
  costs.clear();
  const s = snapshot();
  const memory = {};
  const pf = referenceFinder();
  const game = { time: 100, rooms: { E1N1: { name: 'E1N1', controller: { my: true } } },
    cpu: { getUsed: () => 1 } };
  return { s, game, memory, pathFinder: pf, snapshots: { E1N1: s } };
}
const origin = pos(10, 10), goal = { pos: pos(15, 10), range: 0 };
const options = { maxOps: 2500, cpuCeiling: 10 };
{
  const c = fixture();
  c.s.structures.push({ structureType: 'constructedWall', pos: pos(12, 10) });
  const first = routes.search(origin, goal, options, c);
  assert.equal(first.complete, true);
  assert.equal(first.cacheHit, false);
  assert.equal(first.path.some(p => p.x === 12 && p.y === 10), false);
  assert.deepEqual(first.path.at(-1), goal.pos);
  assert.equal(c.pathFinder.calls, 1);
  // Real Memory survives JSON persistence; heap cost cache may be gone.
  c.memory = JSON.parse(JSON.stringify(c.memory)); costs.clear(); c.game.time++;
  const second = routes.search(origin, goal, options, c);
  assert.equal(second.cacheHit, true);
  assert.deepEqual(second.path, first.path);
  assert.equal(c.pathFinder.calls, 1);
  const changed = routes.search(origin, goal, { ...options, movement: { id: 'fast', plain: 1 } }, c);
  assert.equal(changed.cacheHit, false);
  assert.equal(changed.cost, first.cost / 2);
  const zeroRange = routes.search(origin, { pos: origin, range: 0 }, options, c);
  assert.equal(zeroRange.complete, true); assert.equal(zeroRange.path.length, 0);
}
{
  const c = fixture();
  const first = routes.search(origin, goal, options, c);
  const block = first.path[0];
  c.s.structures.push({ structureType: 'extension', pos: block });
  c.game.time++;
  const changed = routes.search(origin, goal, options, c);
  assert.equal(changed.complete, true); assert.equal(changed.cacheHit, false);
  assert.equal(changed.path.some(p => p.x === block.x && p.y === block.y), false);
  assert.ok(routes.summary(c.memory).invalidations >= 1);
  assert.equal(routes.feedback(changed.key, 'STUCK', c.memory), true);
  assert.equal(routes.search(origin, goal, options, c).cacheHit, false);
  c.game.time += 101;
  assert.equal(routes.search(origin, goal, options, c).cacheHit, false, 'TTL expires');
  c.memory.bot.pathRoutes.schemaVersion = -1;
  assert.equal(routes.search(origin, goal, options, c).cacheHit, false, 'old schema resets derived cache');
}
{
  const c = fixture();
  c.s.hostiles = [{ pos: pos(13, 10), body: [{ type: 'attack', hits: 100 }] }];
  const r = routes.search(origin, { pos: pos(20, 10), range: 0 }, options, c);
  assert.equal(r.complete, true);
  assert.ok(r.path.every(p => Math.max(Math.abs(p.x - 13), Math.abs(p.y - 10)) > 2));
  c.s.hostiles[0].pos = pos(18, 10);
  const changed = routes.search(origin, { pos: pos(20, 10), range: 0 }, options, c);
  assert.equal(changed.complete, false, 'new hostile blocks endpoint');
  assert.equal(changed.reason, 'INCOMPLETE');
}
{
  const c = fixture();
  assert.equal(routes.search(origin, goal, { ...options, maxOps: 1 }, c).reason, 'INCOMPLETE');
  assert.equal(routes.summary(c.memory).paths, 0, 'partial routes are never cached as success');
  const calls = c.pathFinder.calls;
  assert.equal(routes.search(origin, goal, { ...options, cpuCeiling: 0 }, c).reason, 'CPU_BUDGET');
  assert.equal(c.pathFinder.calls, calls);
  assert.equal(routes.search(origin, goal, { ...options, lowCpu: true }, c).reason, 'CPU_BUDGET');
  assert.equal(routes.search(origin, goal, {}, { game: c.game, memory: c.memory, pathFinder: {} }).reason, 'API_UNAVAILABLE');
  c.pathFinder.search = () => { throw Error('optional engine failure'); };
  assert.equal(routes.search(origin, goal, options, c).reason, 'PATHFINDER_ERROR');
}
{
  const c = fixture();
  c.pathFinder.search = () => ({ incomplete: false, path: [goal.pos], cost: 1 });
  assert.equal(routes.search(origin, goal, options, c).reason, 'INVALID_PATH');
}
{
  const c = fixture();
  const intel = { E2N1: { observation: { lastSeenTick: 100, confidence: 0.8 }, controller: {}, threat: {} } };
  c.game.map = { findRoute(from, to, opts) {
    assert.equal(from, 'E1N1'); assert.equal(to, 'E2N1');
    assert.ok(opts.routeCallback('E2N1') < Infinity);
    assert.equal(opts.routeCallback('W9N9'), Infinity);
    return [{ exit: 3, room: 'E2N1' }];
  } };
  const start = pos(49, 10), target = { pos: pos(0, 10, 'E2N1'), range: 0 };
  c.pathFinder.search = (a, b, opts) => {
    assert.equal(opts.roomCallback('W9N9'), false, 'tile search stays inside approved route');
    assert.equal(opts.roomCallback('E2N1'), undefined, 'no-vision room uses terrain-only with explicit confidence');
    return { incomplete: false, path: [target.pos], ops: 1, cost: 2 };
  };
  const first = routes.search(start, target, { ...options, intel }, c);
  assert.equal(first.complete, true); assert.equal(first.confidence, 0.8);
  intel.E2N1.threat.hostileCreeps = 1;
  assert.equal(routes.search(start, target, { ...options, intel }, c).reason, 'UNSAFE_TARGET');
  intel.E2N1.threat.hostileCreeps = 0;
  c.game.time = 1601;
  assert.equal(routes.search(start, target, { ...options, intel }, c).reason, 'UNSAFE_TARGET');
  assert.equal(routes.roomSafety('E2N1', { intel, allowUnknown: true }, c.game).confidence, 0);
  c.game.rooms.E2N1 = { controller: { owner: { username: 'enemy' } } };
  assert.equal(routes.roomSafety('E2N1', {}, c.game).allowed, false);
}
{
  const c = fixture();
  c.game.map = { findRoute: () => [{ room: 'E2N1' }, { room: 'E3N1' }] };
  assert.equal(routes.search(origin, { pos: pos(10, 10, 'E3N1') },
    { ...options, allowUnknown: true, maxRooms: 2 }, c).reason, 'ROOM_LIMIT');
  c.game.map.findRoute = () => -2;
  assert.equal(routes.search(origin, { pos: pos(10, 10, 'E3N1') },
    { ...options, allowUnknown: true }, c).reason, 'NO_ROOM_ROUTE');
}
{
  const points = [pos(49, 49), pos(0, 49, 'E2N1'), pos(1, 48, 'E2N1')];
  assert.deepEqual(routes.unpack(routes.pack(points)), points);
  assert.equal(routes.unpack([{ roomName: 'x', coordinates: '?' }]), null);
  assert.equal(routes.unpack([{ roomName: 'x', coordinates: '??' }]), null);
  const memory = {};
  const cache = routes._test.root(memory);
  for (let i = 0; i < 100; i++) cache.paths[String(i)] = {
    createdTick: 1, lastUsedTick: i, expiresTick: 1000, rooms: ['E1N1'], padding: 'x'.repeat(3000)
  };
  routes._test.trim(cache, 100);
  assert.ok(Object.keys(cache.paths).length <= routes._test.MAX_ENTRIES);
  assert.ok(JSON.stringify(cache).length * 2 <= routes._test.MAX_BYTES);
  routes._test.trim(cache, 1000);
  assert.equal(Object.keys(cache.paths).length, 0);
}
console.log('path routes tests passed');
