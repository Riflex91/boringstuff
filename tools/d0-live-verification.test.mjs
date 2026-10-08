import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { evaluateD0Shadow } from './d0-live-verification-core.mjs';
const model = createRequire(import.meta.url)('../game/threat.model.shadow.js');
const threatModel = model.telemetrySummary(model.evaluate({ room: { name: 'E8N1' }, structures: [], hostileCreeps: [] }, { time: 100 }));
const event = { tick: 100, code: 'STATUS_SNAPSHOT', ctx: { rooms: { E8N1: { threatModel } }, scheduler: { processes: { 'threat-model-shadow': { lastRunTick: 100, lastCpu: 0.1 } } } } };
const run = e => evaluateD0Shadow({ events: [e, { tick: 199 }], startTick: 100 });
assert.equal(run(event).counts.fail, 0);
assert.equal(run(event).outcome, 'WATCH');
for (const change of [m => m.actionAuthority = 'VNEXT', m => m.riskState = 'EMERGENCY', m => m.tick = 99, m => m.aggregate.meleeDps = -1, m => m.pathSearches = 5, m => m.recommendedSafeMode = true, m => m.schemaVersion = 1, m => m.coordinatedAssets = 1, m => m.breachPaths = 5, m => m.earliestLossTick = 99]) {
  const altered = structuredClone(event);
  change(altered.ctx.rooms.E8N1.threatModel);
  assert.equal(run(altered).outcome, 'FAIL');
}
const noScheduler = structuredClone(event);
delete noScheduler.ctx.scheduler;
assert.equal(run(noScheduler).outcome, 'FAIL');
const expensive = structuredClone(event);
expensive.ctx.scheduler.processes['threat-model-shadow'].lastCpu = 5.01;
assert.equal(run(expensive).outcome, 'FAIL');
assert.equal(evaluateD0Shadow({ events: [event], startTick: 100 }).outcome, 'FAIL');
assert.equal(evaluateD0Shadow({ events: [{ tick: 199 }], startTick: 100 }).outcome, 'FAIL');
console.log('D0 live verification tests passed');
