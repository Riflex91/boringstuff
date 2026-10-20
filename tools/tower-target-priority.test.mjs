import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const nodeRequire=createRequire(import.meta.url);

const source = fs.readFileSync(new URL('../game/tower.manager.js', import.meta.url), 'utf8');
const context = {
  module: { exports: {} },
  require(name) {
    if (name === 'logger') return { warn() {} };
    if (name === 'defense.siege.triage')
      return nodeRequire('../game/defense.siege.triage.js');
    throw new Error('Unexpected dependency: ' + name);
  },
  STRUCTURE_SPAWN: 'spawn',
  STRUCTURE_TOWER: 'tower',
  STRUCTURE_STORAGE: 'storage',
  STRUCTURE_WALL: 'constructedWall',
  STRUCTURE_RAMPART: 'rampart',
  RESOURCE_ENERGY: 'energy'
};
vm.runInNewContext(source, context, { filename: 'tower.manager.js' });
const { selectHostile, hostilePriority } = context.module.exports._test;
const spawn = { structureType: 'spawn', pos: { x: 10, y: 10 } };
const hostile = (id, body, x) => ({
  id, body: body.map(type => ({ type, hits: 100 })),
  pos: { getRangeTo(target) { return Math.max(Math.abs(x - target.pos.x), 0); } }
});
const harmless = hostile('harmless', ['move'], 18);
const attacker = hostile('attacker', ['attack', 'move'], 12);
const healer = hostile('healer', ['heal', 'move'], 16);
const state = { hostileCreeps: [harmless, attacker, healer], structures: [spawn] };
assert.equal(selectHostile(state).id, 'healer');
assert.equal(selectHostile({ ...state, hostileCreeps: [harmless, attacker] }).id, 'attacker');
assert.equal(selectHostile({ ...state, hostileCreeps: [] }), null);
assert.equal(hostilePriority(hostile('dead', [{type:'heal',hits:0}].map(p=>p.type),18), state) >= 0, true);
const deadHealer = hostile('dead', ['heal'], 18);
deadHealer.body[0].hits = 0;
assert.ok(hostilePriority(healer, state) > hostilePriority(deadHealer, state));
const towers = [{ attack(target) { this.target = target.id; } }];
context.module.exports.run({ ...state, towers, room: { name: 'W1N1' } });
assert.equal(towers[0].target, 'healer');
console.log('Tower hostile priority regression PASS');
