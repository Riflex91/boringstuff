import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../game/spawn.manager.js', import.meta.url), 'utf8');
const ctx = { module: { exports: {} }, require(name) {
  if (name === 'config') return {};
  return {};
} };
vm.runInNewContext(source, ctx);
const demand = ctx.module.exports._test.defenderDemand;
const enemy = (...parts) => ({ body: parts.map(type => ({ type, hits: 100 })) });
assert.equal(demand([]), 0);
assert.equal(demand([enemy('move', 'carry')]), 0);
assert.equal(demand([enemy('attack')]), 1);
assert.equal(demand([enemy('attack', 'attack', 'attack', 'attack', 'attack')]), 2);
assert.equal(demand([enemy('heal', 'heal', 'ranged_attack', 'attack', 'attack')]), 2);
assert.equal(demand([enemy(...Array(30).fill('attack'))]), 3);
assert.equal(demand([{}]), 1, 'unknown body uses conservative fallback');
const disabled = enemy('attack'); disabled.body[0].hits = 0;
assert.equal(demand([disabled]), 0);
// Production body constructor remains the old melee template for scouts and
// melee intruders, but buys viable ranged weapon capacity for ranged pressure.
const bodySource=fs.readFileSync(
  new URL('../game/body.builder.js',import.meta.url),'utf8');
const bodies={module:{exports:{}},WORK:'work',CARRY:'carry',
  MOVE:'move',TOUGH:'tough',ATTACK:'attack',RANGED_ATTACK:'ranged_attack',
  BODYPART_COST:{work:100,carry:50,move:50,tough:10,
    attack:80,ranged_attack:150}};
vm.runInNewContext(bodySource,bodies);
const defenderBody=bodies.module.exports.defender;
assert.deepEqual(Array.from(defenderBody(260,[enemy('ranged_attack')])),
  ['tough','move','ranged_attack','move'],
  'when ranged hostiles dominate, construct a real ranged-capable body');
assert.deepEqual(Array.from(defenderBody(600,[enemy('ranged_attack')])),
  ['tough','move','ranged_attack','move',
   'tough','move','ranged_attack','move']);
assert.deepEqual(Array.from(defenderBody(600,[enemy('attack')])),
  ['tough','move','attack','move',
   'tough','move','attack','move',
   'tough','move','attack','move'],
  'melee-only emergency retains existing body cost and pattern');
assert.equal(defenderBody(600,[enemy('move','carry')]).includes('ranged_attack'),false,
  'unarmed scouts may not consume the ranged template');
assert.equal(defenderBody(600,[enemy('ranged_attack','attack','attack')])
  .includes('ranged_attack'),false,'mixed melee-dominant raid uses melee template');
const deadRanged=enemy('ranged_attack');
deadRanged.body[0].hits=0;
assert.equal(defenderBody(600,[deadRanged]).includes('ranged_attack'),false,
  'destroyed hostile ranged parts do not influence threat composition');
console.log('D1 defender capacity tests PASS');
