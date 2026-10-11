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
const preview = require('../game/defense.registry.preview.js');
const registry = require('../game/request.registry.js');

const game = { time: 100 };
const roomName = 'W37N11';
const pos = (x, y) => ({ x, y, roomName });
const state = {
  room: { name: roomName, controller: { my: true } },
  structures: [
    { id: 'spawn1', my: true, structureType: 'spawn',
      pos: pos(10,10), hits: 500, hitsMax: 1000 },
    { id: 'tower1', my: true, structureType: 'tower',
      pos: pos(12,12), store: { energy: 5, getCapacity: () => 1000 } },
    { id: 'rampart1', my: true, structureType: 'rampart', pos: pos(11,10), hits: 500 }
  ]
};
function threat(changes = {}) {
  return {
    schemaVersion: 3, authority: 'SHADOW', actionAuthority: 'NONE',
    status: 'READY', roomName, tick: 100,
    hostileCount: 1, armedCount: 1,
    aggregate: { meleeDps: 30, rangedDps: 10, dismantlePerTick: 0,
      healPerTick: 12, effectiveHits: 1000 },
    risk: { state: 'DEFENSE', recommendedSafeMode: false },
    access: { criticalAssetsAtRisk: [
      { assetId: 'spawn1', earliestLossTick: 120, impactTick: 110 }
    ] },
    ...changes
  };
}

// E0 projection must never write even to an already populated global registry.
const actualMemory = { bot: { requestRegistry: {
  schemaVersion: 1, rooms: { W37N11: { requests: {
    'economy:existing': { id: 'keep-exactly' }
  }, lastReconcileTick: 90 } }
} } };
globalThis.Memory = actualMemory;
const beforeMemory = JSON.stringify(actualMemory);
const stateBefore = JSON.stringify(state);
const d0 = threat();
const d0Before = JSON.stringify(d0);
const advisory = d1.evaluate(state, d0, game);
assert.equal(advisory.status, 'ADVISORY');
assert.equal(advisory.requestCount, 6);
const advisoryBefore = JSON.stringify(advisory);
const projected = preview.evaluate(advisory, game);
assert.equal(projected.status, 'PROJECTED');
assert.equal(projected.reason, 'ISOLATED_E0_SHADOW_REGISTRY');
assert.equal(projected.authority, 'SHADOW');
assert.equal(projected.actionAuthority, 'NONE');
assert.equal(projected.registrySchemaVersion, registry.SCHEMA_VERSION);
assert.equal(projected.projectedRequests.length, 6);
assert.equal(projected.summary.requestCount, 6);
assert.equal(projected.summary.reservationCount, 0);
assert.equal(projected.summary.writesToGameMemory, false);
assert.equal(projected.summary.executable, false);
assert.equal(projected.summary.totalDemand, 32 + 20 + 120 + 15 + 500 + 1);
assert.equal(projected.summary.byCapability.damagePerTick, 32);
assert.equal(projected.summary.byCapability.healPerTick, 20);
assert.equal(projected.summary.byCapability.effectiveHits, 120);
assert.equal(projected.summary.byCapability.energy, 15);
assert.equal(projected.summary.byCapability.repairHits, 500);
assert.equal(projected.summary.byCapability.rampartPositions, 1);
assert.equal(preview.telemetrySummary(projected), projected.summary);
for (const record of projected.projectedRequests) {
  assert.equal(record.schemaVersion, registry.SCHEMA_VERSION);
  assert.equal(record.domain, 'defense');
  assert.equal(record.shadow, true);
  assert.equal(record.status, registry.STATUS.OPEN);
  assert.equal(record.createdTick, 100);
  assert.equal(record.target.roomName, roomName);
  assert.deepEqual(record.reservations, []);
  assert.equal(record.deadlineTick, 120);
}
assert.equal(JSON.stringify(actualMemory), beforeMemory);
assert.equal(JSON.stringify(state), stateBefore);
assert.equal(JSON.stringify(d0), d0Before);
assert.equal(JSON.stringify(advisory), advisoryBefore);
assert.deepEqual(preview.evaluate(advisory, game).summary, projected.summary,
  'Reevaluating must not accumulate reservations or cross-tick demands');

