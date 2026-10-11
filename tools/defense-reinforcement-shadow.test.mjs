import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);
const d1 = require('../game/defense.requests.shadow.js');
const e0 = require('../game/defense.registry.preview.js');
const d2 = require('../game/defense.reinforcement.shadow.js');

const game = { time: 100 };
const pos = (x, y, roomName) => ({ x, y, roomName });
const part = (type, options = {}) => ({ type, hits: 100, ...options });

function creep(id, room, body, ttl = 150, role = 'defender') {
  return { id, my: true, room: { name: room }, memory: { role },
    ticksToLive: ttl, body };
}
function donor(room, options = {}) {
  const state = {
    room: { name: room, controller: { my: true } },
    hostileCreeps: [], emergency: false,
    energyStored: 5000, energyCapacityAvailable: 450,
    spawn: { spawning: null }, creeps: [
      // A strong resident defender is never dispatched.
      creep(room + '-reserve', room, [
        part('attack'),part('attack'),part('heal'),part('heal'),
        part('heal'),part('move')]),
      creep(room + '-attack1', room, [part('attack'),part('move')]),
      creep(room + '-attack2', room, [part('attack'),part('move')]),
      creep(room + '-healer', room, [part('heal'),part('heal'),part('move')])
    ],
    structures: []
  };
  const d0 = { schemaVersion: 3, authority: 'SHADOW',
    actionAuthority: 'NONE', status: 'READY', roomName: room,
    tick: 100, hostileCount: 0, armedCount: 0,
    aggregate: { meleeDps: 0, rangedDps: 0, healPerTick: 0,
      dismantlePerTick: 0, effectiveHits: 0 },
    risk: { state: 'NORMAL' }, access: { criticalAssetsAtRisk: [] } };
  state.defenseRequestsShadow = d1.evaluate(state, d0, game);
  state.defenseRegistryPreview = e0.evaluate(state.defenseRequestsShadow, game);
  return Object.assign(state, options);
}

function target() {
  const room = 'W37N11';
  const state = {
    room: { name: room, controller: { my: true } },
    hostileCreeps: [{}], emergency: false,
    energyStored: 150, energyCapacityAvailable: 450,
    spawn: { spawning: null },
    structures: [
      { id: 'core', my: true, structureType: 'spawn',
        pos: pos(10,10,room), hits: 500, hitsMax: 1000 },
      { id: 'tower', my: true, structureType: 'tower',
        pos: pos(12,12,room),
        store: { energy: 5, getCapacity: () => 1000 } },
      { id: 'ramp', my: true, structureType: 'rampart',
        pos: pos(11,10,room), hits: 500 }
    ],
    creeps: []
  };
  const d0 = { schemaVersion: 3, authority: 'SHADOW',
    actionAuthority: 'NONE', status: 'READY', roomName: room,
    tick: 100, hostileCount: 1, armedCount: 1,
    aggregate: { meleeDps: 30, rangedDps: 10, healPerTick: 12,
      dismantlePerTick: 0, effectiveHits: 1000 },
    risk: { state: 'DEFENSE' }, access: { criticalAssetsAtRisk: [
      { assetId: 'core', earliestLossTick: 145, impactTick: 115 }
    ] } };
  state.defenseRequestsShadow = d1.evaluate(state, d0, game);
  state.defenseRegistryPreview = e0.evaluate(state.defenseRequestsShadow, game);
  assert.equal(state.defenseRegistryPreview.status, 'PROJECTED');
  return state;
}
const dst=target(), src=donor('W36N11'), src2=donor('W36N12');
const route = (from, to, travelTicks, overrides = {}) => ({
  from,to,travelTicks,source:'TRACKED_DEFENDER_TRANSIT',
  status:'VERIFIED',risk:'CLEAR',observedTick:100,...overrides
});
const routes = {
  'W36N11>W37N11': route('W36N11','W37N11',12),
  'W36N12>W37N11': route('W36N12','W37N11',8)
};
const memory = { bot: { requestRegistry: { sentinel: 'unchanged' } } };
globalThis.Memory = memory;
const before = JSON.stringify({ dst, src, src2, memory });
const output = d2.evaluate([dst, src, src2], routes, game);
assert.equal(output.authority, 'SHADOW');
assert.equal(output.actionAuthority, 'NONE');
assert.equal(output.summary.executable, false);
assert.equal(output.summary.writesToGameMemory, false);
assert.equal(output.summary.selectedCount, 1);
assert.equal(output.supportRequests.length, 1);
const req = output.supportRequests[0];
assert.equal(req.type, 'DEFENSE');
assert.equal(req.targetColony, 'W37N11');
assert.equal(req.latestUsefulArrivalTick,145);
assert.deepEqual(req.requestedCapacity, {
  damagePerTick: 32, healPerTick: 20, effectiveHits: 120 });
assert.equal(req.amount,32);
assert.equal(req.candidateProviders.length,2);
assert.equal(req.status,'PROPOSED_SHADOW');
assert.equal(req.selectedProvider,'W36N12','equal cost chooses faster arrival');
assert.equal(req.transportOrSpawnPlan.status,'NON_EXECUTABLE_PROJECTION');
assert.equal(req.transportOrSpawnPlan.replacementEnergyBudget,810);
for(const candidate of req.candidateProviders) {
  assert.equal(candidate.status,'ELIGIBLE_SHADOW');
  assert.equal(candidate.defenderCount,3);
  assert.equal(candidate.replacementEnergy,810);
  assert.equal(candidate.spareEnergyBudget,4100);
  assert.equal(candidate.availableCapacity.damagePerTick,60);
  assert.equal(candidate.availableCapacity.healPerTick,24);
  assert.equal(candidate.localReserve.healPerTick,36);
}
assert.deepEqual(d2.evaluate([dst,src,src2],routes,game),output);
assert.equal(JSON.stringify({ dst, src, src2, memory }),before,
  'No caller state, D1, registry, creep or game Memory may change');

