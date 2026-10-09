import assert from 'node:assert/strict';
import { assessP3Release } from './p3-release-evidence-core.mjs';

const receipt = { server: 'newbieland', branch: 'chatgpt',
  version: '0.3.0-shadow.15-node24', deploymentId: '20261009200957502-9092' };
const marker = { tick: 3812491, v: receipt.version, code: 'DEPLOYMENT_MARKER',
  ctx: { version: receipt.version, deploymentId: receipt.deploymentId } };
const heartbeat = tick => ({ tick, v: receipt.version, code: 'BOT_HEARTBEAT' });
const snap = (tick, runTick = 3812915, override = {}) => ({
  tick, v: receipt.version, code: 'STATUS_SNAPSHOT',
  ctx: {
    rooms: { E8N1: { defenseMinCut: {
      status: 'READY', authority: 'SHADOW', constructionAuthority: 'NONE',
      planTick: runTick, phaseEvidence: [{ phase: 'MINCUT', cpuUsed: 3.2 }],
      ...(override.plan || {})
    } } },
    scheduler: { processes: { 'defense-mincut-shadow': {
      lastRunTick: runTick, lastCpu: 6.7, ...(override.scheduler || {})
    } } }
  }
});
function assess(events, opts = {}) { return assessP3Release({ receipt, roomName: 'E8N1', events, ...opts }); }
assert.throws(() => assessP3Release({ events: [], receipt: {} }), /Exact deployment receipt/);
assert.throws(() => assessP3Release({ receipt }), /events array/);
assert.equal(assess([heartbeat(3812825)]).reason, 'MATCHING_DEPLOYMENT_MARKER_MISSING');
const historic = snap(3812500, 3812415);
assert.equal(assess([marker, historic, heartbeat(3812825)]).state, 'WAIT');
assert.equal(assess([marker, snap(3813000, 3812415)]).state, 'WAIT',
  'cached pre-deploy CPU in fresh snapshot does not prove release');
assert.equal(assess([marker, snap(3813000, 3812915, { scheduler: { lastRunTick: 3812920 } })]).state, 'WAIT');
assert.equal(assess([marker, snap(3813000, 3812915, { scheduler: { lastCpu: NaN } })]).state, 'WAIT');
assert.equal(assess([marker, snap(3813000, 3812915, { plan: { phaseEvidence: [] } })]).state, 'WAIT');
assert.equal(assess([marker, snap(3813000, 3812915, { plan: { phaseEvidence: [{ phase: 'MINCUT', cpuUsed: NaN }] } })]).state, 'WAIT');
assert.equal(assess([marker, snap(3812500, 3812495)]).state, 'WAIT',
  'window must be wholly post-release');
assert.equal(assess([marker, snap(3813100, 3812915)]).state, 'WAIT',
  'snapshot cannot certify arbitrarily old execution');
const good = assess([heartbeat(3813100), snap(3813000), marker]);
assert.equal(good.state, 'READY');
assert.equal(good.markerTick, 3812491);
assert.equal(good.latestTick, 3813100);
assert.equal(good.samples.length, 1);
assert.deepEqual(good.samples[0], { runTick: 3812915, snapshotTick: 3813000,
  startTick: 3812901, endTick: 3813000, schedulerCpu: 6.7,
  mincutPhaseCpu: 3.2, phases: { PROTECTED_TOPOLOGY: null, MINCUT: 3.2, DEFENSE_SCORE: null },
  accountedCpu: null, cpuOutsidePhases: null,
  planStatus: 'READY', authority: 'SHADOW',
  constructionAuthority: 'NONE' });
const repeated = assess([marker, snap(3813000), snap(3813000), snap(3813100)]);
assert.equal(repeated.samples.length, 1, 'same run never counts as extra evidence');
assert.equal(repeated.samples[0].snapshotTick, 3813000);
const multiple = assess([marker, snap(3813000), snap(3813500, 3813450)]);
assert.deepEqual(multiple.samples.map(s => s.runTick), [3812915, 3813450]);
const different = { tick: 3813001, v: receipt.version, code: 'DEPLOYMENT_MARKER',
  ctx: { version: receipt.version, deploymentId: 'another-deployment' } };
assert.equal(assess([marker, snap(3813000), different]).state, 'BLOCKED');
assert.equal(assess([marker, different, snap(3813100)]).state, 'BLOCKED');
const older = { tick: 3812400, v: receipt.version, code: 'DEPLOYMENT_MARKER',
  ctx: { version: receipt.version, deploymentId: receipt.deploymentId } };
assert.equal(assess([older, marker, snap(3813000)]).markerTick, 3812491);
const wrong = { ...marker, ctx: { ...marker.ctx, deploymentId: 'wrong' } };
assert.equal(assess([wrong, snap(3813000)]).state, 'WAIT');
const wrongVersion = { ...marker, v: '0.3.0-shadow.14-node24' };
assert.equal(assess([wrongVersion, snap(3813000)]).state, 'WAIT');
// A complete three-phase release sample exposes a diagnostic CPU split.
// It is NOT proof that the unassigned remainder belongs to the solver.
const fullyMeasured = assess([marker, snap(3813000, 3812915, {
  scheduler: { lastCpu: 11.19 },
  plan: { phaseEvidence: [
    { phase: 'PROTECTED_TOPOLOGY', cpuUsed: 0.583 },
    { phase: 'MINCUT', cpuUsed: 4.434 },
    { phase: 'DEFENSE_SCORE', cpuUsed: 1.154 }
  ] }
})]);
assert.equal(fullyMeasured.state, 'READY');
assert.deepEqual(fullyMeasured.samples[0].phases, {
  PROTECTED_TOPOLOGY: 0.583, MINCUT: 4.434, DEFENSE_SCORE: 1.154
});
assert.equal(fullyMeasured.samples[0].accountedCpu, 6.171);
assert.equal(fullyMeasured.samples[0].cpuOutsidePhases, 5.019);
const duplicatedPhase = assess([marker, snap(3813000, 3812915, {
  plan: { phaseEvidence: [
    { phase: 'MINCUT', cpuUsed: 3.2 }, { phase: 'MINCUT', cpuUsed: 3.2 },
    { phase: 'PROTECTED_TOPOLOGY', cpuUsed: 0.5 },
    { phase: 'DEFENSE_SCORE', cpuUsed: 1.1 }
  ] }
})]);
assert.equal(duplicatedPhase.samples[0].phases.MINCUT, null);
assert.equal(duplicatedPhase.samples[0].accountedCpu, null);
const corruptOtherPhase = assess([marker, snap(3813000, 3812915, {
  plan: { phaseEvidence: [
    { phase: 'MINCUT', cpuUsed: 3.2 },
    { phase: 'PROTECTED_TOPOLOGY', cpuUsed: -0.1 },
    { phase: 'DEFENSE_SCORE', cpuUsed: 0.4 }
  ] }
})]);
assert.equal(corruptOtherPhase.samples[0].accountedCpu, null);
assert.equal(corruptOtherPhase.samples[0].cpuOutsidePhases, null);

console.log('P3 exact-release evidence selection tests passed');