const emptyThreat = threat({
  hostileCount: 0, armedCount: 0, risk: { state: 'NORMAL' },
  aggregate: { meleeDps: 0, rangedDps: 0, dismantlePerTick: 0,
    healPerTick: 0, effectiveHits: 0 },
  access: { criticalAssetsAtRisk: [] }
});
const clear = preview.evaluate(d1.evaluate(state, emptyThreat, game), game);
assert.equal(clear.status, 'NO_DEMAND');
assert.equal(clear.summary.requestCount, 0);
assert.deepEqual(clear.summary.byCapability, {});
const scout = preview.evaluate(d1.evaluate(state,
  threat({ armedCount: 0, risk: { state: 'WATCH' } }), game), game);
assert.equal(scout.status, 'NO_DEMAND');
assert.equal(scout.summary.requestCount, 0);
const incomplete = preview.evaluate(d1.evaluate(state,
  threat({ status: 'PARTIAL' }), game), game);
assert.equal(incomplete.status, 'INCOMPLETE');
assert.equal(incomplete.summary.requestCount, 0);
assert.equal(preview.evaluate(advisory, { time: 101 }).status, 'UNVERIFIED',
  'Stale defense capacity must not be re-used');
assert.equal(preview.evaluate(null, game).status, 'UNVERIFIED');

function forged(mutator) {
  const copy = structuredClone(advisory);
  mutator(copy);
  return preview.evaluate(copy, game);
}
for (const mutate of [
  x => { x.actionAuthority = 'SPAWN'; },
  x => { x.defenseActionEnabled = true; },
  x => { x.spawnActionEnabled = true; },
  x => { x.safeModeActionEnabled = true; },
  x => { x.summary.hasUnknownPathEvidence = true; },
  x => { x.summary.armedCount = 0; },
  x => { x.summary.status = 'READY'; },
  x => { x.specs[0].domain = 'economy'; },
  x => { x.specs[0].shadow = false; },
  x => { x.specs[0].target.roomName = 'W35N11'; },
  x => { x.specs[0].demand.amount = 1000001; },
  x => { x.specs[0].demand.capability = 'spawn'; },
  x => { x.specs[0].deadlineTick = 99; },
  x => { x.specs[0].priority.base = Infinity; },
  x => { x.specs[0].evidence.source = 'UNKNOWN'; },
  x => { x.specs[0].dedupeKey = 'defense:other:W37N11'; },
  x => { x.specs[1] = structuredClone(x.specs[0]); },
  x => { x.specs.push(structuredClone(x.specs[0])); x.requestCount++; x.summary.requestCount++; },
  x => { x.status = 'INCOMPLETE'; x.summary.status = 'INCOMPLETE'; }
]) {
  const rejected = forged(mutate);
  assert.equal(rejected.summary.requestCount, 0);
  assert.notEqual(rejected.status, 'PROJECTED');
}
assert.equal(JSON.stringify(actualMemory), beforeMemory,
  'Rejected and successful projections must never touch real Memory');

const source = fs.readFileSync(path.join(here, '../game/defense.registry.preview.js'), 'utf8');
for (const forbidden of [
  /\.spawnCreep\s*\(/, /\.attack\s*\(/, /\.activateSafeMode\s*\(/,
  /\.reserve\s*\(/, /\.moveTo\s*\(/, /\.transfer\s*\(/,
  /registry\.reserve\s*\(/, /registry\.reconcile\s*\(/
]) assert.equal(forbidden.test(source), false,
  'Preview code must never reserve capacity or issue gameplay intents');
const main = fs.readFileSync(path.join(here, '../game/main.js'), 'utf8');
assert.ok(main.includes("const defenseRegistryPreview = require('defense.registry.preview');"));
assert.ok(main.includes('state.defenseRegistryPreview = defenseRegistryPreview.evaluate('));
assert.ok(main.includes('defenseRegistryPreview: defenseRegistryPreview.telemetrySummary('));
console.log('U7/D1: D0 -> D1 -> isolated E0 preview; fail-closed, memory and intent isolation PASS');
