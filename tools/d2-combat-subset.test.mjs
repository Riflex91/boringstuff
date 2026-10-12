import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const d2=require('../game/defense.reinforcement.shadow.js');
const choose=d2._test.minimumCombatSubset;
const defender=(id,damagePerTick,healPerTick,effectiveHits,bodyReplacementEnergy)=>({
  id,damagePerTick,healPerTick,effectiveHits,bodyReplacementEnergy,
  ticksToLive:200
});
const demand={damagePerTick:32,healPerTick:20,effectiveHits:120};
const available=[
  defender('b-attack',30,0,200,130),
  defender('z-heal',0,24,300,550),
  defender('a-attack',30,0,200,130),
  defender('c-attack',30,0,200,130)
];
const before=JSON.stringify({available,demand});
const selection=choose(available,demand);
assert.deepEqual(selection,{
  replacementEnergy:810,
  defenderCount:3,
  defenderIds:['a-attack','b-attack','z-heal'],
  combatCapacity:{damagePerTick:60,healPerTick:24,effectiveHits:700}
});
assert.deepEqual(choose([...available].reverse(),{...demand}),selection);
assert.equal(JSON.stringify({available,demand}),before,
  'D2 subset selection must not mutate caller states');

// A single expensive all-rounder cannot beat a cheaper complete group.
const option=choose([...available,defender('combo',60,24,500,900)],demand);
assert.deepEqual(option,selection);
const onlyCombo=choose([defender('combo',60,24,500,900)],demand);
assert.equal(onlyCombo.replacementEnergy,900);
assert.equal(onlyCombo.defenderCount,1);
assert.deepEqual(onlyCombo.defenderIds,['combo']);
assert.equal(choose(available,{damagePerTick:91,healPerTick:20,effectiveHits:120}),null,
  'No synthetic fractional defender or fabricated capacity');

// Distinct same-cost whole-body subsets break ties by smaller group size,
// then stable creep identity, irrespective of input enumeration.
const sameCost=[
  defender('group-b',30,24,300,500),
  defender('group-a',30,24,300,500),
  defender('split-attack',30,0,200,200),
  defender('split-heal',0,24,200,300)
];
const ties=choose(sameCost,{damagePerTick:30,healPerTick:20,effectiveHits:300});
assert.deepEqual(ties.defenderIds,['group-a']);
assert.deepEqual(choose([...sameCost].reverse(),
  {damagePerTick:30,healPerTick:20,effectiveHits:300}),ties);

// Never double-count one creep identity across copies of the same object.
assert.equal(choose([...available,available[0]],demand),null);
assert.equal(choose([{...available[0],id:''}],demand),null);
assert.equal(choose([defender('broken',NaN,24,300,500)],demand),null);
assert.equal(choose([defender('broken',30,24,300,Infinity)],demand),null);
assert.equal(choose(available,{...demand,effectiveHits:NaN}),null);
assert.equal(choose(available,{damagePerTick:0,healPerTick:0,effectiveHits:100}),null);
assert.equal(choose([],demand),null);

// Runtime remains bounded: 11 whole defenders -> at most 2^11-1 subsets.
// The twelfth defender is explicitly unsupported, never silently sampled.
const bounded=Array.from({length:11},(_,i)=>
  defender('creep-'+String(i).padStart(2,'0'),10,10,200,100));
const maximum=choose(bounded,{damagePerTick:60,healPerTick:60,effectiveHits:1100});
assert.equal(maximum.defenderCount,6);
assert.equal(maximum.replacementEnergy,600);
assert.equal(choose([...bounded,defender('overflow',10,10,200,100)],demand),null);

const source=fs.readFileSync(path.join(here,'../game/defense.reinforcement.shadow.js'),'utf8');
assert.ok(source.includes("status: 'NON_EXECUTABLE_PROJECTION'"));
for(const forbidden of [
  /\.moveTo\s*\(/,/\.attack\s*\(/,/\.heal\s*\(/,
  /\.spawnCreep\s*\(/,/\.activateSafeMode\s*\(/,
  /Memory\s*\./,/\.reserve\s*\(/
])assert.equal(forbidden.test(source),false);
console.log('D2 bounded whole-body minimum cost shadow subsets PASS');
