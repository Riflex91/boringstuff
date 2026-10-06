import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CostMatrix, snapshot, pos } from './pathing-fixtures.mjs';
const require = createRequire(import.meta.url);
const costs = require('../game/path.costs.js');
const pf = { CostMatrix };
const item = (structureType, x, y, extra = {}) => ({ structureType, pos: pos(x, y), ...extra });
{
  const s = snapshot();
  s.terrain = { get: (x, y) => x === 0 ? 1 : y === 0 ? 2 : 0 };
  s.structures = [item('road', 0, 0), item('road', 1, 0), item('road', 2, 2),
    item('spawn', 2, 2), item('container', 3, 3), item('rampart', 4, 4),
    item('rampart', 5, 5, { my: true }), item('rampart', 6, 6, { isPublic: true })];
  const field = costs.field(s, {}, pf);
  assert.equal(field.matrix.get(0, 0), 255, 'road cannot reopen terrain wall');
  assert.equal(field.matrix.get(1, 0), 1);
  assert.equal(field.matrix.get(2, 2), 255, 'road cannot reopen spawn');
  assert.equal(field.matrix.get(3, 3), 2);
  assert.equal(field.matrix.get(4, 4), 255);
  assert.equal(field.matrix.get(5, 5), 2);
  assert.equal(field.matrix.get(6, 6), 2);
  assert.equal(field.matrix.get(8, 0), 10);
  field.matrix.set(8, 8, 255);
  assert.equal(costs.field(s, {}, pf).matrix.get(8, 8), 2, 'clone isolates cached field');
  s.structures.push(item('extension', 8, 8));
  const changed = costs.field(s, {}, pf);
  assert.notEqual(changed.revision, field.revision);
  assert.equal(changed.matrix.get(8, 8), 255);
}
{
  const s = snapshot();
  s.sources = [{ pos: pos(1, 1) }]; s.minerals = [{ pos: pos(2, 2) }]; s.controller = { pos: pos(3, 3) };
  s.sites = [item('extension', 4, 4, { my: true }), item('extension', 5, 5, { my: false })];
  s.planned = [{ type: 'road', pos: pos(6, 6) }, { type: 'storage', pos: pos(7, 7) }];
  s.stationary = [pos(8, 8)]; s.congestion = [{ pos: pos(9, 9), weight: 2 }];
  const m = costs.build(s, { plannedRoads: true, plannedStructures: true }, pf);
  for (const n of [1, 2, 3, 4, 7]) assert.equal(m.get(n, n), 255);
  assert.equal(m.get(5, 5), 2);
  assert.equal(m.get(6, 6), 1);
  assert.equal(m.get(8, 8), 12);
  assert.equal(m.get(9, 9), 12);
  assert.equal(costs.build(s, {}, pf).get(7, 7), 2);
}
{
  const s = snapshot();
  s.hostiles = [{ pos: pos(10, 10), body: [{ type: 'ranged_attack', hits: 100 }] },
    { pos: pos(30, 30), body: [{ type: 'move', hits: 100 }, { type: 'attack', hits: 0 }] }];
  s.keepers = [{ pos: pos(40, 40) }];
  const m = costs.build(s, {}, pf);
  assert.equal(m.get(14, 14), 255, 'ranged danger includes one-step movement');
  assert.equal(m.get(15, 15), 2);
  assert.equal(m.get(30, 30), 2, 'damaged weapons and harmless scouts do not create threat');
  assert.equal(m.get(35, 35), 255);
  assert.equal(costs.build(s, { avoidHostiles: false, avoidKeepers: false }, pf).get(10, 10), 2);
}
{
  const s = snapshot();
  s.structures = [item('road', 7, 7), item('spawn', 8, 8)];
  const revision = costs.signature(s);
  s.structures.reverse();
  assert.equal(costs.signature(s), revision, 'input ordering is irrelevant');
  assert.notEqual(costs.signature(s, { swamp: 2 }), revision, 'movement profile changes key');
  assert.equal(costs.build({}, {}, pf), null);
  assert.equal(costs.field(null, {}, pf), null);
}
console.log('path costs tests passed');
