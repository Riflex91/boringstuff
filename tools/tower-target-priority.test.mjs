import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../game/tower.manager.js', import.meta.url), 'utf8');
const warnings = [];
const context = {
  module: { exports: {} },
  require(name) {
    if (name === 'logger') return { warn(...args) { warnings.push(args); } };
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

assert.equal(warnings.length,1);
assert.equal(warnings[0][0],'TOWER_ENGAGE');
assert.equal(warnings[0][2].attackIntentCount,1);
assert.equal(warnings[0][2].unknownReturnCodes,1,
  'undefined/mock result is UNKNOWN, not a successful hit');
assert.equal(warnings[0][2].hitOrKillVerified,false);

let accepted=0, empty=0, malformed=0;
const results=[
  {store:{energy:500},attack(target) {
    accepted++;assert.equal(target.id,'healer');return 0;
  }},
  {store:{energy:0},attack(target) {
    empty++;assert.equal(target.id,'healer');return -6;
  }},
  {store:{energy:50},attack(target) {
    malformed++;assert.equal(target.id,'healer');return undefined;
  }}
];
context.module.exports.run({...state,towers:results,room:{name:'E8N1'}});
assert.equal(accepted,1);
assert.equal(empty,1);
assert.equal(malformed,1);
const outcome=warnings.at(-1)[2];
assert.equal(outcome.attackIntentCount,3);
assert.equal(outcome.acceptedIntentCount,1);
assert.equal(outcome.unknownReturnCodes,1);
assert.equal(outcome.towersWithVerifiedEnergy,3);
assert.equal(outcome.towersReadyAtIntent,2);
assert.equal(outcome.hitOrKillVerified,false);
assert.deepEqual(JSON.parse(JSON.stringify(outcome.attackReturnCodeCounts)),
  {'0':1,'-6':1},
  'capture each actual integer return code without implying damage');

const missingAmmo=[{attack:()=>0,store:{}}];
context.module.exports.run({...state,towers:missingAmmo,room:{name:'E8N1'}});
assert.equal(warnings.at(-1)[2].towersReadyAtIntent,null,
  'unknown tower energy must not become zero or healthy');
assert.equal(warnings.at(-1)[2].acceptedIntentCount,1,
  'do not infer actual damage even from OK');

console.log('Tower hostile priority regression PASS');
