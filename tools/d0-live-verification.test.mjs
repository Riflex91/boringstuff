import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateD0Shadow } from './d0-live-verification-core.mjs';
import { writeDeploymentReceipt } from './deployment-receipt.mjs';
import { EXPECTED_BOT_VERSION } from './live-verification-core.mjs';
const model = createRequire(import.meta.url)('../game/threat.model.shadow.js');
const threatModel = model.telemetrySummary(model.evaluate({ room: { name: 'E8N1' }, structures: [], hostileCreeps: [] }, { time: 100 }));
const event = { tick: 100, code: 'STATUS_SNAPSHOT', ctx: { rooms: { E8N1: { threatModel } }, scheduler: { processes: { 'threat-model-shadow': { lastRunTick: 100, lastCpu: 0.1 } } } } };
const run = e => evaluateD0Shadow({ events: [e, { tick: 199 }], startTick: 100 });
assert.equal(run(event).counts.fail, 0);
assert.equal(run(event).outcome, 'WATCH');
for (const change of [m => m.actionAuthority = 'VNEXT', m => m.riskState = 'EMERGENCY', m => m.tick = 99, m => m.aggregate.meleeDps = -1, m => m.pathSearches = 5, m => m.recommendedSafeMode = true, m => m.schemaVersion = 2, m => m.sharedBarrierGroups = -1, m => m.coordinatedAssets = 1, m => m.breachPaths = 5, m => m.earliestLossTick = 99]) {
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

// Exercise the real CLI: version filtering must not conceal a new deployment,
// and restarting journal sequences must not discard current release evidence.
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screeps-d0-boundary-'));
try {
  writeDeploymentReceipt({ logDir, server: 'newbieland', branch: 'chatgpt', version: EXPECTED_BOT_VERSION, deploymentId: 'tested-release' });
  const marker = { tick: 100, jseq: 1, v: EXPECTED_BOT_VERSION, code: 'DEPLOYMENT_MARKER', ctx: { deploymentId: 'tested-release' } };
  const snapshot = { ...event, jseq: 1, v: EXPECTED_BOT_VERSION };
  const end = { tick: 199, jseq: 2, v: EXPECTED_BOT_VERSION };
  const cli = rows => {
    fs.writeFileSync(path.join(logDir, 'bot-events-test.ndjson'), rows.map(e => JSON.stringify(e)).join('\n') + '\n');
    return spawnSync(process.execPath, [fileURLToPath(new URL('./d0-live-verification.mjs', import.meta.url)), '--log-dir', logDir, '--json'], {
      encoding: 'utf8', env: { ...process.env, SCREEPS_SERVER: 'newbieland', SCREEPS_BRANCH: 'chatgpt', SCREEPS_ROOM: 'E8N1' }
    });
  };
  const clean = cli([marker, snapshot, snapshot, end]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(JSON.parse(clean.stdout).outcome, 'WATCH');
  for (const version of [EXPECTED_BOT_VERSION, 'other-release', undefined]) {
    for (const tick of [100, 150, 199]) {
      const changed = { tick, jseq: 1, v: version, code: 'DEPLOYMENT_MARKER', ctx: { deploymentId: 'replacement-release' } };
      const result = cli([marker, snapshot, changed, end]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Verification window crosses a deployment/);
    }
  }
  // Markers outside the window are harmless, but foreign-version rows cannot
  // complete the current release's required 100-tick evidence window.
  assert.equal(cli([{ ...marker, tick: 99, v: 'old', ctx: { deploymentId: 'old' } }, marker, snapshot, end,
    { ...marker, tick: 200, v: 'next', ctx: { deploymentId: 'next' } }]).status, 0);
  assert.equal(cli([marker, snapshot, { ...end, v: 'foreign' }]).status, 2);
} finally {
  fs.rmSync(logDir, { recursive: true, force: true });
}
console.log('D0 live verification tests passed');