function blocked(states, evidence, expected, ticks = game) {
  const value=d2.evaluate(states,evidence,ticks);
  assert.equal(value.summary.selectedCount,0);
  assert.equal(value.supportRequests.length,1);
  assert.equal(value.supportRequests[0].status,'BLOCKED');
  if (expected) assert.equal(value.supportRequests[0].candidateProviders[0].reason,expected);
  return value;
}
assert.equal(blocked([dst,src],null,
  'OBSERVED_TRANSIT_ETA_REQUIRED').supportRequests[0].reason,
  'NO_VERIFIED_AFFORDABLE_TIMELY_DONOR');
blocked([dst,src],{ 'W36N11>W37N11':route('W36N11','W37N11',15,
  { observedTick: -1 }) },'OBSERVED_TRANSIT_ETA_REQUIRED');
blocked([dst,src],{ 'W36N11>W37N11':route('W36N11','W37N11',12,
  { status:'ESTIMATED' }) },'OBSERVED_TRANSIT_ETA_REQUIRED');
blocked([dst,src],{ 'W36N11>W37N11':route('W36N11','W37N11',12,
  { risk:'UNKNOWN' }) },'OBSERVED_TRANSIT_ETA_REQUIRED');
blocked([dst,src],{ 'W36N11>W37N11':route('W36N11','W37N11',46) },
  'LATE_ARRIVAL');
blocked([dst,{ ...src, emergency: true }],routes,'DONOR_NOT_VERIFIED_CLEAR');
blocked([dst,{ ...src, hostileCreeps:[{}] }],routes,'DONOR_NOT_VERIFIED_CLEAR');
blocked([dst,{ ...src, energyStored:1000 }],routes,'REPLACEMENT_BUDGET_SHORTFALL');
blocked([dst,{ ...src, energyStored:NaN }],routes,'ENERGY_BUDGET_UNKNOWN');
blocked([dst,{ ...src, creeps:src.creeps.slice(0,1) }],routes,
  'LOCAL_DEFENSE_RESERVE');
blocked([dst,{ ...src, creeps:src.creeps.map((c,i)=>i===3
  ? {...c, body:[part('move'),part('carry')]}:c) }],routes,
  'COMBAT_CAPACITY_SHORTFALL');
blocked([dst,{ ...src, creeps:src.creeps.map((c,i)=>i===3
  ? {...c, ticksToLive:20}:c) }],routes,
  'COMBAT_CAPACITY_SHORTFALL');
blocked([dst,{ ...src, creeps:src.creeps.map((c,i)=>i===3
  ? {...c,body:[part('heal',{boost:'XLHO2'}),part('heal'),part('move')]}:c) }],routes,
  'COMBAT_CAPACITY_SHORTFALL');

// Risk-state and freshness gates do not permit guessing future danger.
assert.equal(d2.evaluate([donor('W37N11'),src],routes,game).summary.targetCount,0);
assert.equal(d2.evaluate([{...dst,defenseRegistryPreview:{
  ...dst.defenseRegistryPreview,tick:99}},src],routes,game).summary.targetCount,0);
assert.equal(d2.evaluate([{...dst,defenseRequestsShadow:{
  ...dst.defenseRequestsShadow,spawnActionEnabled:true}},src],routes,game).summary.targetCount,0);
const unprovenDeadline = target();
unprovenDeadline.defenseRegistryPreview = structuredClone(unprovenDeadline.defenseRegistryPreview);
for(const r of unprovenDeadline.defenseRegistryPreview.projectedRequests)r.deadlineTick=null;
const noDeadline = d2.evaluate([unprovenDeadline,src],routes,game);
assert.equal(noDeadline.supportRequests[0].reason,'NO_USEFUL_VERIFIED_DEADLINE');
assert.equal(noDeadline.summary.selectedCount,0);
assert.equal(d2.evaluate([dst],routes,game).supportRequests[0].reason,
  'NO_VERIFIED_AFFORDABLE_TIMELY_DONOR');
assert.equal(d2.evaluate([dst,src],routes,{time:101}).summary.targetCount,0);
assert.equal(d2.evaluate([dst,src],routes,{}).summary.targetCount,0);
assert.equal(d2.telemetrySummary(output),output.summary);

const source = fs.readFileSync(path.join(here,'../game/defense.reinforcement.shadow.js'),'utf8');
for(const forbidden of [
  /\.spawnCreep\s*\(/,/\.attack\s*\(/,/\.heal\s*\(/,
  /\.activateSafeMode\s*\(/,/\.moveTo\s*\(/,
  /\.transfer\s*\(/,/\.reserve\s*\(/,
  /Memory\s*\./,/require\(['"]request\.registry['"]\)/
])assert.equal(forbidden.test(source),false,
  'No gameplay actions or persistence in D2');
const main=fs.readFileSync(path.join(here,'../game/main.js'),'utf8');
assert.ok(main.includes("const regionalDefenseShadow = require('defense.reinforcement.shadow');"));
assert.ok(main.includes('regionalDefenseShadow.evaluate(roomStates, transitEvidence.routes, Game)'));
assert.ok(main.includes('const transitEvidence = defenseTransitEvidence.snapshot(Game, Memory);'),
  'D2 must consume only passive, read-only route witness snapshot');
assert.ok(main.includes('regionalDefense: regionalDefenseShadow.telemetrySummary('));
console.log('U7/D2: deadline, evidence, donor reserve, budget and non-action tests PASS');
